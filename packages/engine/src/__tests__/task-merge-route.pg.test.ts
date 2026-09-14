import { beforeAll, beforeEach, afterEach, afterAll, expect, it, vi } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createSharedPgTaskStoreTestHarness, pgDescribe } from '../../../core/src/__test-utils__/pg-test-harness.js';
import { ProjectEngine } from '../project-engine.js';
import { processPullRequestMergeTask } from '../../../cli/src/commands/task-lifecycle.js';
import { getTaskMergeBlocker } from '@fusion/core';
import { GitHubSourceIssueCloseService } from '../../../dashboard/src/github-source-issue-close.js';
const remote = vi.hoisted(() => ({ close: vi.fn(), getIssue: vi.fn(), head: '1'.repeat(40), branch: 'fixture-303' }));
vi.mock('../../../dashboard/src/github.js', () => ({ GitHubClient: class {
        setIssueState = remote.close;
        getIssue = remote.getIssue;
    } }));
vi.mock('../../../dashboard/src/github-auth.js', () => ({ resolveGithubTrackingAuth: () => ({ ok: true, auth: { mode: 'gh-cli' } }) }));
vi.mock('@fusion/core', async (importOriginal) => ({ ...await importOriginal<typeof import('@fusion/core')>(), getCurrentRepo: () => ({ owner: 'fixture', repo: 'repo' }), getPushRepo: () => ({ owner: 'fixture', repo: 'repo' }) }));
// Only git process I/O is intercepted. The PG store and all lifecycle writes are real.
vi.mock('node:child_process', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:child_process')>();
    function output(args: string[], cwd: string) {
        const command = args.join(' ');
        if (command === 'worktree list --porcelain')
            return `worktree ${cwd}\nHEAD ${remote.head}\nbranch refs/heads/main\n\nworktree ${cwd}/existing-task-worktree\nHEAD ${remote.head}\nbranch refs/heads/${remote.branch}\n`;
        if (command.includes('rev-parse --show-toplevel'))
            return cwd;
        if (command.includes('symbolic-ref -q HEAD'))
            return `refs/heads/${remote.branch}\n`;
        if (command.includes('rev-parse HEAD'))
            return remote.head + '\n';
        if (command.includes('rev-parse --verify refs/heads/'))
            return remote.head + '\n';
        if (command.includes('ls-remote'))
            return remote.head + '\trefs/heads/fixture-303\n';
        if (command === 'remote')
            return 'origin\n';
        if (command.includes('config --get branch.'))
            return 'origin\n';
        return '';
    }
    return { ...actual, exec: (command: string, opts: any, cb: any) => { if (!command.startsWith('git '))
            return (actual.exec as any)(command, opts, cb); cb(null, '', ''); return { kill: () => true }; }, execFile: (file: string, args: string[], opts: any, cb: any) => {
            if (file !== 'git')
                return (actual.execFile as any)(file, args, opts, cb);
            cb(null, output(args, opts?.cwd ?? ''), '');
            return { kill: () => true };
        } };
});
pgDescribe('native task merge requester route', () => {
    const h = createSharedPgTaskStoreTestHarness({ prefix: 'task_merge_route', projectId: 'proj-task-merge-route' });
    beforeAll(h.beforeAll);
    beforeEach(h.beforeEach);
    afterEach(h.afterEach);
    afterAll(h.afterAll);
    async function fixture() {
        const store = h.store();
        await store.updateSettings({ autoMerge: true, githubNativeAutoMerge: true, githubCloseSourceIssueOnDone: true, baseBranch: 'main', globalPause: false, enginePaused: false, maxConcurrent: 4 });
        const workflow = await store.createWorkflowDefinition({ name: 'native review merge completion', ir: { version: 'v2', name: 'native review merge completion', columns: [{ id: 'inbox', name: 'Inbox', traits: [{ trait: 'intake' }] }, { id: 'in-progress', name: 'WIP', traits: [{ trait: 'wip' }] }, { id: 'in-review', name: 'Review', traits: [{ trait: 'merge' }] }, { id: 'done', name: 'Done', traits: [{ trait: 'complete' }] }], nodes: [{ id: 'start', kind: 'start', column: 'inbox' }, { id: 'work', kind: 'agent', column: 'in-progress' }, { id: 'review', kind: 'prompt', column: 'in-review' }, { id: 'merge', kind: 'merge-attempt', column: 'in-review' }, { id: 'end', kind: 'end', column: 'done' }], edges: [{ from: 'start', to: 'work' }, { from: 'work', to: 'review' }, { from: 'review', to: 'merge', condition: 'outcome:success' }, { from: 'merge', to: 'end', condition: 'outcome:success' }] } } as never);
        const task = await store.createTask({ title: 'existing PR completion fixture', description: 'no model execution', column: 'in-review', workflowId: workflow.id, autoMerge: true, proposalClaimId: 'fixture:303', sourceIssue: { provider: 'github', repository: 'fixture/repo', externalIssueId: '303', issueNumber: 303 } });
        // Preexisting implementation is fixture input, not claimed execution/review evidence.
        for (let i = 0; i < (await store.getTask(task.id)).steps.length; i++)
            await store.updateStep(task.id, i, 'done');
        const worktree = join(h.rootDir(), 'existing-task-worktree');
        await mkdir(worktree, { recursive: true });
        await store.updateTask(task.id, { branch: 'fixture-303', branchWriteOrigin: 'operator', worktree });
        const pr = { number: 9, url: 'https://github.com/fixture/repo/pull/9', status: 'open' as const, title: 'existing', headBranch: 'fixture-303', baseBranch: 'main', commentCount: 0 };
        await store.updatePrInfo(task.id, pr);
        const entity = await store.ensurePrEntityForSource({ sourceType: 'task', sourceId: task.id, repo: 'fixture/repo', headBranch: 'fixture-303', baseBranch: 'main', headOid: '1'.repeat(40), state: 'open', prNumber: 9, prUrl: pr.url } as never);
        let state: 'open' | 'merged' = 'open';
        remote.head = '1'.repeat(40);
        remote.close.mockReset();
        remote.getIssue.mockReset();
        remote.getIssue.mockResolvedValue({ state: 'open' });
        remote.close.mockImplementation(async () => { remote.getIssue.mockResolvedValue({ state: 'closed' }); });
        const github = { findPrForBranch: vi.fn(), createPr: vi.fn(), getPrMergeStatus: vi.fn(async () => ({ prInfo: { ...pr, status: state }, mergeReady: true, reviewDecision: 'APPROVED', headOid: remote.head })), mergePr: vi.fn(async () => ({ ...pr, status: state })) };
        const service = new GitHubSourceIssueCloseService(store);
        service.start();
        const engine = new ProjectEngine({ projectId: task.id + '-' + h.rootDir(), workingDirectory: h.rootDir(), isolationMode: 'in-process', maxConcurrent: 4, maxWorktrees: 4 }, {} as never, { skipNotifier: true, externalTaskStore: store, getTaskMergeBlocker, getMergeStrategy: () => 'pull-request', processPullRequestMerge: (store, cwd, id, signal) => processPullRequestMergeTask(store, cwd, id, github as never, (task, options) => { const blocker = getTaskMergeBlocker(task, options); console.log('ACTUAL_BLOCKER', JSON.stringify({ blocker, column: task.column, paused: task.paused, status: task.status, steps: task.steps })); return blocker; }, signal) });
        // Component fixture: real ProjectEngine constructor/request/queue; no scheduler or agents started.
        vi.spyOn((engine as any).runtime, 'getTaskStore').mockReturnValue(store);
        (engine as any).started = true;
        (engine as any).wireAutoMerge(store, h.rootDir());
        (engine as any).wireTaskPauseMergeInterruption(store);
        return { store, task, entity, github, engine, setMerged: () => { state = 'merged'; }, stop: async () => { service.stop(); (engine as any).shuttingDown = true; for (const [event, key] of [['task:moved', 'taskMovedHandler'], ['task:updated', 'taskUpdatedHandler'], ['task:deleted', 'taskDeletedHandler']])
                store.off(event, (engine as any)[key]); (engine as any).unregisterMergeAdmissionProvider?.(); for (const timer of (engine as any).prMergeRetryTimers.values())
                clearTimeout(timer); } };
    }
    it('waits for authoritative merge, completes through the native route, and closes once on replay', async () => {
        const f = await fixture();
        try {
            const requested = await f.engine.requestInterpreterMerge(f.task.id);
            expect(requested.merged).toBe(false);
            expect((await f.store.getTask(f.task.id)).column).toBe('in-review');
            expect(remote.close).not.toHaveBeenCalled();
            expect(f.github.mergePr).toHaveBeenCalledTimes(1);
            f.setMerged();
            const confirmed = await f.engine.requestInterpreterMerge(f.task.id);
            console.log('TASK_MERGE_ROUTE', JSON.stringify({ requested: requested.merged, confirmed: confirmed.merged, column: (await f.store.getTask(f.task.id)).column, mergeCalls: f.github.mergePr.mock.calls.length }));
            expect(confirmed.merged).toBe(true);
            expect((await f.store.getTask(f.task.id)).column).toBe('done');
            await expect.poll(() => remote.close.mock.calls.length).toBe(1);
            const replay = await f.engine.requestInterpreterMerge(f.task.id);
            expect(replay.merged).toBe(false);
            expect(remote.close).toHaveBeenCalledTimes(1);
            expect(f.github.createPr).not.toHaveBeenCalled();
        }
        finally {
            await f.stop();
        }
    });
    it.each([false, true])('RED: retains reviewed A after refresh B (native auto=%s)', async (nativeAuto) => {
        const f = await fixture();
        try {
            await f.store.updateSettings({ githubNativeAutoMerge: nativeAuto });
            remote.head = '2'.repeat(40);
            // There is no expectedHeadOid field on the public requester. The PR entity still records A.
            await f.engine.requestInterpreterMerge(f.task.id);
            console.log('HEAD_GAP', JSON.stringify({ reviewedHead: '1'.repeat(40), refreshedHead: remote.head, mergeArgs: f.github.mergePr.mock.calls }));
            expect(f.github.mergePr).not.toHaveBeenCalled();
        }
        finally {
            await f.stop();
        }
    });
    it.each(['reset', 'new-checkout'])('rejects stale request after %s during the remote status await', async (race) => {
        const f = await fixture();
        try {
            const claim = { agentId: 'fixture-agent', nodeId: 'fixture-host', runId: 'checkout-A', leaseEpoch: 1, renewedAt: new Date().toISOString() };
            expect(await f.store.tryClaimCheckout(f.task.id, claim, {})).toMatchObject({ ok: true });
            const probe = f.github.getPrMergeStatus.getMockImplementation()!;
            f.github.getPrMergeStatus.mockImplementationOnce(async () => {
                if (race === 'reset')
                    await f.store.resetTaskPublication(f.task.id, 'in-review');
                else
                    expect(await f.store.tryClaimCheckout(f.task.id, { ...claim, runId: 'checkout-B', leaseEpoch: 2 }, { expectedCheckedOutBy: claim.agentId, expectedNodeId: claim.nodeId, expectedLeaseEpoch: 1 })).toMatchObject({ ok: true });
                return await probe();
            });
            const outcome = await f.engine.requestInterpreterMerge(f.task.id).catch(error => ({ error: error.message }));
            await (f.engine as any).mergeBodyInFlight?.catch(() => undefined);
            await new Promise(resolve => setImmediate(resolve));
            console.log('ADMISSION_RACE', JSON.stringify({ race, outcome: 'error' in outcome ? outcome.error : outcome.merged, mergeCalls: f.github.mergePr.mock.calls.length, checkout: (await f.store.getTask(f.task.id)).checkoutRunId, column: (await f.store.getTask(f.task.id)).column }));
            expect(f.github.mergePr).not.toHaveBeenCalled();
            expect((await f.store.getTask(f.task.id)).column).not.toBe('done');
            expect(remote.close).not.toHaveBeenCalled();
        }
        finally {
            await f.stop();
        }
    });
    it('honors explicit caller cancellation during the status await', async () => {
        const f = await fixture();
        try {
            const controller = new AbortController();
            const probe = f.github.getPrMergeStatus.getMockImplementation()!;
            f.github.getPrMergeStatus.mockImplementationOnce(async () => { controller.abort(); return await probe(); });
            await expect(f.engine.requestInterpreterMerge(f.task.id, { signal: controller.signal })).rejects.toThrow(/aborted/i);
            await (f.engine as any).mergeBodyInFlight?.catch(() => undefined);
            expect(f.github.mergePr).not.toHaveBeenCalled();
            expect(remote.close).not.toHaveBeenCalled();
        }
        finally {
            await f.stop();
        }
    });
});
