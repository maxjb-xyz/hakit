# Claude Design prompt — Hakit full UI

Paste everything below the line into Claude Design.

---

Design the complete product UI for **Hakit**, a hackathon team OS: "The hackathon OS that knows your team and knows what to build next." It reads your teammates' GitHub work to figure out what they're good at, writes a project plan this specific team can actually ship, assigns tasks with an explanation for each one, then watches GitHub and coding-agent activity and suggests changes to the plan while the event runs.

It should feel like a **professional, sleek developer tool in the class of Linear**. That means fast, dense, keyboard-first, quiet, and exact. Mood: a flight deck or an IDE, calm under deadline pressure. The AI appears as annotations and recommendations, **never as a glowing orb, sparkle gradient or chatbot**. No emoji in system UI. The copy is short, declarative and specific: "Auth is blocking 3 tasks." not "Looks like there might be some blockers! 🚀"

## Users (use them in the mock data)

Team "Null Pointers" at **Knight Hacks 2026**, 36-hour event, about 19h remaining in the hero states:
- **Priya Raman**: team lead, workspace owner, full-stack (signed-in user)
- **Marcus Bell**: backend (Go, Postgres)
- **Jae Kim**: first-time hacker, light frontend, wants to learn ML
- **Sam Ortiz**: runs 2–3 Claude Code sessions in parallel
- **Maya Chen**: design + React

Project: "Pulse", a real-time triage dashboard for campus EMS, aimed at two sponsor tracks. Task IDs look like `HK-12` and branches like `hk-12-auth-flow`.

## Product principles that must be visible in the design

1. **Evidence over vibes.** Every inferred skill shows its evidence, every assignment shows its score breakdown, and every number says whether it is **measured** or **estimated**.
   - Measured: solid fill, plain number, e.g. `12/20 tasks`.
   - Estimated: hatched or striped fill, or a dashed outline, with a `≈` prefix, e.g. `≈ 68%`.
   - Confirmed activity→task links use solid connectors. Inferred links use dashed connectors plus an "inferred" chip and a confidence value.
2. **Human in the loop, one click away.** Every AI recommendation has Accept / Modify / Dismiss. Every assignment has Override / Lock.
3. **AI-originated content marker.** Use a violet (`#B48CF2`) 2px left rule or a small glyph only, never a fill or glow.
4. **Never convey status by colour alone.** Always pair colour with an icon and a label.

## Visual system (follow it, refine it)

- **Dark-first.** Cool charcoal neutrals: canvas `#0B0C0E`, sidebar `#111215`, surface `#16181C`, raised `#1C1F24`, hover/input `#24272D`, border `#2E323A`, strong border `#3D424C`. Text runs `#808794` (subtle), `#A4AAB5` (muted), `#D3D7DE` (body), `#F3F4F6` (strong). Also provide a light theme for the key screens.
- **Single accent:** electric indigo `#6E78FF`. Use `#8B93FF` for links on dark, `#5560E8` for pressed, and `rgba(110,120,255,.12)` for selected rows. Green is reserved for VCS and success.
- **Semantic colours:** success `#3FB97A`, warning `#E5A93B`, danger `#E5534B`, info `#4AA8D8`, AI `#B48CF2`.
- **Member identity palette** (always paired with initials or avatar): `#6E78FF #3FB97A #E5A93B #E5534B #4AA8D8 #B48CF2 #E07BB5 #9BB84A`.
- **Type:**
  - Inter for UI, at a **13px base** for IDE density.
  - Inter Tight or Geist for headings 20px and up.
  - JetBrains Mono or Geist Mono for SHAs, branches, task IDs, durations and the countdown.
  - Use tabular numerals in tables. Nothing below 11px.
- **4px spacing scale.**
  - Control heights: 24, 28 (default), 32, 40 (onboarding).
  - Radius: 4 (chips, inputs), 6 (buttons, cards), 8 (panels), 12 (onboarding cards).
  - Elevation comes from luminance plus a 1px border, not shadows. Popovers are the exception.
- **Motion is purposeful and short** (80 / 140 / 220 / 360ms) and only appears in these places:
  - New activity slides into the feed with a 1s tint fade.
  - A reassigned task card animates between member lanes.
  - Plan sections stream in as they validate.
  - The countdown ticks without flashing.
- **Logo:** lowercase `hakit` wordmark with tight tracking, plus an "hk" keycap monogram cut by a diagonal. Explore two alternatives: three stacked bars of different lengths, and `[h]`.

