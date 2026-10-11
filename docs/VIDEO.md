# Recording the demo video

About 2:30 long. Record in one sitting, in order. Pauses and loading waits get cut afterwards, so don't rush.

## 1. One-time setup (≈20 min)

1. **Database.** In the Tiger console, fork the dev service (e.g. `hakit-demo`). Point the production deployment at the fork, then run migrations against it: `DATABASE_URL=<fork url> pnpm db:migrate`.
2. **Demo repo.** Create an empty GitHub repo (e.g. `orbit-demo`), add a README, and clone it locally.
3. **Env file.** Create `scripts/.demo-video.env` (gitignored):
   ```bash
   DEMO_DATABASE_URL='postgres://…hakit-demo…'
   DEMO_REPO="$HOME/orbit-demo"
   ```
4. **Sign in once** on the production site with GitHub, then run:
   ```bash
   chmod +x scripts/demo-video.sh
   scripts/demo-video.sh setup <your-github-login>
   ```
5. **Connect the demo repo** in the app: Settings → GitHub → install on `orbit-demo`.
6. **Recorder.** Browser window 1440×900, zoom 110%, notifications off. Use QuickTime / OBS / Loom. Keep a terminal window ready for the commands below.

Messed up? `scripts/demo-video.sh setup <login>` again resets everything.

## 2. Shot list

Record the screen without talking. Record the voiceover afterwards by reading the lines below over the edited video.

| # | Do this on screen | Voiceover |
|---|---|---|
| 1 | Title card (logo + tagline). Make it in the editor. | "Every hackathon, teams lose their first and last six hours to coordination, not code." |
| 2 | Open **Mission Control**. Hold 3 seconds. | "Hakit is the team OS that knows who's on your team, plans what you can actually ship, and repairs the plan as reality changes." |
| 3 | **Team** → click a member → hover a skill chip's evidence → click **Confirm** on an inferred skill. | "Skills come from each member's public GitHub, with evidence and a confidence score, and every member confirms them." |
| 4 | **Plan** → select the Hugging Face challenge → **Generate ideas** → pick one → **Generate plan**. Wait for it to finish; hover the feasibility banner. | "Pick your sponsor challenges and Hakit proposes ideas this team can build. The plan streams in, then deterministic validators check it against real hours and skills. If it doesn't fit, scope gets cut, and it shows you how much." |
| 5 | Terminal: `scripts/demo-video.sh swap`. Back in the app, regenerate the plan and show the coverage diff. | "Swap the React lead for an ML engineer, and the plan changes with them. Same idea, different team." |
| 6 | **Assign** → run the solver → open one explanation card → override one task and lock it → **Accept**. | "Every assignment is solved, not guessed: skill fit, workload, availability, critical path. Every pick explains itself, and you can override any of it." |
| 7 | Put the terminal next to Mission Control. Run `scripts/demo-video.sh push`. Wait for the commit to appear, linked to HK-4. | "As you build, commits and PRs stream in and link to tasks automatically." |
| 8 | Run `scripts/demo-video.sh stall`. Wait for the recommendation card on Mission Control (≤2 min). Open it, then **Accept**. | "When critical work goes quiet, Hakit notices, recommends a fix with the signals behind it, and applies it in one click." |
| 9 | End card: logo, "Built with Gemini · Hugging Face · Tiger · Cloudflare", team names. | "The model proposes. The engine decides. Hakit." |

## 3. Editing (CapCut, iMovie or Descript are all fine)

- Cut every loading wait. Speed up the plan stream 3×, but keep its first second at normal speed.
- Zoom in on what each voiceover line points at.
- Add captions (most editors auto-generate them from the voiceover).
- Export 1080p MP4, upload to YouTube (unlisted), and paste the link into Devpost.

## 4. If something goes wrong

- **Plan generation fails:** Hakit falls back to a template plan. Keep recording, it still looks fine.
- **No recommendation after 2 min:** edit any task on the board to trigger a re-check, then cut the wait.
- **Commit doesn't show:** wait; the poller catches up within a minute. Cut the wait.

Afterwards, leave the data as it is. It's already set up for the live demo.
