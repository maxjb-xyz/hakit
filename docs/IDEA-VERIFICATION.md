# T-303: ideas grounded in your team

The real API now generates ideas, saves them, lists them and refines a saved idea. The default request produces three ideas; you can request one to five. T-304's comparison screen is still Frontend work, and T-305's plan pipeline is separate.

## Free testing

This task was developed in the isolated checkout `/tmp/hakit-t303-ideas` on `t-303-idea-generation`, because the original working tree had other planning/solver/scheduling edits in progress. From this checkout:

```bash
cd /tmp/hakit-t303-ideas
pnpm --filter @hakit/web test:ideas
pnpm --filter @hakit/engine exec vitest run src/planning/idea-fit.test.ts
pnpm typecheck && pnpm lint && pnpm test
```

22 API/context tests and 6 pure scoring tests cover pseudonymization, remaining availability, scope and membership, generated counts, persistence, refinement, human fallback, constraints, invalid model responses and safe errors. Tests use fake providers and isolated WASM Postgres, with no live AI or shared Tiger access. Full repository checks pass. PR #18 supplies T-301/T-306; this branch builds on it and the integration branch, not current main.

## What happens

1. The server reads this project's workspace members, their active skills, workspace-specific availability, the hackathon catalog and pinned constraints.
2. It replaces member identity with stable aliases M1..Mn. IDs, GitHub logins, names, profile headlines, repo content and skill evidence are not included in the automatic model context. User guidance/notes are sent deliberately, so don't put secrets in them.
3. Available hours count only explicitly available time from max(now, event start) to the deadline. Missing profiles count as zero. Sleep/away and stale cached totals do not inflate capacity. The context includes remaining effective hours, selected sponsor requirements, required/excluded tech, judging criteria and permitted skill slugs.
4. Gemini returns the requested number of schema-validated candidates. We additionally reject unknown skill/challenge keys, missing selected-challenge explanations, missing required tech, excluded tech and duplicate titles.
5. The server computes teamFit, commits the entire valid batch, then emits each saved idea and done. A bad batch saves nothing. Stage messages arrive before generation; complete idea events arrive after the model finishes and the batch commits. Raw model JSON fragments never appear as idea events.

**Fit formula:** for each distinct stack skill, take the team's maximum reported level × confidence, divide by 3 and cap at 1. Average those values. A score of 0.75 means 75% coverage under this formula, not a 75% probability of winning. Missing skills count zero. Duplicate skill mentions cannot inflate the score; a high level in one skill cannot hide a missing one. No stack means unknown fit, represented as zero. Scores describe the team snapshot at generation time; they do not automatically recalculate when profiles change.

Refinement produces a new saved candidate and preserves the original. It carries original user notes, the current context and the refinement instruction. The signed-in caller's membership is checked again at commit time, so leaving during generation prevents saving. Project/idea IDs are always scoped to the authorized project.

## Manual QA when real local auth/database are configured

Use a test workspace whose deadline is in the future, and a test account with skills and availability. Configure the Gemini key/model locally as in [LLM-VERIFICATION](LLM-VERIFICATION.md). An isolated checkout needs its own local setup; ignored secrets do not travel in Git. Mock mode emits distinct fixture ideas and honors count but does not persist or call Gemini.

On the local Vite site, use the existing typed API client in Developer Tools → Console:

```js
var ideaClient = await import('/src/client/lib/api.ts');
var ideaMe = await ideaClient.api('me');
var ideaWorkspaceId = ideaMe.memberships[0]?.workspaceId;
var ideaProject = await ideaClient.api('createProject', {
  params: { wid: ideaWorkspaceId }, body: { name: 'Idea QA' }
});
var ideaEvents = [];
for await (var event of ideaClient.stream('generateIdeas', {
  params: { pid: ideaProject.id }, body: { count: 1, guidance: 'Keep the demo small and usable.' }
})) {
  ideaEvents.push(event);
  console.log(event);
}
```

A real generation consumes Gemini quota; start with count 1. Expect stage events, one saved idea and done. Check that its stack is credible for your team, risks are honest, aliases are used, and selected sponsor challenges have concrete explanations. These checks verify plausibility; schema validity alone cannot establish model quality or sponsor eligibility.

After done, inspect persisted ideas and refine one:

```js
var savedIdeas = await ideaClient.api('listIdeas', { params: { pid: ideaProject.id } });
for await (var event of ideaClient.stream('refineIdea', {
  params: { pid: ideaProject.id, iid: savedIdeas[0].id },
  body: { instruction: 'Reduce the MVP to the two most useful core features.' }
})) console.log(event);
```

Expect a new idea ID while the original remains. Compare two different team profiles: the prompt context and computed score must change appropriately. Prefer skills already known for the demo's critical components.

If generation fails, an error event appears and no done event is sent. An SSE HTTP 200 means the stream opened; it does not mean generation succeeded. The error text never includes upstream provider errors or prompts. Human entry still works without AI or a seeded taxonomy:

```js
await ideaClient.api('submitIdea', {
  params: { pid: ideaProject.id },
  body: { title: 'Team helper', pitch: 'Help the team track a small shared checklist.', notes: 'Keep it simple.' }
});
```

Because the submit contract supplies only title/pitch/notes, unspecified features/target/stack are explicitly labeled as such, with fit 0. Refine the idea to produce a grounded stack before planning. Manual notes are bounded to 4000 characters. No user input is silently replaced with an invented full plan.

## Remaining integration checks

- Live Gemini idea-schema quality and frontend streaming/display are pending; T-301's tiny live JSON/stream smoke check has passed previously. No live provider calls were made for T-303 development.
- Challenge descriptions/custom instructions are model inputs, not executable instructions. Required/excluded tech checks use literal normalized names, slugs and aliases; they do not prove semantic equivalence or fulfillment of free-text sponsor requirements. The selected challenge catalog still needs the team's eligibility review.
- Ideas are listed newest first, at most 100, without pagination or automatic selection/rescoring. A user-requested regeneration adds new records. Refinement adds a candidate rather than editing the original. Disconnecting after a save does not roll it back; listIdeas recovers persisted results.
- Other members' skill/constraint changes during generation can make the snapshot stale. Profile/constraint edits do not share the save transaction; live multi-connection race verification remains pending. The caller membership recheck is covered locally.
- Shared contracts, database schema, migrations and production environment configuration are unchanged. The original working tree's unrelated edits were left untouched.
