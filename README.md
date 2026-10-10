# Hakit

**The Hackathon OS that knows your team and knows what to build next.**

Hakit turns a group of people with different skills into a coordinated team. It plans around the team's real capabilities, assigns work with explanations, tracks live GitHub and coding-agent activity, and adapts the plan as the deadline approaches.

> Status: **scaffold**. Contracts, schema, Worker skeleton (mock mode), UI tokens and shell are in place; features are being built per [`docs/TASKS.md`](./docs/TASKS.md).

```bash
pnpm install && cp apps/web/.dev.vars.example apps/web/.dev.vars && pnpm dev
```

Start with [`CLAUDE.md`](./CLAUDE.md) (conventions and ownership) and [`docs/SETUP.md`](./docs/SETUP.md) (accounts and secrets).

| Doc                                  | Contents                                                                |
| ------------------------------------ | ----------------------------------------------------------------------- |
| [PRODUCT](docs/PRODUCT.md)           | Requirements, journeys, priorities, differentiators                     |
| [COMPETITIVE](docs/COMPETITIVE.md)   | Hackord and adjacent tools, positioning                                 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | Cloudflare architecture, data model, API, real-time, jobs, security     |
| [DESIGN](docs/DESIGN.md)             | Brand, tokens, components, screen specs, accessibility                  |
| [AI](docs/AI.md)                     | Capability, planning, assignment and adaptive engines; model strategy   |
| [INTEGRATIONS](docs/INTEGRATIONS.md) | GitHub, Hugging Face, Gemini, TigerData, agents, Figma, ElevenLabs |
| [PHASES](docs/PHASES.md)             | Phased plan and post-hackathon roadmap                                  |
| [TASKS](docs/TASKS.md)               | Executable tasks with acceptance criteria                               |
| [HACKATHON](docs/HACKATHON.md)       | 36-hour schedule, checkpoints, demo script, fallbacks                   |
| [RISKS](docs/RISKS.md)               | Risks, mitigations, decisions awaiting approval                         |
| [DEMO](docs/DEMO.md)                 | Demo click-path, real-mode seed/swap/stall, fallbacks                   |
| [SUBMISSION](docs/SUBMISSION.md)     | Devpost write-up, built-with, capture checklist                         |
