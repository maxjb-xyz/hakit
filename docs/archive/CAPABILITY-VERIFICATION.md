# T-206: capability API and QA

T-204 proposes skills. T-205 supplies semantic vectors. T-206 lets members review those skills and gives the team a deterministic capability summary. No Gemini call is needed for coverage or hours; `aiSummary` remains null.

## What changed

| Endpoint | Behavior |
| --- | --- |
| `GET /api/v1/w/:wid/members/:uid/skills` | Active skills with evidence, levels, confidence and source; target must belong to the caller's workspace. |
| `PUT /api/v1/me/skills/:slug` | Explicit self-edit with a level from 1–5. `confirmed` defaults to true; false stores a protected `self_added` row. Both use confidence 1 as a self-report, not proof of expertise. |
| `DELETE /api/v1/me/skills/:slug` | Saves a `removed` row and negative self-report, even if the member never imported that skill. Repeated requests are safe. |
| `GET /api/v1/skills?q=...` | Searches taxonomy names/slugs/aliases literally, case-insensitively, with exact matches first. Empty search returns up to 50 skills. If no literal match exists, queries of at least 3 characters can use seeded Qwen taxonomy embeddings, threshold 0.55, up to 20 results. |
| `GET /api/v1/w/:wid/capability` | Coverage, gaps, bus factor, overlaps and a two-hour availability curve for active workspace members. |

Edits preserve imported evidence and replace the member's previous self-report rather than accumulating duplicates. Removed skills are omitted from skill reads, capability calculations and member embeddings. Explicit re-add is allowed. New inferred imports cannot overwrite confirmed/self-added/removed rows.

Skills are portable across workspaces. Editing your skills clears old member vectors across workspaces and queues the existing `embed.batch` member refresh **after commit**. If queueing fails, HTTP 503 explicitly says the skill change was saved and the refresh is pending. Retry the request; it is idempotent. No outbox/schema migration was added. Until refresh completes, downstream semantic matching must handle missing vectors.

## What the numbers mean

- Effective skill level = reported level × confidence. Category coverage is the highest effective level in that category, not a sum of everybody's experience.
- Strong ≥ 3.5; adequate ≥ 2.5; thin ≥ 1.5; below that is a gap.
- Bus factor = members with effective level ≥ 3 in the category. A value of 1 means one person currently provides that level of coverage.
- Overlap = a skill where at least three members have effective level ≥ 3.
- Available hours = time explicitly marked available, intersected with the workspace event window. Sleep and away don't count. Missing profiles/windows contribute zero, not guessed hours.
- Effective hours = available hours × 0.7 by default. For example, six available hours produce 4.2 estimated effective hours. The pure engine accepts an optional focus-factor override.

The curve uses two-hour buckets anchored at the event start and includes a shorter final bucket. If startsAt is absent, workspace creation time is used, matching the profile API. Curve calculations use exact intervals rounded to six decimal places; they don't reuse the profile API's quarter-hour-rounded cache. This avoids trusting stale totals after event dates change. Small differences from profile availableHours are possible.

These totals cover the **whole event**, not remaining hours as of now. Planning must build a remaining-time context later. Invalid/overlapping windows are rejected, and event curves are bounded to 4096 buckets (~341 days), returning an actionable 422 for invalid intervals. This is a hackathon/event summary, not an unbounded calendar.

## Tests you can run now (free)

From the repo root:

```bash
pnpm --filter @hakit/engine exec vitest run src/capability/team.test.ts --reporter=verbose
pnpm --filter @hakit/web test:capability
pnpm typecheck && pnpm lint && pnpm test
```

17 engine cases test formulas, boundary labels, overlaps, bus factor, event clipping, partial buckets, missing availability, order independence, no mutation and invalid data. 23 API/in-memory Postgres cases test evidence, confirmations, self-adds, removals/re-imports, exact/semantic search, queue failure/retry, workspace isolation, validation, auth and CSRF.

No shared Tiger database or paid provider requests are involved. Semantic search tests use fake vectors/providers. Existing lint has one generated-coverage warning; there must be no new lint errors or failing tests.

The web test runner limits parallel workers to two. Unbounded parallel in-memory Postgres suites caused existing tests to time out locally; all 433 web tests passed with this limit, without increasing test timeouts.

## Hands-on checks once real local auth/database are configured

The skill-review screen (T-208) is still a placeholder. You can exercise the API with the project's typed client in the browser developer console on the Vite dev site. Use your test account; these edits change its portable skills. Mock mode returns fixture data and does not persist these edits.

1. Open the locally running app after `pnpm dev`. For a real persistence check, use the existing real-mode configuration and sign in; don't change production configuration. Open browser Developer Tools → Console.
2. Load the existing client and find your IDs. No password/token copying is needed:

```js
var capabilityApi = (await import('/src/client/lib/api.ts')).api;
var capabilityMe = await capabilityApi('me');
var capabilityWorkspaceId = capabilityMe.memberships[0]?.workspaceId;
var capabilityUserId = capabilityMe.user.id;
```

If there is no workspace membership, join/create a test workspace first. This module-import approach works on the local Vite dev server, not necessarily the production bundle. Run calls individually so you can inspect each result.

```js
await capabilityApi('searchSkills', { query: { q: 'React.js' } });
await capabilityApi('upsertSkill', { params: { slug: 'react' }, body: { level: 3, confirmed: true } });
await capabilityApi('memberSkills', { params: { wid: capabilityWorkspaceId, uid: capabilityUserId } });
await capabilityApi('teamCapability', { params: { wid: capabilityWorkspaceId } });
```

Expect the seeded React skill, a confirmed level-3 self-report, its evidence, and frontend effective coverage of at least 3. Hours may be zero until you enter availability using the profile API/UI. Repeated edits should not duplicate self-report evidence.

To test removal deliberately on that test account:

```js
await capabilityApi('removeSkill', { params: { slug: 'react' } });
await capabilityApi('memberSkills', { params: { wid: capabilityWorkspaceId, uid: capabilityUserId } });
```

React should disappear. After a completed re-import it must remain absent. You can explicitly restore it with upsertSkill. Choose levels that honestly reflect your test profile. Do not paste authentication credentials into chat.

After Frontend connects the review screen, repeat these steps by clicking: inspect evidence → confirm/adjust → remove → re-import → verify the removal sticks. A novice should understand each step without using the console.

## Integration status

- T-206 is on `t-206-capability-api`, stacked on the T-204/T-205 PR #15 branch. That dependency needs integrating first; don't merge a stacked branch directly into main without reviewing its full diff/base.
- Shared contracts, DB schema, migrations, Wrangler configuration and secrets are unchanged.
- Live deployment and multi-connection concurrency verification remain pending. Profile mutations still need to enqueue their own embedding refresh (Platform ownership); T-206 queues skill changes only.
- Search works without embeddings through names and aliases. Semantic search requires taxonomy vectors, and provider outages degrade to an empty unmatched search result. Frontend should debounce search input to control request volume.
- Pre-project import progress and T-404 hardening remain separate integration work. T-301 providers and T-306 validators are implemented on a subsequent branch (see `LLM-VERIFICATION.md`); the idea/plan pipeline, assignment and adaptive logic remain subsequent tasks.
