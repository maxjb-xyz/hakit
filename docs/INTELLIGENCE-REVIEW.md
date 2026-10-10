# T-204/T-205 compatibility review

Reviewed the combined skill-import/embedding branch against the existing Zod contracts, database schema and seed taxonomy, queue dispatcher, OAuth token helper, provider adapters, and upcoming capability/planning interfaces.

## Bugs fixed

| Finding | Fix and verification |
| --- | --- |
| Fork-contribution evidence accumulated on every re-import | Mark import-owned evidence with a pipeline tag and replace tagged contribution rows, preserving independent contribution history. Regression test imports a fork twice. |
| Shell evidence used `bash`, which is not a taxonomy slug | Use the seeded `bash-scripting` slug. Mapper regression test. |
| Unauthenticated primary-language metadata was presented as measured 100% language bytes | Keep primary-language metadata separate, label the byte breakdown unavailable, and apply a lower weight. Fetcher and mapper tests. |
| Only the first 20 languages contributed to the percentage denominator | Fetch GitHub's full `languages.totalSize`; a regression test covers a truncated list. |
| A malformed optional AMD URL prevented healthy HF/Workers AI from being used | Initialize the AMD adapter when that provider is attempted; the router can then catch its configuration error and continue. Regression test covers both healthy HF and Workers fallback. |
| A dashboard/DO broadcast outage aborted inference | Make progress notifications best-effort, independent of saving suggestions. Queueing member embeddings still fails/retries normally if the queue is unavailable. Regression test. |
| Missing taxonomy was reported as a successful zero-skill import | Fail with an actionable seed error. Tests also reject wrong model/dimension at the inference boundary. |
| A member could leave after the initial queue authorization check but before writes | Recheck and share-lock membership in the write transaction; abort without saving if it has disappeared. Regression test. |
| Member/skill vector sources could change between transaction re-read and vector write | Lock the relevant source rows before re-reading, with sorted user locks shared with import serialization. Existing embedding integration tests cover updates/deletions during provider processing and transaction rollback. Multi-connection contention still needs a deployment stress test. |

Eight new regression tests were added. Existing mapper, import, provider, cache, router, batch-job, health and route tests were rerun. All full repository checks pass; lint retains one pre-existing warning in generated coverage output. Tests use fixtures and isolated WASM Postgres; they never write to Tiger or make paid AI requests.

## Compatibility that remains intact

- No shared API/job/WebSocket contracts, schema, migrations, deployment variables or secrets changed.
- Model and storage dimension remain Qwen3 / 1024. Queries and documents have separate cache keys; corrupt cache entries are recomputed.
- Conditional skill upserts preserve confirmed, self-added, removed and task-history rows.
- Provider/model outputs are validated; deterministic evidence remains usable if semantic matching fails.
- Engine functions remain free of fetch/DB/clock reads; worker code supplies time and performs I/O.
- Queue writes and committed DB writes are separate systems: retries are expected and writes remain idempotent. Progress is best-effort, not a persistent job-status record.

## Remaining gaps before a full live demo

1. **Taxonomy embeddings are not automatically seeded.** `packages/db/src/seed/run.ts` inserts taxonomy rows without vectors. Coordinate batched `embed.batch` skill jobs with Platform before expecting semantic skill discovery; don't enqueue the entire taxonomy on every import. With taxonomy rows present but no vectors, deterministic import still works.
2. **Onboarding progress has no pre-project transport.** Existing progress broadcasts require a project socket, are shared with project subscribers and identify a user rather than a job ID. T-404 authorization hardening and the frontend/Platform transport contract are still required. This review does not claim realtime isolation is complete.
3. **The under-30-second live import requirement is not established.** Batched GraphQL calls, provider fallback and cache/database latency can exceed it. Fixture timing is not a live benchmark; measure on the deployed Worker, then tune an overall time budget/chunking strategy. Each provider attempt can take 15 seconds.
4. **Live provider equivalence is only partly checked.** HF previously passed a small live test. AMD and Workers AI still need live shape and semantic-ranking checks; sharing a model ID/dimension does not prove identical deployment behavior. Taxonomy/task vectors have no per-row model metadata, so changing the embedding model requires a coordinated full rebuild.
5. **UI and downstream intelligence remain incomplete.** T-206/T-208 are needed for real skill review and capability display. T-306 is still a stub in this checkout; integrate the earlier validator branch before a full planning demonstration. Gemini planning and the solver are subsequent tasks.
6. **Fetch coverage is bounded.** At most 100 owned public repos are scanned, 40 eligible repos imported, four tree path components inspected and 24 matching files per repo read. Non-default-branch fork contributions and unusual manifests may be missed. Conservative parsers and inferred repo-wide contribution credit need human review.
7. **Live GitHub verification is inconclusive in this environment.** A minimal public GraphQL call succeeded. The complete public import smoke test encountered direct-fetch timeouts and an HTTP 502 through the CLI proxy. Generated-query correctness and real Worker timing still need an end-to-end deployed check. No private repository content or credentials were printed; no paid AI call was made.

The local implementation is safer and remains compatible with the current contracts. Keep PR #15 in draft until the owning streams resolve the integration gaps and live checks above.
