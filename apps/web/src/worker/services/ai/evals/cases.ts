/**
 * T-703 golden planning eval cases (docs/AI.md §3): five team fixtures × two ideas, plus a
 * sponsor-challenge case. Everything here is synthetic. `private` fields simulate personal data the
 * worker holds but must never send to a model or echo into a plan; the harness asserts that.
 */
import type { IdeaCandidate } from '@hakit/contracts';
import { SKILLS } from '@hakit/db/seed/skills';

export interface TeamFixture {
  id: string;
  label: string;
  members: Array<{
    /** Never sent to providers; only the M1..Mn alias is. */
    private: { name: string; email: string; githubLogin: string };
    skills: Array<{ slug: string; level: number }>;
    learningGoals: string[];
    avoid: string[];
    availableHours: number;
  }>;
}

export interface ChallengeFixture {
  key: string;
  sponsor: string;
  title: string;
  requirements: string[];
  requiredTech: string[];
}

export interface EvalCase {
  id: string;
  team: TeamFixture;
  idea: IdeaCandidate;
  challenges: ChallengeFixture[];
  hoursRemaining: number;
  /** Docs/AI.md §3 "coverage warnings when expected": the team lacks a core stack skill. */
  expectSkillGap: boolean;
}

export const ALLOWED_SKILL_SLUGS = SKILLS.map((s) => s.slug).sort();

const m = (
  name: string,
  skills: Record<string, number>,
  availableHours = 24,
  learningGoals: string[] = [],
): TeamFixture['members'][number] => ({
  private: {
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`,
    githubLogin: `${name.toLowerCase().replace(/\s+/g, '-')}-gh`,
  },
  skills: Object.entries(skills).map(([slug, level]) => ({ slug, level })),
  learningGoals,
  avoid: [],
  availableHours,
});

export const TEAMS: Record<string, TeamFixture> = {
  balancedWeb: {
    id: 'balanced-web',
    label: 'Balanced web team',
    members: [
      m('Avery Quill', { react: 4, typescript: 4, tailwindcss: 3 }),
      m('Bram Okafor', { python: 4, fastapi: 3, postgres: 3, 'gemini-api': 2 }),
      m('Cleo Marsh', { figma: 4, 'ux-design': 3, react: 2 }, 20, ['pytorch']),
    ],
  },
  mlHeavy: {
    id: 'ml-heavy',
    label: 'ML-heavy team',
    members: [
      m('Dara Venn', { python: 5, pytorch: 5, 'computer-vision': 4 }),
      m('Emeka Stroud', { python: 4, 'machine-learning': 4, fastapi: 3 }),
      m('Fen Ito', { python: 3, pandas: 4, react: 1 }, 20, ['react']),
    ],
  },
  firstTimers: {
    id: 'first-timers',
    label: 'First-timer-heavy team',
    members: [
      m('Gil Arden', { 'html-css': 2, javascript: 2 }, 18, ['react']),
      m('Hana Priest', { python: 1 }, 18, ['machine-learning']),
      m('Ivo Lark', { javascript: 1, figma: 2 }, 18),
      m('Juno Kade', { python: 3, git: 2 }, 22),
    ],
  },
  hardware: {
    id: 'hardware',
    label: 'Hardware team',
    members: [
      m('Kit Rowan', { arduino: 4, esp32: 4, 'embedded-c': 4 }),
      m('Lio Banks', { 'circuit-design': 4, 'pcb-design': 3, python: 2 }),
    ],
  },
  missingFrontend: {
    id: 'missing-frontend',
    label: 'Team with no frontend',
    members: [
      m('Mira Toft', { python: 4, fastapi: 4, postgres: 4 }),
      m('Nico Shale', { python: 4, pytorch: 3, 'computer-vision': 3, docker: 3 }),
    ],
  },
};

export const IDEAS: Record<'web' | 'ml', IdeaCandidate> = {
  web: {
    title: 'StudyLoop',
    pitch: 'A shared study planner that turns a syllabus into spaced-repetition sessions for a study group.',
    problem: 'Study groups lose track of who covers which topic and when to review it.',
    targetUser: 'University students preparing for exams together',
    coreFeatures: ['Syllabus import', 'Group session scheduler', 'Spaced-repetition reminders'],
    challengesAddressed: [],
    stack: [
      { component: 'Web app', tech: 'React', skillSlugs: ['react', 'typescript'] },
      { component: 'API', tech: 'FastAPI', skillSlugs: ['fastapi', 'python'] },
      { component: 'Database', tech: 'Postgres', skillSlugs: ['postgres'] },
    ],
    complexity: 2,
    risks: ['Syllabus formats vary widely'],
    whyThisTeam: ['M1 has strong React experience'],
  },
  ml: {
    title: 'BinSight',
    pitch: 'A camera-based classifier that tells students which campus bin an item belongs in.',
    problem: 'Recycling contamination on campus is high because sorting rules are confusing.',
    targetUser: 'Students at campus waste stations',
    coreFeatures: ['Item photo classification', 'Bin guidance screen', 'Contamination stats'],
    challengesAddressed: [],
    stack: [
      { component: 'Model', tech: 'PyTorch', skillSlugs: ['pytorch', 'computer-vision'] },
      { component: 'Inference API', tech: 'FastAPI', skillSlugs: ['fastapi', 'python'] },
    ],
    complexity: 3,
    risks: ['Training data for local bins is limited'],
    whyThisTeam: ['M1 has trained vision models before'],
  },
};

const sponsorChallenge: ChallengeFixture = {
  key: 'best-use-of-gemini',
  sponsor: 'Example Sponsor',
  title: 'Best use of a hosted LLM',
  requirements: ['Use the sponsor model API in a core user flow'],
  requiredTech: ['Gemini API'],
};

const expectations: Record<string, Record<'web' | 'ml', boolean>> = {
  // A gap is expected exactly when some idea stack skill is below level 2 on the team, which is
  // what both offline providers require (the template: first stack skill; scripted: all of them).
  'balanced-web': { web: false, ml: true },
  'ml-heavy': { web: true, ml: false },
  'first-timers': { web: true, ml: true },
  hardware: { web: true, ml: true },
  'missing-frontend': { web: true, ml: false },
};

export const CASES: EvalCase[] = [
  ...Object.values(TEAMS).flatMap((team) =>
    (['web', 'ml'] as const).map((kind) => ({
      id: `${team.id}×${kind}`,
      team,
      idea: IDEAS[kind],
      challenges: [],
      hoursRemaining: 36,
      expectSkillGap: expectations[team.id]![kind],
    })),
  ),
  {
    id: 'balanced-web×web+challenge',
    team: TEAMS.balancedWeb!,
    idea: {
      ...IDEAS.web,
      challengesAddressed: [
        { challengeKey: sponsorChallenge.key, how: 'Gemini drafts review questions from the syllabus' },
      ],
      stack: [
        ...IDEAS.web.stack,
        { component: 'Question generator', tech: 'Gemini API', skillSlugs: ['gemini-api'] },
      ],
    },
    challenges: [sponsorChallenge],
    hoursRemaining: 36,
    expectSkillGap: false,
  },
];
