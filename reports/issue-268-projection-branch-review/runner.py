#!/Users/man/.hermes/hermes-agent/venv/bin/python
"""One tool-free Hermes review; explicit Nous free model, no fallback chain.
No inference occurs until this script is invoked with an existing prompt file.
Uses existing native auth resolution; never prints/copies credential material.
"""
import argparse
import contextlib
import json
import logging
import os
from pathlib import Path
import sys

HERMES_SOURCE = Path('/Users/man/.hermes/hermes-agent')
MODEL = 'upstage/solar-pro4:free'
PROVIDER = 'nous'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--prompt', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--usage', type=Path, required=True)
    args = parser.parse_args()
    prompt = args.prompt.read_text(encoding='utf-8')
    if not prompt.strip() or len(prompt.encode()) > 400_000:
        parser.error('Prompt must contain 1..400000 UTF-8 bytes')
    if len({args.prompt.resolve(), args.output.resolve(), args.usage.resolve()}) != 3:
        parser.error('Prompt, output, and usage paths must differ')
    if args.output.exists() or args.usage.exists():
        parser.error('Output and usage paths must be new; retain prior receipts')
    if os.environ.get('HERMES_KANBAN_TASK'):
        parser.error('Use an independent process, not a kanban worker environment')

    sys.path.insert(0, str(HERMES_SOURCE))
    logging.disable(logging.CRITICAL)
    result = {}
    agent = None
    failure = None
    # Native libraries may print setup/runtime diagnostics; only review text and
    # allowlisted native usage leave this process. No raw exception text is emitted.
    with open(os.devnull, 'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
        from hermes_cli.runtime_provider import resolve_runtime_provider
        from hermes_cli.oneshot import _write_usage_file
        from run_agent import AIAgent
        try:
            runtime = resolve_runtime_provider(requested=PROVIDER, target_model=MODEL)
            if runtime.get('provider') != PROVIDER:
                raise RuntimeError('Primary provider changed')
            agent = AIAgent(
                api_key=runtime.get('api_key'), base_url=runtime.get('base_url'),
                api_mode=runtime.get('api_mode'), provider=PROVIDER,
                requested_provider=PROVIDER, model=MODEL,
                credential_pool=runtime.get('credential_pool'), fallback_model=[],
                enabled_toolsets=[], max_iterations=2, max_tokens=6000,
                run_budget_seconds=180, quiet_mode=True, platform='cli',
                skip_context_files=True, load_soul_identity=False, skip_memory=True,
                skip_background_review=True, save_trajectories=False,
            )
            # No auxiliary consumers: tools, memory and background review are off;
            # the native compaction preflight returns immediately when this is false.
            agent.compression_enabled = False
            if agent.tools or agent._fallback_chain or agent._fallback_model:
                raise RuntimeError('Unexpected tools or fallback chain')
            if agent.provider != PROVIDER or agent.model != MODEL:
                raise RuntimeError('Unexpected primary route')
            result = agent.run_conversation(prompt)
            if agent._fallback_activated or agent.provider != PROVIDER or agent.model != MODEL:
                raise RuntimeError('Review route changed')
            if not result.get('completed') or result.get('failed') or not result.get('final_response'):
                raise RuntimeError('Review did not complete')
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(result['final_response'] + '\n', encoding='utf-8')
        except Exception as exc:
            failure = type(exc).__name__
        finally:
            if agent is not None:
                agent.close()
            _write_usage_file(str(args.usage), result, failure=failure)
    if not args.usage.is_file():
        sys.stderr.write('Native usage receipt unavailable\n')
        return 1
    usage = json.loads(args.usage.read_text())
    if failure or usage.get('failed'):
        sys.stderr.write('Review failed; inspect the usage receipt. No alternate provider attempted.\n')
        return 1
    print(f'Review: {args.output}\nUsage: {args.usage}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
