# Hakit — Design System & UX Specification

Status: **Reference.** Written as the hackathon plan and kept as the description of the system; where it and the code disagree, the code wins. Tokens below are the starting contract for `packages/ui`; Figma mirrors them (Figma is the exploration surface, code tokens are the source of truth — see §11).

---

## 1. Brand direction

**Personality:** a precise instrument, not a mascot. Calm under deadline pressure. Think flight-deck / terminal / IDE — dense, legible, trustworthy. The AI is present as *annotations and recommendations*, never as a glowing orb.

**Name & mark concepts** (pick one in Phase 1, decision D-9):
1. **"hk" monogram in a rounded square** cut by a single diagonal — reads as a keycap and as a "split" (work allocation). Works at 16px.
2. **Three stacked bars of different lengths** (team members → tasks) aligned on a shared baseline — a Gantt fragment. Doubles as a loading indicator.
3. **Bracket mark** `[h]` — a nod to code, a container for the team.

Wordmark: `hakit` lowercase, set in the display face, tight tracking (-2%).

**Voice:** short, declarative, specific. "Auth is blocking 3 tasks." not "Looks like there might be some blockers! 🚀". No emoji in system UI.

## 2. Color tokens

Dark-first. Light theme is P2 (tokens defined so it is cheap later). All values in OKLCH-ready hex; contrast checked against `bg/surface`.

### 2.1 Neutrals (near-OLED black)

Code (`packages/ui/src/tokens.css`) is the source of truth; values as of the polish pass. Elevation ladder, darkest first.

| Token | Hex | Use |
|---|---|---|
| `sunken` | `#000000` | Rail, wells, inputs (`field`) |
| `canvas` | `#060607` | Main pane background |
| `surface` | `#0B0B0D` | Cards, panels |
| `raised` | `#101012` | Popovers, inspector, selected nav row |
| `hover` | `#161619` | Hover fill |
| `pressed` | `#1B1B1F` | Active/pressed fill |
| `border` | `#1C1C20` | Hairline borders |
| `border-strong` | `#2A2A2F` | Control borders, popover edges |
| `disabled` | `#55555C` | Disabled text (not for content) |
| `faint` / `subtle` | `#808086` / `#85858C` | Quietest text / labels (≥4.5:1 on sunken→hover) |
| `muted` | `#A2A2A8` | Secondary text |
| `default` | `#C4C4C9` | Body text |
| `strong` | `#EDEDEF` | Headings, emphasis |

### 2.2 Accent (monochrome, decision D-9 revised)

No brand hue: a coloured accent reads as decoration. Emphasis comes from contrast, weight and the semantic colours below, never from a theme colour.

| Token | Hex | Use |
|---|---|---|
| `accent-400` | `#D4D4D8` | Accent text, focus rings, selected borders |
| `accent-500` | `#3F3F46` | Primary button fill (`text-strong` on it: 8.9:1) |
| `accent-600` | `#52525B` | Hover / pressed fill |
| `accent-a12` | `rgba(255,255,255,0.06)` | Selected row, arrival tint |

### 2.3 Semantic

| Token | Hex | Meaning |
|---|---|---|
| `success-500` | `#3FB97A` | Done, merged, on-track |
| `warning-500` | `#E5A93B` | At-risk, stalled, awaiting input |
| `danger-500` | `#E5534B` | Blocked, off-track, failed |
| `info-500` | `#4AA8D8` | Informational, in review |
| `ai-500` | `#B48CF2` | **AI-originated content marker** (inferred skill, suggested assignment, recommendation). Used only as a 2px left rule / small glyph, never as a fill or glow. |

### 2.4 Data/identity palette (member colors, 8 hues, equal luminance)

`#6E78FF #3FB97A #E5A93B #E5534B #4AA8D8 #B48CF2 #E07BB5 #9BB84A` — assigned deterministically by member join order; always paired with initials/avatar (never color-only).

### 2.5 Measured vs. estimated encoding (system-wide rule)