## App shell

- Left sidebar (232px, collapses to a 56px icon rail) with workspace switcher and these items: Mission Control, Plan, Tasks, Team, Code, Agents, Settings.
- Top bar with breadcrumb (Workspace ▸ Project), live countdown in mono, connection status chip, ⌘K, and avatar.
- Resizable right **Inspector** (400px) for task / member / activity detail, with tabs and sticky footer actions.
- **⌘K command palette:** jump to a task or member, "Reassign HK-12 to…", "Generate ideas", "Copy branch name". Show `Kbd` hints throughout (`j/k`, `enter`, `esc`, `c`, `a`, `s`, `m`).
- Mobile (<768px): bottom tab bar, inspector as a full-screen sheet, board as a grouped list.

## Screens (design every one, at desktop 1440 plus key mobile frames)

1. **Sign in.** Left side: product statement and a 3-step visual (Team → Plan → Ship). Right side: "Continue with GitHub". Below that, permission transparency copy: "We read your public repos to suggest skills. We never read private code without asking." Include OAuth error and rate-limited states.
2. **Onboarding (3 steps, progress dots).**
   - Profile basics.
   - Skill import: a streaming checklist ("Reading 34 public repos → Detected 12 languages → Found 41 dependencies → Mapped to 18 skills"), then skills grouped by category. Inferred chips show a confidence value and expand into evidence ("React — 7 repos, `react` in package.json of 5, last used 2 months ago"). Actions: confirm, adjust level 1–5, remove, add, and a bulk "Looks right". Include a thin-profile state.
   - Availability & preferences: a timeline strip of the 36h window where you drag to mark sleep, plus "want to learn" and "prefer to avoid" tag inputs.
3. **Create workspace & invite.**
   - Name, and a hackathon template picker with Knight Hacks 2026 preselected (fills in deadline, tracks, sponsors and judging criteria).
   - A big copyable invite link plus a QR code, an expiry setting, and a member list with live "joined" pulses.
4. **Member profile.**
   - Header: avatar, GitHub handle, "≈22h available", current task.
   - Tabs: Skills (confirmed / inferred / interests), Evidence, Assignments, Activity, Agents.
5. **Team capability overview.**
   - A members × categories heat grid covering frontend, backend, data, ML, infra, design, mobile and hardware.
   - A coverage bar per category: strong / adequate / thin / gap.
   - Gap callouts ("No one has deployed to Cloudflare before") and overlap callouts ("3 people strong in React").
   - A stacked-area availability curve across the event.
   - CTA: "Plan a project with this team".
6. **Project creation & idea generation.**
   - Two entry cards: "I have an idea" and "Generate ideas".
   - Three generated ideas as comparison columns. Each shows a pitch, sponsor tracks hit, a deterministic **team-fit %**, complexity, risk and "why this team" bullets.
   - Actions: pick, refine with chips ("make it simpler", "more ML") or free text, and regenerate one.
7. **Sponsor challenges & constraints.**
   - Selectable track cards showing requirement text, prize and required-tech badges.
   - A pinned Constraints panel: required APIs, judging-criteria weights, deadline, team hours.
   - A live **constraint fit meter** for the current idea, with ✓ satisfied, ⚠ risky and ✗ conflicting.
8. **AI plan review.** Sections stream in this order:
   - Summary.
   - MVP scope as must / should / could, with a visible **cut line**.
   - Architecture: a component diagram plus a stack table with "who knows this" avatars.
   - Milestones on a timeline across the event window.
   - Tasks grouped by milestone, with skills and hour estimates.
   - Risks.

   Also include:
   - A deterministic **feasibility banner**: "Plan needs ≈118h; team has ≈96h available → 3 'should' items moved below the cut line."
   - Inline edit, "Regenerate section with instruction", version history (v1, v2…), and Accept plan.
9. **Assignment review.**
   - Swimlanes per member, each with a capacity bar (assigned / available hours), plus an Unassigned column.
   - Cards show match %. Clicking one opens an **Explanation card** in the inspector. The card holds a horizontal stacked **score breakdown** (skill / workload / preference / dependency / availability), a 1–2 sentence rationale, the top 2 alternatives with deltas, and Override / Lock. This is the core of explainability, so make it beautiful.
   - Warnings: overloaded member, unmet skill requirement, dependency chain owned by one person.
   - Actions: Rebalance and Accept assignments.
