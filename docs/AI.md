# Hakit — Intelligence Architecture

Status: **Planning draft v1.**

Hakit's AI has three separate responsibilities. Each one keeps **model recommendations** apart from **deterministic decisions**:

| Engine | Model's job | Deterministic job (`packages/engine`) |
|---|---|---|
| A. Capability Intelligence | Embed evidence text; label repos semantically; write short summaries | Turn evidence into level and confidence; enforce precedence of confirmed over inferred; aggregate the team |
| B. Planning Intelligence | Generate ideas, the plan, the architecture and the tasks as **schema-validated JSON** | Validate schema and DAG; check team hours against estimates; check that the team covers the stack; apply the cut line |
| C. Assignment & Execution | Write explanation prose; phrase recommendations | Semantic match scores (cosine); the constraint solver; the critical path; adaptive rules |

**Rule:** a number that drives a decision (score, hours, health, critical path) is never produced by an LLM. LLMs produce candidates and prose. The engine computes, validates and decides, and humans approve.

Every AI call goes through `services/ai` (provider-agnostic):

```ts
interface LlmProvider {
  generateStructured<T>(req: { task: AiTaskName; system: string; input: unknown;
                               schema: ZodType<T>; model?: 'plan'|'fast'; stream?: boolean;
                               temperature?: number }): Promise<T> | AsyncIterable<Partial<T>>;
}
interface EmbeddingProvider { embed(texts: string[], kind: 'query'|'document'): Promise<Float32Array[]>; model: string; dim: number }
```

The implementations are `GeminiProvider` (the only LLM API), `HfEmbeddingProvider` (the only embedding API) and `KeywordFallback`. Hakit uses Gemini and Hugging Face and no other AI providers (decision D-8). Each call is logged with the task name, model, latency, token counts, a hash of the input, and whether validation passed.

---

## A. Capability Intelligence

### A.1 Principles
- **Signals, not scores.** Stars, commit counts and language percentages are *weak evidence*, never a direct measure of skill. Every inferred skill carries `confidence` and a list of `evidence`.
- **Confirmed beats inferred.** When a member confirms, edits or removes a skill, that is final. Inference never overwrites `source in ('confirmed','self_added')`. A removal is stored as a negative self-report so the skill is not re-added.
- **Recency and depth matter.** Ten recent repos that use a framework count for more than one old fork.
- **Absence is not evidence.** A thin GitHub profile gives low-confidence results, never "no skills". The UI then prompts the member to add skills by hand.

