# Intelligence testing and QA

You own the part that turns team experience into a credible plan. GitHub provides public evidence; T-204 proposes skills; T-205 provides semantic vectors; later capability, planning and assignment tasks use those inputs. Members must review suggestions. Inference is an estimate, not proof of expertise.

## Start here: free local checks

From the repository root:

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @hakit/engine exec vitest run src/capability/infer.test.ts
pnpm --filter @hakit/web test:skills
pnpm --filter @hakit/web test:embeddings
pnpm --filter @hakit/web test:capability
```

A passing run exits successfully without failed tests. These tests use fixtures and isolated in-memory Postgres, never the shared Tiger database or paid Hugging Face requests. Typecheck catches incompatible data; lint checks code rules; tests check behavior. Existing skipped/todo tests do **not** establish that those features work.

The skill tests check languages, manifests, aliases, evidence weights, deduplication, independent-repository confidence, semantic fallback, confirmed/self-added/removed/task-history protection, membership, CSRF, queue dispatch, and a 40-repository fixture pipeline. GitHub HTTP calls are mocked, including tree discovery and nested manifests. The fixture timing checks do not prove live imports finish within 30 seconds.

## Check the app yourself

Use `HAKIT_MOCKS=1` in your existing local configuration, then run `pnpm dev` and open the printed local URL. Check the screens that are available. Mock mode gives fake Priya data; it checks the presentation, not real GitHub inference.

| Action | Expected result |
| --- | --- |
| Open a screen with no data | A clear next step, not a blank or broken screen |
| Trigger an operation | A loading indicator and useful progress/error text |
| Inspect a skill | Inferred vs confirmed is clear; evidence explains the suggestion |
| Navigate using Tab and Enter | Buttons are reachable and focus is visible |
| Refresh during a workflow | Saved work is retained; errors offer a retry |
| Try the demo as a first-time teammate | You can explain the next action without a developer beside you |

The current onboarding/skill-import screen is a placeholder (T-207/T-208), so there is no working import button to exercise yet. Use the automated skill tests now; use the live checklist after Frontend connects that screen. Some screens/APIs remain scaffold placeholders. T-206 now implements real skill reads/edits, taxonomy search and team capability; these can be exercised with the API even though the review screen is still pending. Don't count fixture-backed screens as a completed real workflow.

## Real integration QA with the team

Run this on a configured dev deployment once auth, taxonomy seed, queue, database, embeddings and UI are connected. Platform owns deployment/secrets and taxonomy seeding; Frontend owns the review screen; GitHub/realtime owns onboarding progress transport. Do not edit production config or run destructive database commands for these checks.

1. Sign in with a test GitHub account and join a workspace. Import a public React/TypeScript repository with those dependencies in `package.json`. Expect React/TypeScript suggestions with repo/file evidence.
2. Import a Python repository and confirm its suggestions make sense. Check that minor language shares below 10% don't become language evidence in authenticated mode.
3. Import twice. Expect one member-skill row per skill and no duplicated pipeline evidence. Re-import retains old inferred suggestions not observed this time; members can remove unwanted suggestions using the T-206 API.
4. Confirm a skill, add one manually, and remove one using the T-206 API or the review UI once Frontend connects it. Re-import. Expect all three decisions to remain intact, including the removal. Automated tests already exercise this at the database layer.
5. Try a new account with no public repos. Expect zero new suggestions and a usable manual-entry path through T-206, with the review UI still pending.
6. Verify private and archived repos are excluded. Forks are accepted only when the member has commits on the fork's default branch; inherited languages/dependencies still do not prove authorship of every component.
7. Test an unavailable embedding provider. Deterministic suggestions should still save. If taxonomy vectors haven't been seeded, semantic matching is skipped. The later member-embedding job retries independently.
8. Attempt import while signed out, as a workspace outsider, and without the CSRF header. Expect rejection and no job created.
9. Watch progress in a project WebSocket subscribed to this workspace. Events contain the importing user ID, so the frontend must select that user's progress. Verify `done` follows database commit. Progress broadcasts are best-effort; a realtime outage must not prevent saving suggestions. There is currently no workspace/user onboarding socket before a project exists: coordinate an additive transport contract with PL/GH/FE before claiming onboarding progress is finished.
10. Time an import of 40 public repos on the deployed app. Record overall time and failure rate over several runs; the target is under 30 seconds. Test GitHub rate limits, token expiry, oversized manifests and queue retries. Do not infer live performance from fixture timing.

The response `jobId` is an acknowledgement identifier. The frozen queue/progress contracts don't carry that ID, so it is not a pollable job-status record; progress currently identifies the user.

## Hugging Face smoke test (small paid request)

```bash
pnpm --filter @hakit/web check:embeddings
```

This uses your locally configured token without printing it and makes two small live requests. Expect 1024 dimensions, norm around 1, and the React profile to rank above the unrelated hardware example. It consumes credits. The more detailed provider guide is [EMBEDDING-VERIFICATION.md](./EMBEDDING-VERIFICATION.md).

For model quality, maintain a small list of known public repos: React, Python ML, backend API, embedded hardware, and an empty account. Compare suggestions with a teammate who knows the repo. Record missing skills and incorrect suggestions separately. Prefer credible evidence and understandable explanations over a long skill list. Don't spend credits merely to demonstrate usage.

## Current implementation limits

- Authenticated fetching uses GraphQL metadata, tree discovery and batched blob reads instead of individual REST contents requests. This reduces round trips. The 100 most recently pushed owned public repos are scanned to choose up to 40 eligible repos. Trees are inspected up to four path components; at most 24 matching files per repo, 64 KB per file and 2 KB of README reach inference. Deep monorepos, larger manifests and uncommon formats may be missed. Generic non-JSON parsers are conservative name extractors, not full format parsers.
- Public unauthenticated fallback uses repo topics and the reported primary language only; it cannot claim actual byte-share or manifest evidence. Primary-language evidence is explicitly labeled as metadata and uses a lower weight. GitHub's stricter unauthenticated limits can cause retries.
- Matches map only to the existing taxonomy. Unknown-skill `pending_review` storage is not in the current schema; category prototypes and optional NLI are not implemented. The curated dependency map and taxonomy were already supplied by the project.
- Imports protect member decisions with conditional upserts and replace pipeline evidence only for updated inferred rows. Repeated queue delivery is safe for those writes; a transient failure after commit can cause another import and another harmless embedding job.
- Progress uses existing project broadcasts, which are shared with project subscribers. Onboarding transport before a project exists and T-404 authorization hardening still need the owning streams.
- This checkout's T-306 validator is a `NotImplementedError` stub. Integrate the earlier validator branch before testing full plan feasibility. Assignment, capability and adaptive tasks also remain pending; passing the current suite doesn't mean the entire product is finished.

## Hackathon demo readiness

Practice a short story: public repo → understandable skill evidence → member confirmation → feasible plan → explained assignment → live update. Only demonstrate stages that are connected and actually implemented. Have a fixture-backed demo available, clearly labeled, for an external-service outage. Rehearse with a novice teammate and log confusing wording, dead ends and slow steps as issues with steps to reproduce, expected behavior and actual behavior.

T-204 and T-205 share the feature branch `t-204-205-skill-import-and-embeddings`. Use that branch as the PR head and `main` as its base, with review and green CI before merge. Push to the feature branch, never directly to `main`.

The follow-up compatibility review and remaining integration risks are recorded in [INTELLIGENCE-REVIEW.md](./INTELLIGENCE-REVIEW.md).

The T-206 endpoints and manual checks are explained in [CAPABILITY-VERIFICATION.md](./CAPABILITY-VERIFICATION.md).