10. **Tasks.**
    - Three views: Board (todo · in progress · in review · blocked · done), a dense List table, and a dependency Graph (DAG with the critical path highlighted in accent).
    - Task inspector tabs: Details (acceptance criteria, estimate, skills), Assignment, Dependencies, Activity (linked commits / PRs / agent sessions, with confirmed vs inferred and a "confirm link" action), History.
    - Quick-create with `c`, and a copy-branch-name button.
11. **Mission Control (hero screen; spend the most craft here).**
    - **Status band:** big mono countdown (turns warning under 6h, danger under 2h), overall health (on-track / at-risk / off-track) with a one-line reason, progress shown as measured done vs ≈ forecast, and critical-path slack.
    - **Main area, left 2/3:** team lanes. Each lane has avatar, current task, last activity time, agent session dots and capacity. Below the lanes sits a milestone timeline with a now-line.
    - **Main area, right 1/3:** up to 3 **Recommendation cards**, then a live activity feed. Example card: "Auth (HK-7) is on the critical path and has had no commits in 3h. Maya just finished her task and has an 82% match — reassign?" Each card has an impact line ("saves ≈2h on critical path") and Accept / Modify / Dismiss.
    - **Blockers strip:** blocked tasks with their blocked-by chain and owner.
    - States: a "Reconnecting…" stale indicator, and the moment right after a reassignment is accepted.
12. **Code (GitHub activity).**
    - Repo header showing the connected repo, default branch and App install status.
    - Filters: member, type, task, linked/unlinked.
    - An activity feed, a branches table (branch, author, linked task, ahead/behind, last commit, PR state) and a PR list.
    - An **unlinked activity queue** of suggested links with confidence → confirm / choose / ignore.
    - An unknown-author mapping card: "3 commits by `jdoe@laptop.local` — map to member".
    - The repo connect / create-repo flow.
13. **Agents.**
    - A grid of Claude Code session cards. Each shows member, repo/branch/cwd, linked task, status (active / idle / **awaiting input**, emphasised in warning / ended), a tool summary ("Edited 4 files, ran tests") and duration.
    - An opt-in setup panel with a one-line install command and privacy toggles: share prompts (off by default), file paths, tool names.
14. **Settings.**
    - Workspace, Members (roles, regenerate invite), Integrations (GitHub App, agent tokens, AI provider status), Privacy (retention, consent), Danger zone.

## States (show for every major view)

- **Loading:**
  - Skeletons that match the final layout.
  - AI operations show **staged progress with real stage names** and a cancel button, not spinners.
- **Empty:** one sentence, one primary action, and a small illustration built from UI primitives (no stock art).
- **Error:** what failed, whether data is safe, retry, and a copyable mono request-ID chip.
- **AI unavailable:** banner reading "AI planning is temporarily unavailable — you can continue with a template plan or manual tasks." The feature stays usable.

## Component sheet

Also deliver a component sheet with these components:
- Button (primary / secondary / ghost / danger)
- IconButton, Kbd, Tooltip, inputs, TagInput, Combobox, Slider, SegmentedControl, Toggle
- Table, Dialog, Popover, CommandPalette, Inspector
- Avatar / AvatarStack / MemberChip
- StatusBadge (task + agent)
- TaskCard / TaskRow / TaskId
- SkillChip (confirmed solid / inferred dashed + AI glyph + confidence / gap danger outline)
- EvidenceList, ScoreBreakdown, ExplanationCard, RecommendationCard, ActivityItem
- Countdown, MilestoneBar (measured solid + estimated hatched), DependencyGraph, CapabilityMatrix
- EmptyState / Skeleton / ErrorState / AIUnavailableState

## Accessibility

- WCAG 2.2 AA contrast.
- Visible 2px indigo focus ring with a 2px offset everywhere.
- Fully keyboard-operable, including moving board cards with `m` + arrow keys.
- Hit targets ≥24px on desktop and ≥44px on touch.
- A reduced-motion variant of the animations.

## Quality bar

Use realistic, specific data everywhere (real-looking SHAs, timestamps like "4m ago", hours, percentages). Make it pixel-tight, aligned to the grid, and dense but breathable. A judge watching a 3-minute demo should see the three differentiators within seconds:
- **capability-aware planning**
- **explainable assignment**
- **adaptive execution**
