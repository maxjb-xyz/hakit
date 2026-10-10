# Planning, assignment, explanations, and schedule

T-305, T-309, T-310, and T-501 now have real worker paths and pure engine implementations.

- Plan generation uses the selected project idea and a pseudonymized team context. It streams an outline, runs at most three epic calls concurrently, injects required delivery work and dependencies, validates the result, and attempts one repair. Provider failures produce an editable plan derived from the selected idea, stack, features, and selected challenges. The project row serializes version allocation. `getPlan` returns the saved draft. Milestone hours remain relative to the event start, including plans generated mid-event.
- Assignment scores use skill levels and confidence, related skills, compatible embeddings, workload, preferences, continuity, and start-time availability. Greedy allocation follows blocking dependencies and prioritizes downstream work. A deterministic bounded search tries moves and swaps. New work stays within 85% capacity and must fit available windows before the submission buffer. Manual/locked work is retained; existing overloads are reported. Unassignable prerequisites leave their dependent work unassigned. Real solves save proposed rows for the existing accept API.
- Every proposal has deterministic prose, reason codes, and up to two feasible alternatives. Manual assignments get computed scores and expose the solver delta through the explanation endpoint. Optional fast-model batch phrasing runs in the background; it selects fact-preserving prose variants instead of producing unrestricted factual claims. Failure preserves the template.
- Schedule calculations account for blocking edges, team parallelism, assigned-owner serialization, and available/sleep/away windows. CPM returns one controlling path and per-task slack for the deterministic resource schedule. Done and cut tasks consume no remaining work. Rolling velocity uses completion estimates over the last four wall hours, with focused team capacity initialization before sufficient observation. A full observed window with no completions produces no forecast. Forecasts are estimates; health carries a reason code and respects the submission buffer.

The scheduler and solver are deterministic heuristics, not globally optimal resource allocation. Partial skill matches and preserved overrides can still need review; warnings make those cases visible. Infeasible plans remain drafts with explicit feasibility issues. Idea creation/generation (T-303) and adaptive rules (T-504/T-507) are implemented in their own modules; see `docs/IDEA-VERIFICATION.md` and `docs/ADAPTIVE-VERIFICATION.md`. Plan editing UI remains separate. Live provider behavior is covered by the existing provider checks, not by these isolated tests.

Verification uses pure engine tests and real authenticated routes against isolated in-memory Postgres (PGlite), with stubbed providers. Coverage includes capacity/lock/avoid/determinism invariants, 6 members × 60 tasks with 1024-dimensional vectors under 200 ms, fork/join CPM, resource serialization, sleep/calendar exhaustion, rolling velocity, health, stream concurrency, repair/fallback, retained scope, versioned persistence, cross-project access, stale proposal replacement, accept, and manual override deltas.

```bash
pnpm --filter @hakit/engine test
pnpm --filter @hakit/web exec vitest run src/worker/services/planning src/worker/services/ai/explanations.test.ts src/worker/routes/intelligence.real.test.ts
pnpm typecheck
pnpm lint
pnpm test
```
