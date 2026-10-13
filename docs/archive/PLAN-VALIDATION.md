# T-306: Plan validation

The AI proposes a plan; `validatePlan` checks it using repeatable calculations. It does not call AI, GitHub, or a database. No API credentials are needed to test it.

## Verify without writing code

Run from the repository root:

```bash
pnpm --filter @hakit/engine test:planning
pnpm --filter @hakit/engine test:planning:coverage
pnpm typecheck && pnpm lint && pnpm test
```

The focused suite has 40 tests. The coverage command enforces 100% statements, branches, functions, and lines for `planning/validate.ts`, including the shared topological sorter. Read the named tests in `packages/engine/src/planning/validate.test.ts` to see the inputs and expected outcomes.

Useful examples to inspect:
- A complete plan passes and retains its tasks.
- A dependency cycle or missing reference requests repair.
- A missing skill level is treated as zero; a gap produces a warning with the required and available levels.
- Ten effective team hours provide 8.5 usable hours after headroom. Every retained task hour costs 1.3 hours with the integration buffer.
- Optional scope is removed until capacity and the schedule fit. Mandatory work and every prerequisite it needs are preserved. If mandatory work still cannot fit, validation fails and requests repair.
- A team cannot schedule more simultaneous tasks than its member count. The last three hours are reserved for submission.
- Missing sponsor coverage and mandatory deliverables produce warnings and repair requests.

There is no new screen yet. T-305 must call this function and pass its result into the planning stream. Unit tests verify this engine independently of that integration; they do not prove the planning UI works.

## Result and integration rules

`tasks` contains the retained scope. `feasibility.cutTaskKeys` identifies excluded optional tasks. Keep the original draft if the UI needs to display deferred tasks. Removing a prerequisite also removes its optional dependants, so a scope cut leaves no dangling dependencies.

`ok` means there are no error-severity issues. Warnings may still have `repairRequests`; the planning pipeline should inspect both fields. Missing challenge coverage and deliverables require repair even when the numerical checks pass. No fabricated task or estimate is inserted automatically.

Inputs are copied, never modified. Zod checks the outline and task fields. Estimates outside 0.5–6 hours receive merge/split feedback; nonpositive or nonfinite estimates and invalid team/time inputs are rejected. Unknown task skills are dropped with warnings. If none remain, the returned draft requires repair before it can satisfy the persisted task schema.

## Existing contract assumptions

- The input contains no skill relations or embeddings, so unknown skills are dropped rather than mapped to guessed alternatives. Architecture skill errors request outline repair.
- The task contract has no risk flag; skill-gap issues reference the affected task instead. Gap hours are counted once per task; more than 20% of mandatory hours with gaps produces an aggregate warning.
- Challenge tags live on epics, so a must task addresses its epic's challenges. There are no judging weights in this input. Optional-task value uses selected challenge tags per estimated hour, with keys breaking ties. Cuts follow the explicit should-then-could order in AI.md §B.3.
- Capacity checks the entire retained scope, not only must tasks. Optional work is included until cut; mandatory prerequisites count too. `requiredHours` includes the integration buffer and `availableEffectiveHours` includes headroom.
- `criticalPathHours` is the longest dependency path. Schedule feasibility additionally checks a deterministic list schedule capped by team size. This is a valid conservative schedule, not an optimal scheduling solver. Submission cutoff is hours remaining minus three; milestone targets are relative to hacking start, which this input does not provide.
- Required deliverables are recognized from mandatory task titles: repo setup and deploy pipeline, demo script and video, Devpost submission, and README. A title change or splitting a deliverable into separate tasks may require updating this recognition rule with Platform's contract guidance.

The shared contracts, database schema, and deployment configuration are unchanged.
