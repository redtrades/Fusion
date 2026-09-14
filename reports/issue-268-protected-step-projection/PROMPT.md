# Protected deterministic task-step projection

## Original Description

Approved A2: project task-step status from actual shared/sequential blocking named-script execution, using the native step transition policy with current ownership/plan fencing. Preserve frozen A1/RED and existing review/worktree integration authority.

## What This Delivers

A deterministic script advances its task step only after the command succeeds and the same task owner and plan still apply. Old commands cannot complete replacement plans after Reset or a handoff.

## Before → After Transformation

Before: script-only foreach never starts/completes task steps; adding the unfenced native step calls lets old completion overwrite replacement plans. After: protected native start must be accepted before script execution, and protected done must be accepted before instance completion. Completion rejects changed owner/plan, paused/deleted tasks, observed abort and steps not in progress.

## Symptom Verification

Original symptom: pending task steps after successful scripts; stale native completion changes new owner's replacement step to done.
Exact reproduction: deterministic-step-projection.pg.test.ts uses actual isolated PostgreSQL/TaskStore and WorkflowGraphExecutor; harmless native printf proves actual command success. Captured start/deferred completion crosses real Reset publication, supported checkout clearing, and same-lease plan replacement/reorder.
Assertion it is gone: actual in-progress before command, done before completed instance; stale writes reject, new plan remains unchanged; replay skips terminal steps. No real model process or live task mutation.