### A.2 Evidence pipeline (job `skills.import`)
1. **Fetch.** Use the user token, falling back to the public API: `GET /users/{u}/repos?type=owner&sort=pushed&per_page=100`. Exclude forks unless the user has commits in them. Cap at the 40 most recent non-archived repos. A single GraphQL query fetches languages, topics and `pushedAt`.
2. **Per repo, all public data:**
   - languages (bytes)
   - topics
   - dependency manifests: `package.json`, `requirements.txt`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle`, `Gemfile`, `pubspec.yaml`, `*.csproj`, `CMakeLists.txt`, `platformio.ini`, `Dockerfile`, `wrangler.toml|jsonc`, `.github/workflows/*`, fetched through the contents API (only the files that exist, found via the tree)
   - the first 2 KB of the README
3. **Deterministic mapping** (`engine/capability/mappers.ts`):
   - linguist language → skill (`TypeScript` → `typescript`)
   - dependency → skill through a curated map of about 400 entries (`react`, `next` → `nextjs`, `torch` → `pytorch`, `@cloudflare/workers-types` → `cloudflare-workers`, `arduino` → `embedded-arduino`, …)
   - topic → skill by alias match
4. **Semantic mapping (Hugging Face).** For the README excerpt and topics, embed `repo summary text` and match it against **skill taxonomy embeddings** (cosine ≥ 0.55). This catches skills the manifests don't reveal ("computer vision", "game dev", "REST API design"). These matches carry lower weight.
5. **Evidence rows.** Each row gets a `weight`:

   ```
   weight = base(kind) × recency(pushed_at) × depth
   base: manifest_dependency 1.0, repo_language 0.8 (scaled by byte share ≥ 10%), repo_topic 0.5,
         readme_semantic 0.4, contribution (to others' repos) 1.2, completed_task (in Hakit) 1.5
   recency: exp(-months_since_push / 18)
   depth: min(1, log2(1 + repo_size_kb/50) / 4)    // 0.25 for tiny repos, 1 for medium+
   ```
6. **Aggregation per skill:**

   ```
   S = Σ weights
   level_inferred = clamp(round(1 + 4 × (1 - exp(-S / 2.5))), 1, 5)
   confidence = 1 - exp(-(n_independent_repos) / 2) × (penalty if only semantic evidence: ×0.6)
   ```

   Keep the skill if `confidence ≥ 0.3`. Write the result to `member_skills` with `source='inferred'`.
7. **Categorization.** Every taxonomy skill already has a category (seeded). Unknown skills proposed by semantic matching or self-entry are normalized by nearest-neighbour search over the taxonomy (cosine ≥ 0.8 → alias of an existing skill). Otherwise they are labelled by cosine against **category prototype embeddings**, with zero-shot NLI (`facebook/bart-large-mnli`) only as an optional fallback, and stored as `pending_review`.
8. **Related capabilities.** `skill_relations` is derived from taxonomy embedding similarity (≥ 0.7) and a small curated adjacency list (`react` ↔ `nextjs`, `pytorch` ↔ `ml-training`). It is used for *transfer credit* in assignment: a related skill counts at 50% of its level.
9. **Member profile embedding.** The text is: confirmed and inferred skills weighted by level, interests and learning goals, embedded as the `profile` and `interests` vectors.

**Privacy:** this pipeline reads only **public** repos. Private-repo metadata needs the workspace AI-processing consent toggle. Source code is never sent to an AI provider; only manifests, language stats and README excerpts are.

### A.3 Team capability profile (`GET /w/:wid/capability`)
Computed deterministically:
- **Coverage per category:** `max(level × confidence)` across members. Labels are strong (≥ 3.5), adequate (≥ 2.5), thin (≥ 1.5), gap.
- **Bus factor per category:** the number of members with an effective level ≥ 3.
- **Overlaps:** skills where 3 or more members are ≥ 3.
- **Availability curve:** the sum of members' available hours per 2-hour bucket across the event.
- **Total effective hours:** available hours × 0.7 focus factor (configurable).
- An optional Gemini Flash-Lite call writes a two-sentence summary of strengths and gaps, labelled as AI-generated.

---

## B. Planning Intelligence

### B.1 Inputs (`PlanningContext`, built server-side, never raw from the client)
```ts
{
  team: { members: [{ id, alias /* "M1" — no names sent to model */, topSkills: [{slug, level, confidence}],
          learningGoals, avoid, availableHours }], coverage, gaps, totalEffectiveHours },
  hackathon: { name, endsAt, hoursRemaining, judgingCriteria, tracks },
  constraints: { challenges: [{ sponsor, title, requirements, requiredTech }], requiredTech, excludedTech, custom },
  idea?: { title, pitch, userNotes },
  taxonomy: { allowedSkillSlugs: string[] }   // the model must reference these slugs
}
```
Members are pseudonymized as `M1..Mn`. The model never needs names.

### B.2 Pipeline

| Step | Call | Model | Output schema (contracts) |
|---|---|---|---|
| 1. Ideas | `ideas.generate` | `gemini-flash-latest`, `thinkingLevel: MEDIUM`, temp 1.0 | `IdeaCandidate[]` (3): title, pitch, problem, targetUser, coreFeatures[], challengesAddressed[{challengeId, how}], stack[{component, tech, skillSlugs[]}], complexity 1–5, risks[], whyThisTeam[] |
| 2. Refine | `ideas.refine` | Flash, MEDIUM | `IdeaCandidate` |
| 3. Plan outline | `plan.outline` | Flash, `thinkingLevel: HIGH` | `PlanOutline`: summary, scope{must[], should[], could[], outOfScope[]}, architecture{components[{name, responsibility, tech, skillSlugs}], dataFlow[]}, milestones[{key, title, targetHour}], epics[{key, title, milestoneKey, scopeTier}], risks[] |
| 4. Tasks per epic (parallel fan-out) | `plan.tasks` | Flash, MEDIUM | `TaskDraft[]`: key, title, description, acceptanceCriteria[], estimateHours (0.5–6), requiredSkills[{slug, level 1–5, weight}], dependsOn[keys], priority |
| 5. Validate and repair | engine | deterministic | `Feasibility` |
| 6. Repair (only if needed) | `plan.repair` | Flash, LOW | targeted patch to `PlanOutline` / `TaskDraft[]` |

Splitting the plan into an outline plus per-epic task calls keeps each JSON response small and fast. It also lets sections stream to the UI as they finish (SSE `PlanStreamEvent`), and lets a single epic be retried without regenerating everything.

**Structured output:** `responseMimeType: 'application/json'` with `responseJsonSchema` generated by `zod-to-json-schema` from the contract schema. The response is then **parsed again with Zod** on our side. If parsing fails: one automatic retry with the validation errors appended. If it fails again, the request ends with a typed error and the UI offers a template fallback.

### B.3 Deterministic validators (`engine/planning/validate.ts`)
1. **Schema and references.** Every `skillSlug` exists in the taxonomy; unknown ones are mapped by nearest neighbour or dropped with a warning. Every `dependsOn` key exists.
2. **DAG.** No cycles (Kahn's algorithm). A cycle produces a repair request naming the cycle.
3. **Granularity.** Tasks over 6h are flagged for a split; tasks under 0.5h are merged.
4. **Coverage.** For each required skill, the team's effective level is checked against the required level. Tasks with a gap are marked `risk: skill_gap`. If more than 20% of *must* hours fall in gap skills, a feasibility warning names the gap and suggests alternative tech the team knows (from `skill_relations`).
5. **Capacity.** `Σ must.estimate × 1.3 (integration buffer) ≤ totalEffectiveHours × 0.85`. If this fails, `should` and then `could` items move below the cut line, lowest value-per-hour first. Value comes from the model-supplied priority and the judging-criteria tags. The banner states the numbers.
6. **Schedule.** The critical path length (in hours, with parallelism capped at team size) must fit before the final milestone, which is the deadline minus a 3h submission buffer. Otherwise the plan is marked infeasible and the scope is reduced.
7. **Constraints.** Every selected challenge must be addressed by at least one *must* task tagged with its `challengeId`. If not, the validator raises a warning plus a repair request.
8. **Required deliverables.** The plan template always includes the tasks *Repo setup and deploy pipeline*, *Demo script and video*, *Devpost submission* and *README*. Knight Hacks requires Devpost and GitHub.

### B.4 Fallbacks
- Gemini unavailable or rate-limited: exponential backoff (1s, 2s, 4s). Then **template plans**: three curated archetypes (web app + API, ML-powered app, hardware/embedded), parameterized by the selected stack, plus manual editing.
- Cache: identical `prompt_hash` returns the stored result (useful for demo reliability).
  Implemented in `services/planning/cache.ts` using the existing `plans.prompt_hash` column, scoped to the project. The key includes the selected idea, anonymized team, constraints, taxonomy/skill levels, guidance, model, system prompt and engine config. Clock and availability values used in model prompts round down to five-minute buckets; current exact validator facts are retained. A hit is revalidated and saved as a new draft version with normal stream events. Template, invalid and cut-line drafts are not cached, so fallback recovery and the cut history remain explicit. Changes to model, team, idea or timing bucket invalidate the hit. Changing pipeline behavior or AI schemas requires bumping the cache version in that file.

### B.5 Prompting conventions
- The system prompt states the role, the hard rules ("use only skill slugs from `allowedSkillSlugs`"; "estimates in hours for a single focused developer"; "assume parallel work by the given team size") and the judging criteria.
- The input is passed as JSON, never interpolated prose, which reduces injection risk from user-supplied idea text. User text is wrapped and labelled as data.
- Prompts are versioned files in `services/ai/prompts/*.ts` with golden fixtures for evals.

---

## C. Assignment & Execution Intelligence

### C.1 Semantic relevance (Hugging Face embeddings)
For each (task t, member m):

```
skill_fit(t,m) = Σ_r w_r × fit(level_m(r), required_level_r) / Σ_r w_r
  where level_m(r) = max(confirmed/inferred level × conf_factor, 0.5 × related-skill level)
        conf_factor = confirmed ? 1 : (0.6 + 0.4 × confidence)
        fit(have, need) = have ≥ need ? 1 : max(0, 1 - 0.35 × (need - have))
semantic_fit(t,m) = cosine(task.embedding, member.profile_embedding) rescaled to [0,1] via (cos - 0.2)/0.6
interest_fit(t,m) = max cosine(task.embedding, member.interests_embedding)  // learning goals boost
relevance = 0.65 × skill_fit + 0.25 × semantic_fit + 0.10 × interest_fit
```

The task embedding text is title, description, acceptance criteria and required skill names. Explicit skills dominate; embeddings catch nuance ("build the onboarding flow" against a member whose repos are design-system heavy).

### C.2 Constraint solver (`engine/assign/solve.ts`)
Problem size: ≤ 6 members, ≤ 60 tasks. A greedy algorithm with local-search improvement is enough, deterministic and fast (< 200 ms).

**Hard constraints:** locked and manual assignments are fixed. A member's assigned hours stay ≤ available hours × 0.85. Dependency chains are honoured in time: a task's earliest start is after its predecessors' estimated finish. Members with `avoid` skills never get tasks whose primary skill is avoided, unless no one else can do it, in which case it is flagged.

**Objective (per assignment, summed):**

```
score(t,m) = 0.50 × relevance(t,m)
           + 0.20 × workload_balance(m)            // 1 - assigned_hours/available_hours (after adding t)
           + 0.10 × preference(t,m)                // +1 learning goal match on 'could/should' tasks, -1 avoid
           + 0.10 × continuity(t,m)                // m owns a dependency predecessor/successor of t (fewer handoffs)
           + 0.10 × availability_timing(t,m)       // m is awake/available when t's earliest-start window opens
           − critical_path_penalty                  // critical-path tasks require relevance ≥ 0.6; else −0.3
```

**Algorithm:**
1. Topologically order tasks. Sort by (critical path first, then larger estimate first).
2. Assign each greedily to the argmax score, updating workloads.
3. Local search: try pairwise swaps and moves for up to 300 iterations or 100 ms, accepting improvements in the total objective.
4. Output per task: the chosen member, a `ScoreBreakdown` {relevance, workload, preference, continuity, availability, criticalPathPenalty, total}, the **top 2 alternatives** with deltas, and `reasonCodes[]` (e.g. `STRONG_SKILL_MATCH:react`, `BALANCES_LOAD`, `OWNS_PREDECESSOR:HK-3`, `LEARNING_GOAL:three-js`, `ONLY_QUALIFIED`, `OVERRIDE_LOCKED`).

### C.3 Explanations
- **Deterministic first:** a template renders `reasonCodes` into a sentence. For example: *"Maya: strongest React match (4/5, confirmed), owns HK-3 which this depends on, and has 6h of remaining capacity. Alternative: Jae (−0.12, a learning goal, but at 90% load)."*
- **Optional polish:** Gemini Flash-Lite (`thinkingLevel: MINIMAL`) rewrites the batch of explanations into friendlier prose, constrained to the given facts. Explanations for the whole board are generated in one call. The deterministic text is always available as a fallback, and the UI never waits on the polish.
- Overrides: a manual assignment is stored with its own computed score so the UI can show "you chose X; the solver suggested Y (+0.15)". Locks persist across re-solves.

### C.4 Progress measurement
- **Measured:** task status (done / total, weighted by estimate) plus activity signals (commits linked, PR merged).
- **Estimated:** the forecast finish time from remaining estimates ÷ the team's recent velocity. Velocity = estimate hours of tasks completed per wall hour over a rolling 4h window, initialized at 0.6 × effective capacity. Always labelled `≈`.
- Task status inference: a linked PR opened suggests `in_review` and a linked PR merged suggests `done`. These are applied as **suggestions** unless the workspace enables auto-status (default: auto for PR merged → done, with undo).

### C.5 Activity ↔ task linking
1. **Confirmed:** the branch name matches `/\bhk-(\d+)\b/i`, or the commit message or PR title/body contains `HK-12`, or a user links it manually.
2. **Inferred:** there is no explicit reference. Embed the commit message, PR title and branch name, compute cosine against the *active* tasks of the author (and then all open tasks), and boost by 0.1 when the author is the assignee. The result is `inferred` if ≥ 0.55 and the margin over second place is ≥ 0.05; otherwise `none`. Inferred links are dashed in the UI with a one-click confirm.
3. Agent sessions are linked by repo plus branch (`hk-12-*`), else to the member's in-progress task (inferred).

### C.6 Adaptive execution rules (`engine/adaptive/rules.ts`, run by `recs.evaluate`)

Each rule is a pure function `(ProjectState, now) → RecommendationDraft[]` with a `dedupe_key`:

| Rule | Signal (measured) | Recommendation |
|---|---|---|
| **Stalled task** | `in_progress` and no linked activity (commits/PR/agent) for > max(90 min, 0.5 × estimate), assignee available | `check_in` (info); if also on critical path → `reassign` to the best available alternative with relevance ≥ 0.6, or `split_task` |
| **Blocked chain** | task `blocked` or predecessor late (now > predecessor's planned finish + 30 min) and ≥ 2 downstream tasks | `unblock`: suggest a temporary reassignment or pairing for the predecessor |
| **Workload imbalance** | max(load%) − min(load%) > 40 points among available members, or a member idle (no in-progress task) > 30 min with todo tasks remaining | `rebalance`: move specific tasks (solver run on the movable subset) |
| **Critical path slip** | forecast finish > deadline − 3h buffer | `cut_scope`: propose moving the lowest value-per-hour `should`/`could` tasks below the cut line until the forecast fits; show hours saved |
| **Unavailable owner** | assignee enters a sleep/away window with critical work in progress | `reassign` (warn) or `check_in` before they leave |
| **Agent awaiting input** | agent session `awaiting_input` > 10 min | `check_in` notifying the member (P1) |

The Gemini Flash-Lite call is optional and only phrases the headline and rationale from the signals. Actions are **typed mutations** (`{op:'reassign', taskId, toUserId}`, `{op:'set_priority', taskId, priority:'cut'}`, `{op:'split', taskId, parts:[…]}`). Accepting one applies them in a single transaction and records `source='recommendation'`. Recommendations expire when their signal clears.

---

## 2. Model strategy

### 2.1 Gemini (planning and prose)

| Use | Model (env var) | Thinking | Notes |
|---|---|---|---|
| Ideas, plan outline | `GEMINI_MODEL_PLAN` = `gemini-flash-latest` (currently resolves to the 3.8 Flash family; pin an exact ID after checking AI Studio) | `thinkingLevel` MEDIUM/HIGH | Pro (`gemini-3.1-pro-preview`) is paid-only; optional switch if billing is enabled (D-6) |
| Tasks per epic, repair | same | MEDIUM / LOW | parallel calls; watch RPM |
| Explanations, recommendation phrasing, team summary | `GEMINI_MODEL_FAST` = Flash-Lite latest | MINIMAL | |

- SDK: `@google/genai` pinned `^2.28 <3` (v3 requires Node 22 semantics). If it fails in Workers, fall back to raw REST `fetch` (the request shape is simple).
- On 3.x models use `thinkingLevel`, **not** `thinkingBudget`, which errors on 3.5+.
- Free-tier limits are per project and change often. A paid key with billing caps is recommended for the demo (D-6).

### 2.2 Hugging Face (capability and matching)

| Purpose | Model | Serving |
|---|---|---|
| **Embeddings** (skills, tasks, members, activity text) | **`Qwen/Qwen3-Embedding-0.6B`** (1024-dim, instruction-aware, handles code-ish text well, Apache-2.0) | HF Inference Providers router (DeepInfra) → keyword/alias matching |
| Alt. low-latency embeddings | `BAAI/bge-small-en-v1.5` (384-dim) | HF `hf-inference` (CPU serverless). Use this **only if** Qwen3 on the router proves unreliable; it requires changing `EMBED_DIM` before seeding (D-7) |
| Zero-shot categorization (fallback only) | `facebook/bart-large-mnli` | HF `hf-inference` |
| Instruction for queries | Qwen3 query prefix: `Instruct: Given a software task, retrieve developers whose skills match\nQuery: …` | documents embedded without the instruction |

**Why not code-embedding models on raw source?** Privacy (no source upload) and signal quality. Manifests, language stats and README text, converted to skills, predict capability better than raw code vectors in this setting.

**Consistency rule:** all vectors in the DB come from one `(model, dim)`. `EMBED_MODEL` is stored with each vector, and a model change triggers a re-embed job.

**Cost and volume:** about 250 taxonomy skills + 6 members × 3 + 60 tasks + a few hundred activity texts, well under 100k tokens per event. Caching is by content hash (`embedding_cache(hash, model, vector)`).

### 2.3 Providers in use
Gemini (planning, prose) and Hugging Face (embeddings) only. The earlier optional AMD MI300X / vLLM path and the Cloudflare Workers AI embedding fallback were dropped (D-8): fewer accounts, keys and failure modes during the event. When an API is down, Hakit degrades to deterministic templates and keyword matching rather than to another provider.

### 2.4 Provider routing table (`services/ai/router.ts`)

| Task | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| ideas / plan / tasks / repair | Gemini plan model | template plan | – |
| explanations / rec phrasing / summaries | Gemini fast | deterministic templates | – |
| embeddings | HF router Qwen3-Embedding | keyword/alias matching | – |

A circuit breaker per provider: 3 failures in 60s opens it for 2 min.

## 3. Evaluation and quality testing

- **Golden team fixtures** (`engine/fixtures/teams/*.json`): balanced web team, ML-heavy team, first-timer-heavy team, hardware team, and a team with a missing frontend.
- **Engine unit tests:** solver invariants (no hard-constraint violations, locks respected, deterministic output for the same seed, load spread), critical path, rules triggering and dedupe.
- **Planning evals** (scripted, run manually and in CI nightly with a real key): for each fixture × 2 ideas, check that schema validity is 100% after one retry, DAG validity, coverage warnings when expected, that the capacity check passes after the cut, that required deliverables are present, and that each selected challenge is addressed. Track pass rate per prompt version.
- **"Same idea, different team" test:** swapping in the ML-heavy fixture must change the stack or assignments in a way the coverage diff explains. This is a demo guarantee, and it is tested.
- **Matching sanity set:** 30 hand-labelled (task, best member) pairs, with top-1 accuracy ≥ 70% as the target.
- **Human review:** before the demo, the team reviews three generated plans for realism.
