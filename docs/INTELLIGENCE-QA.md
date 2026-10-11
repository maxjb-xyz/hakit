# Intelligence: final checks

The remaining code is on `t-intelligence-final-polish`. T-703 adds planning reports; T-507 adds blocked-chain, unavailable-owner and waiting-agent recommendations; T-305 now reuses valid saved model plans. These build on the implementations already in main.

## Verify without writing code or using API credits

From the repository root:

```bash
pnpm typecheck && pnpm lint && pnpm format:check && pnpm test && pnpm build
pnpm --filter @hakit/web eval:planning:offline
```

The first command checks compatibility across packages and runs the regression tests. The second prints eleven planning check rates and a same-idea/different-team result. Offline results use synthetic model output and do not establish live Gemini quality.

To inspect the new scenarios by name:

```bash
pnpm --filter @hakit/engine exec vitest run src/adaptive --reporter=verbose
pnpm --filter @hakit/web exec vitest run src/worker/services/planning src/worker/routes/intelligence.integration.test.ts src/worker/routes/execution.real.test.ts --reporter=verbose
```

The database tests use local PGlite with current migrations. They never access Tiger or external AI providers.

Earlier skill-import, embedding and capability checks remain useful:

```bash
pnpm --filter @hakit/web test:skills
pnpm --filter @hakit/web test:embeddings
pnpm --filter @hakit/web test:capability
```

## What was fixed and why

- A stalled-task recommendation could change a locked/manual assignment. Protected work now receives a check-in; normal reassignment and scope-cut proposals preserve those decisions.
- Load balancing could choose a sleeping/away member or offer one task to two idle members. It now checks availability, avoids, capacity and deadline fit, reserves selected tasks, and requires an observed inactivity interval.
- T-507 needs actual milestone targets and agent transition times. The worker loads pinned milestone dates and `summary.awaitingSince`; heartbeat timestamps cannot reset an ongoing wait. Recommendations expire when the corresponding signal clears.
- Stale recommendation acceptance could move completed work or cut newly mandatory/in-progress work. It now rejects these cases before mutations. Invalid split estimates are rejected and the transaction leaves the card open.
- A failed live broadcast prevented reevaluation from reaching the queue. Notifications and enqueueing now run independently after commit.
- Planning repeated expensive requests despite having a cache column. Valid Gemini results can now be reused within the same project/model and conservative five-minute input bucket. They are revalidated, streamed, and saved as a new version. Templates and cut drafts are excluded. No schema migration is needed.

## Manual checks after review and deployment

Use a test workspace/project; keep all tokens in ignored `.dev.vars` or deployment secrets.

1. Generate a plan, then repeat the same request within its five-minute bucket. The second stream should say it is rechecking a saved plan, and the version should increase. Change guidance or team skills and confirm it generates again. A template fallback will never warm the model cache.
2. Block a task with two downstream blocking dependencies. Mission Control should show an unblock card after evaluation. Clear the blocker and verify the card expires.
3. Put a critical in-progress task's owner in a sleep/away window. Look for a reviewed handoff, or a check-in if the assignment is protected/no qualified alternative fits. No ownership changes until acceptance.
4. Leave a real agent waiting for input for more than ten minutes. Look for its check-in. Resume it and verify the card expires. Cron/Queue must be configured for this to happen automatically.
5. Complete a task before accepting an older reassignment card. Acceptance should fail with a stale-recommendation message, preserving the completed task.

Workspace screens select real projects through `useProject`; choose the intended project in the app. Mission Control's explicit `?demo=1` mode and its request-error fallback display sample data. Leave demo mode off and treat any "Demo data" label or request-error banner as a failed live check, not as evidence that the backend works.

## Skill import and usability checks

In a configured test workspace, import known public React/TypeScript and Python repositories. Inspect repository/file evidence rather than treating suggestions as proof of expertise. Repeat the import and check for duplicate skills/evidence. Confirm one skill, add another, remove a third, and re-import: all member decisions must stay intact. A new account with no public repositories must still support manual skill entry. Private/archived repositories must be excluded, and forks require contribution evidence.

Test the embedding-provider outage path: deterministic suggestions should still save. Semantic matching needs seeded taxonomy vectors; later member embeddings retry independently. Signed-out requests, workspace outsiders and missing CSRF headers must be rejected. Progress identifies the importing user; `jobId` is an acknowledgement, not a pollable status record. Verify progress after commit, and coordinate onboarding progress before a project exists with the realtime/frontend owners.

Measure a 40-repository import on deployment; fixture timing does not establish the under-30-second target. Authenticated discovery scans up to 100 owned public repos to choose 40 eligible repos, limits tree/file depth and size, and uses conservative manifest parsing. Public unauthenticated fallback uses lower-weight primary-language/topics metadata. Unknown-skill review storage and category prototypes are outside the current schema. Keep an eye on deep monorepos and uncommon manifests when assessing missed skills.

For a free UI rehearsal, use the existing local mock configuration and `pnpm dev`. Check empty states, loading/error feedback, inferred versus confirmed labels, keyboard focus, and saved work after refresh. Mock mode checks presentation; real accounts and connected providers establish integration. Rehearse public repo → reviewed skills → feasible plan → explained assignment → live update with a novice teammate and record steps to reproduce any confusing or broken behavior.

The earlier review is in [INTELLIGENCE-REVIEW.md](INTELLIGENCE-REVIEW.md); capability API checks are in [CAPABILITY-VERIFICATION.md](CAPABILITY-VERIFICATION.md). Their historical task statuses may predate the latest main branch.

Live Gemini planning was last blocked by HTTP 429; do not repeatedly run the full matrix to diagnose quota. Use the two-case command in [PLANNING-EVALS.md](PLANNING-EVALS.md) once quota permits. Hugging Face provider setup is documented in [EMBEDDING-VERIFICATION.md](EMBEDDING-VERIFICATION.md). Shared-database seeding/embedding jobs, deployed Queue/cron checks, and demo rehearsal still need the team's configured environment; local test success does not claim those have happened.