- **Measured**: solid fill, plain number. `12/20 tasks`.
- **Estimated**: hatched/striped fill or dashed outline, `≈` prefix, `ai-500` glyph if model-derived. `≈ 68%`.
- **Inferred link** (activity→task): dashed connector + "inferred" chip; **confirmed**: solid connector.

## 3. Typography

- **UI / body:** Inter (variable) — `font-feature-settings: "cv11","ss01","tnum"` in tables.
- **Display:** Inter Tight or *Geist* (D-9) for headings 20px+.
- **Mono:** JetBrains Mono / Geist Mono — SHAs, branch names, durations, countdown.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `display-lg` | 32 / 40 | 600 | Countdown, onboarding headline |
| `display-sm` | 24 / 32 | 600 | Page titles |
| `title` | 18 / 26 | 600 | Section headers, inspector title |
| `body-lg` | 15 / 22 | 400 | Plan prose, explanations |
| `body` | 13 / 20 | 400 | Default UI text (dense) |
| `label` | 12 / 16 | 500 | Form labels, column headers, chips |
| `caption` | 11 / 14 | 500, +2% tracking, uppercase optional | Meta, timestamps |
| `mono` | 12 / 18 | 450 | Code-ish data |

Base UI size is **13px** (IDE density). Minimum 11px; never below.

## 4. Spacing, radius, elevation, sizing

