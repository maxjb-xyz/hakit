# Recording the demo video

One take, about 2:30, talking while you click. Runs locally on fixture data (mock mode): no database, no accounts, no setup.

## Setup (5 min)

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars   # HAKIT_MOCKS=1
pnpm install && pnpm dev                          # open http://localhost:5173
```

Browser full screen, zoom 110%, notifications off. Start your screen recorder with the mic on (QuickTime: File → New Screen Recording; Windows: Win+Alt+R). Do one practice run first.

## The take

| # | Click | Say |
|---|---|---|
| 1 | Start on **Mission Control**. | "Hackathon teams lose hours to coordination, not code. Hakit is the team OS: it knows who's on your team, plans what you can actually ship, and repairs the plan as reality changes." |
| 2 | **Team** → click a member → point at a skill and its evidence. | "Skills come from each member's public GitHub, with evidence and a confidence score, and each member confirms them." |
| 3 | **Plan** → pick the Hugging Face challenge → **Generate ideas** → pick one → **Generate plan**. Point at the feasibility banner. | "Pick your sponsor challenges and Hakit proposes ideas this team can build. The plan streams in, and deterministic validators check it against the team's real hours and skills. If it doesn't fit, scope is cut, and it tells you how much." |
| 4 | **Assign** → open one explanation card. | "Every assignment is solved, not guessed: skill fit, workload, availability and critical path. Every pick explains itself, and you can override it." |
| 5 | **Mission Control** → point at the activity feed. | "Commits and PRs stream in from GitHub and link to tasks automatically." |
| 6 | Open the **HK-4 recommendation** → **Accept**. | "HK-4 is on the critical path and has gone quiet. Hakit recommends a reassignment with the signals behind it, and applies it in one click." |
| 7 | Stay on Mission Control. | "The model proposes. The engine decides. That's Hakit." |

Stop recording. Upload to YouTube as unlisted and paste the link into Devpost. Talk through any loading pauses; no editing needed.
