# T-703: planning evaluations

All remaining Intelligence changes are collected on `t-intelligence-final-polish`, based on the latest main. This work completes and hardens the team's existing eval harness rather than introducing a second one.

## Free quality checks

From the repository root:

```bash
pnpm --filter @hakit/web test:evals
pnpm --filter @hakit/web eval:planning:offline
EVAL_MODE=fallback EVAL_REPORT_PATH=test-results/planning-fallback.json pnpm --filter @hakit/web eval:planning:offline
```

The matrix contains five synthetic teams (balanced web, ML-heavy, first timers, hardware, and missing frontend) × two ideas, plus a selected-sponsor-challenge case: eleven cases per provider. Scripted generation exercises the real pipeline; fallback deliberately disables the provider. Neither mode calls an API or accesses a database.

The report shows schema, stream, DAG, task-size, skill-grounding, capacity, schedule, mandatory-deliverable, challenge, expected-coverage-warning, and privacy pass rates. `coverage` means the expected warnings were correctly identified; it does not mean every team has every skill. Negative controls deliberately introduce cycles and unknown skills, so the scorer must detect bad output rather than always print success.

For the contrast assertion, StudyLoop stays the same idea for the web team and the ML-heavy team. The latter must have lower deterministic stack fit and correctly grounded skill-gap warnings. This establishes a measurable coverage difference; it does not assert that a model rewrites the architecture or generates better ideas.

## Opt-in live Gemini check

Your ignored `apps/web/.dev.vars` must contain `GEMINI_API_KEY` and your selected `GEMINI_MODEL_PLAN`. Never put the token into the branch or a report.

```bash
pnpm --filter @hakit/web eval:planning
```

The default runs only `balanced-web×web` and `ml-heavy×web`, minimizing quota use while checking the team contrast. For a full live matrix, deliberately opt in:

```bash
EVAL_CASES=all pnpm --filter @hakit/web eval:planning
```

Custom selections are comma-separated exact case IDs; whitespace and duplicates are handled, unknown/empty selections fail before any model call. A selection that excludes either contrast case records that assertion as `not_run`, never as a pass.

Live structural/privacy gates and the contrast assertion must pass. Capacity, schedule, challenge and expected-coverage rates are reported separately for review. A provider failure that falls back to a template fails the live gate even if the fallback itself is valid. Live quota/availability failures do not invalidate the offline checks.

## Reports and evidence

The commands save ignored JSON files in `apps/web/test-results/`:

- `planning-offline.json`: scripted-provider matrix.
- `planning-fallback.json`: unavailable-provider matrix (with the command above).
- `planning-live.json`: selected real Gemini cases.

`EVAL_REPORT_PATH` changes the filename; paths are relative to `apps/web`. Reports include mode, model, per-check rates, case IDs, boolean verdicts, prompt hashes, provider call counts, issue codes, and computed team fit. They omit raw prompts, provider error bodies, private identities, and plan text. Keep reports from each prompt/model change to compare results. An offline 100% result is a pipeline regression result, not a claim about live model accuracy.

Live reports also record provider failure task, typed error code, and HTTP status. The eval uses production tier timeouts (120 seconds for planning) so it does not introduce a shorter deadline than the app. Failure messages and response bodies are never included.

### Verification recorded October 10, 2026

- Scripted and unavailable-provider modes: all eleven cases passed all eleven checks; the same-idea/different-team assertion passed in both modes.
- Fourteen offline regression tests passed, including intentionally bad plans, empty/unknown selections, and report privacy.
- The two-case live run with `gemini-3.8-flash` failed the model gate: Gemini returned HTTP 429 during outline requests, and both cases used templates. Template structure and the coverage contrast passed, but live generation is **not verified**. Retry the default two-case command when quota/rate limiting permits; do not use `EVAL_CASES=all` just to diagnose availability.

The DAG scorer independently checks unique task keys, valid dependency references, and cycles, in addition to engine verdicts. Task-size failures are scored separately. Failed verdict text is not echoed into report output, avoiding accidental leaks from model-generated issue messages.

Frontend/browser integration, GitHub live checks, Tiger/Queue verification, and demo rehearsal remain separate team checks. T-703 does not migrate, seed, or modify the shared database.
