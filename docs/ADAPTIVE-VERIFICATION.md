# Adaptive recommendations: T-504 and T-507

The backend now detects six signals and saves reviewable recommendations. It never changes tasks merely because a rule fires. A teammate must accept a card; dismissal postpones the same signal for 30 minutes.

| Signal | What Hakit proposes |
| --- | --- |
| In-progress task has no linked activity for more than max(90 minutes, half its estimate), with its owner available | Check in; on the critical path, propose a qualified handoff when feasible |
| Available members' load differs by over 40 percentage points, or one is idle for over 30 minutes while todo work remains | One concrete move that reduces the load gap |
| Estimated finish exceeds the deadline minus the submission buffer | Cut optional work, preserving must-have work and its prerequisites, work underway, and manual/locked assignments |
| A blocked or overdue predecessor holds up at least two downstream tasks | A handoff or a check-in to coordinate pairing |
| Critical work's owner is currently unavailable | A feasible handoff, or a check-in if no eligible alternative exists |
| A member's agent has awaited input for over ten minutes since its last event | Notify that member to check the agent's question or permission request |

A two-minute cron and committed board edits enqueue evaluations. Repeated evaluations keep the same open card ID and refresh its evidence/actions. Cleared signals expire cards. Expired events and inactive projects with open cards are evaluated so old recommendations disappear. Accept/dismiss and evaluation share compatible lock ordering; actions are rechecked at accept time. Stale handoffs/splits of completed work and scope cuts of newly must-have work return 409.

## Free checks you can run

This task is in a separate checkout so your current main checkout stays intact:

```bash
cd /home/gmarines/programming/repos/hakit/.worktrees/adaptive
pnpm --filter @hakit/engine exec vitest run src/adaptive/rules.test.ts --reporter=verbose
pnpm --filter @hakit/web exec vitest run src/worker/jobs/recs-evaluate.test.ts --reporter=verbose
pnpm typecheck
pnpm lint
pnpm test
```

Tests use deterministic fixtures, fake queue/realtime bindings, and isolated in-memory Postgres. They never use your Hugging Face credits, Gemini quota, or shared Tiger database.

Read the named scenarios in the verbose output: stalls clear when activity arrives; sleeping members are excluded; locks prevent automatic handoff proposals; optional cuts preserve required dependencies; repeated jobs do not duplicate cards; dismiss cooldown works; outsiders cannot read cards; failed realtime delivery does not prevent enqueue; invalid availability rolls back; and accepted status actions stamp completion time.

## Team/demo verification after review and deployment

Use a disposable demo workspace with two members, confirmed skills, realistic availability, an accepted plan, and assigned tasks. Confirm real mode is enabled and Queue/Cron/ProjectRoom bindings work with Platform. In mock mode the endpoint returns the fixed demo fixture; that does not exercise these rules.

1. Verify `GET /api/v1/projects/<project-id>/recommendations` returns only that project's open cards. Mission Control also includes them in `openRecommendations`.
2. Ask a developer to seed a known old in-progress task or a blocked task with two dependents. Wait for the two-minute cron, then check the measured signal and proposed action.
3. Confirm a repeated evaluation preserves the card ID. Add correctly linked activity or resolve the blocker; the corresponding card should expire after evaluation.
4. Accept a handoff and confirm the owner changes once across clients. Lock a task first and check that the rule proposes a check-in instead of moving it. Dismiss a card and verify it does not immediately return.
5. Use an optional-scope example whose estimate exceeds the buffer. Inspect which tasks would be cut before accepting; must-have tasks and their prerequisites must remain.

These are worker/engine changes. The teammate-owned recommendation card UI, delivery of a `notify` action to its user, and live agent/GitHub ingestion need end-to-end verification separately. The action is a stored in-app suggestion, not an email or external notification.

## Bugs corrected and practical limits

- The shared project-state loader now reads project-scoped GitHub/agent activity, current-member agent sessions, execution start, and pinned milestone targets. Empty activity maps previously made recent work invisible to adaptive rules.
- Capacity now unions overlapping available windows and subtracts sleep/away, using the same calendar logic as scheduling. Reversed/non-finite windows fail explicitly.
- Board edits, accepted plans, and accepted recommendations enqueue evaluation independently of realtime broadcasts. A queue outage does not undo an already committed edit; cron supplies the next evaluation.
- Accepted recommendation status changes stamp `startedAt`/`completedAt`, or clear completion when reopening, so velocity calculations remain consistent with ordinary task updates.
- Relevant older integration suites now close their in-memory databases between tests rather than accumulating WASM database instances.

Forecasts and available capacity are estimates. Lack of linked activity does not prove a teammate has stopped working. Optional task value is approximated by scope tier per estimated hour; there is no monetary or judging-value model in the shared contract. Handoffs use the existing deterministic pair scorer with relevance, capacity, preference, calendar, and dependency checks; they are not a globally optimal allocation.

There is no task-level saved planned finish in the schema, so the overdue-predecessor rule conservatively uses its pinned milestone target with a 30-minute grace period. Agent waiting duration is measured from its last event; heartbeats can postpone detection until the ingestion stream supplies a dedicated waiting-since signal. No alternate eligible member produces a check-in rather than an invented split; automated splitting needs more task-specific information.

Realtime messages are delivered after commit, with stable IDs suitable for deduplication. A retry republishes current open cards; a failed expiry broadcast may require a snapshot refresh to remove the card. Polling/list reads remain authoritative. Live Tiger/Queue/Cron and frontend demo checks are still pending.
