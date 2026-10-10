# Hakit — Competitive Analysis

Researched 2026-10-10.

**Method caveat:** the network proxy blocked the live site (`hackord.vercel.app`). The Hackord analysis below comes from its public source repositories: [SAFAL-TIWARI/Hackord](https://github.com/SAFAL-TIWARI/Hackord) (frontend, homepage field = hackord.vercel.app, last commit 2026-09-15) and [SAFAL-TIWARI/Hackord-Backend](https://github.com/SAFAL-TIWARI/Hackord-Backend). We read the landing-page source, the data models, the Gemini prompts and the in-repo architecture notes. The deployment may include work that was never pushed. Treat "not found" as "not found in source", not as "absent".

---

## 1. Hackord: what it advertises

**Claims (verbatim from the landing source):**
- Badge: *"The Intelligence Engine for Hackathons & Developers"*
- H1: *"Ship faster with [AI. / Confidence. / Hackord.]"*
- Subhead: *"Hackord is the private workspace platform for elite hackathon teams. Host HD audio/video meetings, manage tasks, track live GitHub repositories, and collaborate in real-time."*
- README: *"The Ultimate Collaboration Workspace for Hackathon Builders"*

**Feature surface:**

| Area | What Hackord has |
|---|---|
| Discovery | `/explore` feed scraped from Devpost, Unstop, MLH, Devfolio, Luma and GDG; "Host Your Hackathon" |
| Team formation | User search filtered by skills; profiles (skills, experience, college, links); invitations; notifications |
| Rooms (9 tabs) | Overview (progress meter, milestones, feed) · Members · Chat (threads, pins) · AI Workspace · GitHub · Files · Timeline · Tasks · Meetings (Agora video) |
| Tasks | Todo / In Progress / Completed with priority and deadline. **`assignee` is a free-text string**, "Unassigned" by default |
| GitHub | Read-only display of stars, forks, issues, branches, commits and PRs, polled from the public REST API |
| AI Workspace | Gemini chat with multimodal input, Imagen, and Mermaid/chart/PPTX rendering. About 11 prompt "plugins": Idea Validation, Tech Stack, **Task Breakdown**, Business Model, Pitch, Demo Script, README, … |
| Misc | Global chat and DMs, voice notes, scratchpad, countdown, admin panel |

**Stack:** React 19 + TanStack Start, Tailwind v4, Radix, Three.js, Agora; Express on Vercel; MongoDB; Gemini.

**Not found in source:**
- No skill-aware planning: skills only filter people search.
- "Task Breakdown" is a prompt that returns chat text. It does not read member skills and does not create Task records.
- No assignment logic or explanation.
- No re-planning or adaptive behavior.
- No webhooks: GitHub data is polled metadata, not per-member attribution or links to tasks.
- No visibility into coding agents (no Claude Code, Codex, MCP or hooks).

## 2. Positioning against Hackord

Hackord is a **broad collaboration suite**: discovery, chat, video, files, plus a Gemini chat sidebar. It competes with Discord + Notion + Google Meet.

Hakit should **not** compete on breadth. Hakit competes on **decisions**:

| Question a team asks | Hackord | Hakit |
|---|---|---|
| "What should *we* build?" | Ask the AI chat; the answer ignores the team | Ideas scored against the team's real capability profile and sponsor constraints |
| "Who does what?" | Type a name into a text box | Solver assignment with a score breakdown, an explanation and alternatives |
| "Are we going to make it?" | Progress % from task checkboxes | Measured progress from commits and PRs, plus a labeled estimate, critical-path slack and health |
| "Something's stuck. What now?" | Nothing, or ask the chat | Typed recommendation: "reassign HK-7 to Maya (82% match, idle)" with one-click accept |
| "What are our agents doing?" | No visibility | Live Claude Code session status per member and task |

**Positioning statement:** *Hackord gives your team a room. Hakit gives your team a plan that knows who's in the room, and fixes itself when reality changes.*

**Demo framing for judges.** Don't name competitors on stage. Show the **"same idea, different team"** moment: swap one member out and watch the stack recommendation and the assignments change, with reasons. A chat wrapper can't reproduce that convincingly.

## 3. Adjacent landscape

C = capability-aware planning · E = explainable allocation · A = adaptive execution · V = coding-agent visibility

| Product | Positioning | C | E | A | V | Notes |
|---|---|---|---|---|---|---|
| Devpost team formation | Find teammates by skill | – | – | – | – | Matching people, not work |
| Linear (+ agents) | Issue tracking; agents can be assigned issues ([link](https://linear.app/integrations/codex)) | – | – | ◐ | ● | Strong agent delegation, no skill reasoning |
| GitHub Agent HQ / Copilot coding agent | "Mission control" for assigning issues to Copilot, Claude and Codex ([link](https://github.blog/news-insights/product-news/welcome-home-agents/)) | – | – | – | ● | Strongest incumbent on agent visibility, but only for GitHub-hosted agents |
| Jira + Rovo agents | Agents as assignees (beta Feb 2026) | – | – | ◐ | ◐ | Enterprise; assignment is manual |
| Height | "Autonomous PM" | ◐ | – | ◐ | – | **Shut down Sept 2025**: a warning that generic AI project management is hard to monetize |
| Taskade / Motion / Reclaim / Plane | AI project generation; calendar auto-scheduling | ◐ | – | ◐ (time-based) | – | Not built for skills or hackathons |
| Vibe Kanban, Conductor, Claude Squad, Sculptor | Run many agents in parallel locally (worktrees/containers) | – | – | ◐ | ● (one developer) | Single-developer tools, not team planning |
| Paperclip | OSS "zero-human company": org chart of agents, cascading goals, budgets, heartbeats | ◐ (agent roles) | – | ◐ | ● | Closest in spirit, but agent-only with no human team |

## 4. Where Hakit wins, and how to defend it

1. **Unified human + agent capability model.** Nobody models *humans' skills* and *agents' activity* in one assignment system. Post-hackathon, the moat is treating agents as members with capabilities and capacity (see the PHASES post-hackathon roadmap).
2. **Explainability as a product surface.** The score breakdown is cheap to build and hard to fake convincingly. It builds trust in AI assignment, which is the main reason teams ignore AI project managers.
3. **Time-boxed adaptive loop.** Hackathons are a perfect proving ground: 36 hours, a hard deadline, measurable outcomes. The same loop extends to sprints.
4. **Observation, not hosting.** Unlike Vibe Kanban or Sculptor, Hakit doesn't run agents. It observes the tools teams already use (Claude Code hooks, later Codex and GitHub Agent HQ). That keeps it cheap and complementary to incumbents.

**Risks to positioning:**
- GitHub Agent HQ or Linear could add skill-based routing.
- Mitigation: Hakit stays cross-tool and team-centric, and owns the capability graph and the evidence behind it.
