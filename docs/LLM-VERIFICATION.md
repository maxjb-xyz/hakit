# T-301 and T-306: generation and validation

T-301 asks a model for structured JSON. T-306 checks whether a proposed plan is workable. These are separate checks: valid JSON can still describe an impossible schedule. Neither task adds an idea-generation screen or a planning endpoint; those remain T-303/T-305 and Frontend's work.

## Your Gemini setup

Create an API key in [Google AI Studio](https://aistudio.google.com/apikey). Add these lines locally to `apps/web/.dev.vars`, preserving your existing settings:

```dotenv
GEMINI_API_KEY=your_key_here
GEMINI_MODEL_PLAN=gemini-3.8-flash
GEMINI_MODEL_FAST=gemini-3.8-flash
```

The key is a secret, and `.dev.vars` is ignored by Git. Keep it out of chat, screenshots and commits. Deployment secrets are set separately by Platform; a local key does not configure the deployed Worker. Mock mode uses fixtures regardless of the key.

Google currently lists free-tier input/output for Gemini 3.8 Flash on its [API pricing page](https://ai.google.dev/gemini-api/docs/pricing). Free-tier quota belongs to your project; check AI Studio for its current limits. Paid-tier keys can incur charges, so use your free-tier project if avoiding spending. Our implementation needs text/JSON generation, not Google Search grounding, audio or images. Free-tier content may be used to improve Google's products; the live check sends only synthetic public text.

Model IDs stay configurable; no production Wrangler settings are changed. Using the same Flash model for both tiers is valid. Fast/repair calls use LOW thinking, ideas/task calls MEDIUM, and outlines HIGH. LOW works with 3.8 Flash, which does not support MINIMAL. An AMD fallback requires `AMD_LLM_BASE_URL`, an exact `AMD_LLM_MODEL`, and optional `AMD_LLM_KEY`; the endpoint must support JSON-schema chat completions over HTTPS. It is optional and not part of Gemini free-tier access.

## Free checks you can run now

```bash
pnpm --filter @hakit/web test:ai
pnpm --filter @hakit/engine test:planning
pnpm --filter @hakit/engine test:planning:coverage
pnpm typecheck && pnpm lint && pnpm test
```

37 provider/router tests use fake fetches: wire formats, Zod validation, one repair retry, transient backoff, circuit breakers, fallback, safe logs, blocked/truncated output, streamed SSE, size limits and timeouts. 40 validator tests cover the eight plan checks; coverage enforces 100% branches, statements, functions and lines in `planning/validate.ts`. They never call paid AI or the shared Tiger database. An existing generated-coverage lint warning may appear.

Optional real check, after configuring your key:

```bash
pnpm --filter @hakit/web check:gemini
```

This deliberately calls your selected Gemini model in two separate tests: one tiny JSON response and one streamed response. Each uses the app router with up to four attempts and backoff at 1, 2 and 4 seconds for transient failures. Validation repairs can add requests: at most twelve calls across both tests in the worst case. The live check bounds each provider call to ten seconds; ordinary app calls retain their thirty-second limit. It reads the key locally, uses synthetic text, and prints no key or provider response body. A passing test verifies basic key/model/structured-output/stream access. It does not prove a full hackathon plan works. Missing keys fail with setup guidance; 401/403 means authentication or access trouble, 429 means quota/rate limit, and 404 can mean a model ID unavailable to your project. HTTP 503 means temporary service unavailability/overload, not proof of an invalid key. Persistent 503 responses still fail after bounded retries; retry later rather than enabling billing as a fix. Ordinary tests exclude this live check.

## Behavior and integration limits

- Every result is checked against its supplied Zod schema. Ordinary generation gets one repair attempt with bounded validation codes/paths appended to the instructions. Blocked or incomplete output fails rather than being accepted as a plan.
- Streaming emits tentative text and validates the complete document at the end. Consumers must handle rejection and persist only a validated result. Repair/fallback never appends a second JSON document after partial output has been emitted; retry the whole stream instead.
- Transient HTTP/network errors retry after 1, 2 and 4 seconds, including streaming failures before any text has been emitted; authentication failures and 30-second call timeouts do not retry. Bodies are limited to 1 MiB and requests are bounded. No `Retry-After` scheduling or persistent breaker state is implemented.
- After three failed requests within one minute, a provider is bypassed for two minutes. Only one recovery probe is allowed. Router state survives requests in the same warm Worker environment, not across isolates. AMD is used when configured; otherwise all-provider failure returns a typed unavailable error. Real mode never silently returns fixture plans.
- Logs contain task/provider/model, latency, input hash, token counts and validation outcome. They omit prompts, inputs, output text, API keys and upstream error bodies. Logging failure does not break generation. This is Worker telemetry, not a new database call-log table or prompt cache.
- T-306 preserves mandatory work and its prerequisites when reducing optional scope. If mandatory scope cannot fit, it reports infeasibility. Duplicate epic/milestone/task references are errors. Team effective levels must be finite and between zero and five. See [PLAN-VALIDATION](PLAN-VALIDATION.md) for formulas and contract limits.
- The branch `t-301-306-ai-providers-and-plan-validation` includes T-206 as a dependency. Review/integrate the earlier PRs before merging this work. The live Gemini check passed both generation and streaming with the locally configured model/key after the retry fix. Live AMD, Gemini planning schemas at demo scale, and deployed verification remain pending. Live verification used only synthetic text; no key or response body was logged.