- **Spacing scale (4px base):** `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
- **Control heights:** `sm 24`, `md 28` (default), `lg 32`, `xl 40` (onboarding CTAs).
- **Radius:** `xs 4` (chips, inputs), `sm 6` (buttons, cards), `md 8` (panels, dialogs), `lg 12` (onboarding cards), `full` (avatars, status dots).
- **Elevation:** dark UIs use *luminance + border*, not shadow. `e0` canvas; `e1` surface + 1px `border/default`; `e2` raised + border + `0 8px 24px rgba(0,0,0,.45)`; `e3` dialog + scrim `rgba(0,0,0,.6)`.
- **Grid:** 12-col content grid, 24px gutters ≥1280px, 16px below. Sidebar 232px (collapsible to 56px rail). Inspector 400px (resizable 360–560).

## 5. Motion

- **Durations:** `--duration-instant 80ms` (hover, press), `--duration-fast 140ms` (popovers, menus, chips), `--duration-base 200ms` (panels, sheets, list entries), `--duration-slow 320ms` (plan reveal, reassignment). Legacy aliases `quick/standard/deliberate` remain.
- **Easing:** `ease-standard` `cubic-bezier(0.2,0,0,1)` (most UI), `ease-emphasized` `cubic-bezier(0.16,1,0.3,1)` (entering panels/popovers), `ease-exit` `cubic-bezier(0.4,0,1,1)` (leaving).
- **Utilities (tokens.css):** `animate-fade-in`, `animate-pop-in`, `animate-slide-in-right`, `animate-slide-up`, `animate-list-in` (stagger via `style={{'--i': n}}`), `animate-tick` / `<TickNumber>`, `press`, `skeleton`; patterns `row-interactive` + `row-link`, `field`, `interactive`.
- **Purposeful motion only:** (a) new activity slides into feed with a 1s accent tint fade; (b) reassignment animates the task card between lanes; (c) plan generation streams sections in; (d) countdown digits drop in subtly as they change (no flashing).
- `prefers-reduced-motion`: all animations and transitions are removed (`animation: none`), elements render in their final state.

## 6. Application shell & information architecture

```
┌────────┬────────────────────────────────────────────────┬──────────────┐
│ Rail   │ Top bar: Project / Page · status · ⌘K          │              │
│        ├────────────────────────────────────────────────┤  Inspector   │
│ ◉ MC   │                                                │  (contextual │
│ ▦ Plan │        Main view                               │   task/member│
│ ☰ Tasks│                                                │   /activity) │
│ ◎ Team │                                                │              │
│ ⑂ Code │                                                │              │
│ ⚙ Agents                                                │              │
│ ⚙ Set. │                                                │              │
└────────┴────────────────────────────────────────────────┴──────────────┘
```

**IA (routes):**
- `/` → redirect to last workspace's Mission Control
- `/login`, `/j/:inviteCode`, `/onboarding/*` (profile → skills → availability)
- `/w/:workspaceId/` → **Mission Control** (`/mc`)
- `/w/:id/team` (capability overview), `/w/:id/team/:memberId` (profile)
- `/w/:id/plan` (idea → constraints → plan review → assignment review; a stepper while `plan.status != accepted`)
- `/w/:id/tasks` (board / list / dependency graph toggle), `?task=HK-12` opens inspector
- `/w/:id/code` (GitHub activity, repo connection)
- `/w/:id/agents` (sessions)
- `/w/:id/settings` (workspace, integrations, members, privacy)

**Global:** `⌘K` command palette (jump to task/member, "reassign HK-12 to…", "generate ideas"). Keyboard: `j/k` navigate lists, `enter` open inspector, `esc` close, `a` assign, `s` status.

**Mobile (<768px):** rail becomes bottom tab bar (MC, Tasks, Team, Code, More); inspector becomes full-screen sheet; board becomes grouped list. Mission Control stacks: countdown → health → my task → feed.

## 7. Core components (`packages/ui`)

Built on **Radix UI primitives** (accessibility) + Tailwind v4 with CSS-variable tokens. No pre-styled kit; shadcn/ui may be used as copy-in scaffolding, restyled to tokens.

| Component | Notes |
|---|---|
| `Button` (primary/secondary/ghost/danger; sm/md/lg) | Loading state keeps width |
| `IconButton`, `Kbd`, `Tooltip` | Tooltip delay 400ms |
| `Input`, `Textarea`, `Select`, `Combobox`, `TagInput` | TagInput used for skills (taxonomy autocomplete) |
| `Slider`, `SegmentedControl`, `Toggle` | Skill level (1–5), availability |
| `Card`, `Panel`, `Section` | |
| `Table` / `DataList` | Sticky header, tabular numerals, row hover, virtualized >200 rows |
| `Dialog`, `Sheet`, `Popover`, `DropdownMenu`, `CommandPalette` | |
| `Inspector` | Right panel with header, tabs, sticky footer actions |
| `Avatar`, `AvatarStack`, `MemberChip` | Member color ring + initials fallback |
| `StatusDot` / `StatusBadge` | todo · in_progress · in_review · blocked · done; agent: active · idle · awaiting_input · ended |
| `TaskCard`, `TaskRow`, `TaskId` (`HK-12` mono) | |
| `SkillChip` | Variants: confirmed (solid), inferred (dashed + `ai` glyph + confidence), gap (danger outline) |
| `EvidenceList` | Source icon (repo, manifest, self, task), link, weight |
| `ScoreBreakdown` | Horizontal stacked bar: skill / workload / preference / dependency / availability — the core of explainability |
| `ExplanationCard` | ScoreBreakdown + 1–2 sentence rationale + alternatives (top 2) + Override |
| `RecommendationCard` | Type icon, headline, impact ("saves ≈2h on critical path"), Accept / Modify / Dismiss |
| `ActivityItem` | Commit/branch/PR/review/agent event, member, linked task (confirmed/inferred), relative time |
| `Countdown` | Mono, `display-lg`, turns warning <6h, danger <2h |
| `ProgressBar` / `MilestoneBar` | Measured solid + estimated hatched segments |
| `DependencyGraph` | DAG (dagre/elk layout via `@xyflow/react`), critical path highlighted accent |
| `CapabilityMatrix` | Members × skill categories heat grid with coverage gaps |
| `EmptyState`, `Skeleton`, `ErrorState`, `AIUnavailableState` | See §9 |

## 8. Screen specifications

Each screen lists: purpose · primary content · key interactions · states. Figma frames use the same numbering.

### S1. Authentication & onboarding
- **Purpose:** one click to value. Left: product statement + 3-step visual (Team → Plan → Ship). Right: "Continue with GitHub". Below: permission transparency ("We read your public repos to suggest skills. We never read private code without asking.").
- **Onboarding (3 steps, progress dots):** (1) Profile basics (name, role tag, timezone auto) → (2) **Skill import** (S3) → (3) Availability & preferences (timeline strip of the hackathon window; drag to mark sleep/unavailable; "want to learn" / "prefer to avoid" tag inputs).
- **States:** OAuth error, denied, rate-limited (retry with backoff copy).

### S2. Workspace & team creation
- Create: name, pick hackathon template (Knight Hacks 2026 preselected → fills deadline, tracks, sponsors, judging criteria) or custom (deadline picker).
- Invite panel: big copyable link + QR (for in-person), expiry, member list with live "joined" pulses (DO presence).
- **Empty state:** "Hakit works best with your whole team. Share this link."

### S3. GitHub connection & skill import
- Streaming checklist: "Reading 34 public repos → Detected 12 languages → Found 41 dependencies → Mapped to 18 skills".
- Results grouped by category; each `SkillChip` inferred with confidence; expand → `EvidenceList` ("React — 7 repos, `react` in package.json of 5, last used 2 months ago").
- Actions per skill: confirm, adjust level, remove. "Add skill" combobox. Bulk "Looks right".
- **Thin-profile state** (few repos): "We couldn't find much public work — add skills manually; you'll get learning-friendly tasks."

### S4. Member profile
- Header: avatar, name, GitHub handle, availability summary ("≈22h available"), current task.
- Tabs: **Skills** (confirmed / inferred / interests), **Evidence**, **Assignments** (current + history), **Activity**, **Agents**.
- Editable only by the member (others read-only; owner can edit availability).

### S5. Team capability overview
- `CapabilityMatrix` (members × categories), **coverage bar** per category (strong / adequate / thin / gap), **gaps & risks** callouts ("No one has deployed to Cloudflare before"), **overlaps** ("3 people strong in React"), availability curve across the event (stacked area of members' available hours).
- CTA: "Plan a project with this team".

### S6. Project creation & idea generation
- Two entry cards: "I have an idea" (textarea + optional links) / "Generate ideas".
- Generated ideas (3) as comparison columns: pitch, sponsor tracks hit, **team-fit score** (deterministic coverage %), complexity, risk, "why this team" bullets. Actions: pick, refine ("make it simpler", "more ML", free text), regenerate one.

### S7. Sponsor challenge & constraint selection
- Catalog of tracks/challenges (from seeded hackathon template) as selectable cards with requirement text, prize, required tech badges. Selected constraints become a pinned "Constraints" panel (required APIs, judging criteria weights, deadline, team hours).
- Live **constraint fit meter** against the current idea: ✓ satisfied, ⚠ risky (skill gap), ✗ conflicting.

### S8. AI-generated plan review
- Streaming sections: Summary → MVP scope (must/should/could with cut line) → Architecture (component diagram + stack table with "who knows this" avatars) → Milestones (timeline across hackathon window) → Tasks (grouped by milestone, with skills & estimates) → Risks.
- **Feasibility banner** (deterministic): "Plan needs ≈118h; team has ≈96h available → 3 'should' items moved below the cut line." 
- Every section editable inline; "Regenerate section with instruction". Version history (plan v1, v2…). Accept plan → S9.

### S9. Task allocation & assignment review
- Swimlanes per member (with capacity bar: assigned hours / available hours) + Unassigned column.
- Each card shows assignee match %; click → `ExplanationCard` in inspector (score breakdown, rationale, top-2 alternatives with deltas, Override / Lock).
- Global actions: "Rebalance" (re-run solver respecting locks), "Accept assignments".
- Warnings: overloaded member, unmet skill requirement, dependency chain owned by one person.

### S10. Task board & task inspector
- Views: Board (status columns), List (dense table), Graph (dependency DAG with critical path).
- Inspector tabs: Details (description, acceptance criteria, estimate, required skills), Assignment (explanation), Dependencies (blocks / blocked by), Activity (linked commits/PRs/agent sessions; confirmed vs inferred with "confirm link" action), History.
- Quick-create task (`c`), inline edit, drag between columns, `HK-12` copy-branch-name button (`hk-12-short-title`) — this drives confirmed linking.

### S11. Mission Control (hero screen)
Layout (desktop, 3 bands):
1. **Status band:** Countdown · Overall health (on-track/at-risk/off-track + one-line reason) · Progress (measured tasks done vs estimated completion forecast) · Critical-path slack.
2. **Main:** left 2/3 = **Team lanes** (each member: avatar, current task, last activity time, agent session dot(s), capacity); below = **Milestone timeline** with now-line. Right 1/3 = **Recommendations** (top, max 3) + **Live activity feed**.
3. **Blockers strip:** blocked tasks with blocked-by chain and owner.
- Real-time via WebSocket; stale indicator if disconnected (>10s).

### S12. GitHub development activity
- Repo header (connected repo, default branch, App install status). Filters: member, type, task, linked/unlinked.
- Feed + **Branches table** (branch, author, linked task, ahead/behind if available, last commit, PR state) + **PR list** (state, reviews, linked task).
- **Unlinked activity queue:** suggested task links (inferred, with confidence) → confirm / choose / ignore.
- Unknown authors: "3 commits by `jdoe@laptop.local` — map to member".

### S13. Coding-agent session overview
- Grid of session cards: member, agent type (Claude Code), repo/branch/cwd basename, linked task, status (active / idle / awaiting input — warning color / ended), last tool events summary ("Edited 4 files, ran tests"), duration.
- Opt-in setup panel: copy one-line install command with personal token; privacy toggles (share prompts: off by default; share file paths: on; share tool names: on).

### S14. Settings & integrations
- Workspace (name, deadline, hackathon template), Members (roles, remove, regenerate invite), Integrations (GitHub App install/repos, Agent tokens, AI providers status, ElevenLabs P2), Privacy (data retention, AI processing consent for private repo metadata), Danger zone.

## 9. States: empty, loading, error, AI-unavailable

- **Loading:** skeletons matching final layout; for AI operations show **staged progress** with real stage names (not spinners) and a cancel button. Never block the whole page.
- **Empty:** one sentence + one primary action + a small illustration built from UI primitives (no stock art).
- **Error:** what failed, whether data is safe, retry. Include request ID in a copyable mono chip.
- **AI unavailable:** banner "AI planning is temporarily unavailable — you can continue with a template plan or manual tasks." Feature still usable.
- **Real-time disconnected:** subtle top-bar chip "Reconnecting…" + last-updated timestamp; polling fallback after 15s.

## 10. Accessibility requirements

- WCAG 2.2 AA: text contrast ≥ 4.5:1 (body), ≥ 3:1 (large text, UI boundaries, focus rings). Verify `text/subtle` on `bg/surface` (target ≥ 4.5:1 — adjust `neutral-600` if needed).
- Visible focus ring: 2px `accent-500` + 2px offset on all interactive elements.
- Full keyboard operation incl. board drag (keyboard move via `m` + arrow keys / Radix-compatible dnd-kit).
- Status never conveyed by color alone (icon + label).
- Live regions: activity feed `aria-live="polite"` (throttled); recommendations announced once.
- Hit targets ≥ 24×24 (desktop) / 44×44 (touch).
- Respect reduced motion and OS contrast preferences.

## 11. Figma workflow (Phase 1)

1. **Day-0 (hours 0–4):** Figma file "Hakit DS" with variables mirroring §2–4 tokens (collections: color, space, radius, type). Wireframe S11 Mission Control, S9 Assignment review, S8 Plan review first (demo-critical).
2. **Hours 4–8:** hi-fi for S11, S9, S3; component specs for `ExplanationCard`, `RecommendationCard`, `SkillChip`, `ActivityItem`.
3. Tokens are **authored in code** (`packages/ui/tokens.css`) and kept in sync with Figma variables manually (or via Figma Variables export / Dev Mode MCP if available — see INTEGRATIONS §7). Code is the source of truth to avoid blocking engineers.
4. Engineers reference frames via Dev Mode links in task acceptance criteria.

## 12. Design acceptance checklist (applies to every feature PR)

- Uses tokens only (no raw hex / px outside the scale).
- Has empty, loading, error states.
- Labels measured vs. estimated and inferred vs. confirmed correctly.
- Keyboard-reachable; focus visible; no color-only status.
- Works at 375px and 1440px.
- Matches the Figma frame or deviates with a note.
