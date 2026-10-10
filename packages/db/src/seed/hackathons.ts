/**
 * Knight Hacks IX (Oct 9–11, 2026). Event facts confirmed from 2026.knighthacks.org (see docs/INTEGRATIONS.md §0).
 * Sponsor CHALLENGES are placeholders (verified=false) until checked against the Devpost Prizes tab.
 */
export const HACKATHONS = [
  {
    slug: 'knight-hacks-ix',
    name: 'Knight Hacks IX',
    startsAt: '2026-10-09T21:00:00-04:00',
    endsAt: '2026-10-11T09:00:00-04:00',
    timezone: 'America/New_York',
    sourceUrl: 'https://2026.knighthacks.org/',
    tracks: [
      { key: 'hello-world', name: 'Hello World' },
      { key: 'ai-ml', name: 'Artificial Intelligence / Machine Learning' },
      { key: 'app-dev', name: 'App Development' },
      { key: 'game-dev', name: 'Game Development' },
      { key: 'embedded', name: 'Embedded Software' },
    ],
    judgingCriteria: [
      { key: 'general', name: 'General + sponsor judges; rubric in Hackers Guide (unverified)' },
    ],
    challenges: [
      {
        key: 'hugging-face',
        sponsor: 'Hugging Face',
        title: 'Hugging Face challenge (unverified)',
        requirements: ['Use open-weight models from the Hugging Face Hub'],
        requiredTech: ['huggingface-transformers'],
      },
      {
        key: 'amd',
        sponsor: 'AMD',
        title: 'Best use of AMD Hardware/Software (2025 precedent, unverified)',
        requirements: ['Run a meaningful workload on AMD hardware/software'],
        requiredTech: ['rocm'],
      },
      {
        key: 'github',
        sponsor: 'GitHub',
        title: 'GitHub (unverified)',
        requirements: [],
        requiredTech: ['github-actions'],
      },
      {
        key: 'figma',
        sponsor: 'Figma',
        title: 'Figma (unverified)',
        requirements: [],
        requiredTech: ['figma'],
      },
      {
        key: 'mlh-gemini',
        sponsor: 'MLH',
        title: 'Best Use of Gemini API (MLH, unverified)',
        requirements: ['Use the Gemini API'],
        requiredTech: ['gemini-api'],
      },
      {
        key: 'mlh-elevenlabs',
        sponsor: 'MLH',
        title: 'Best Use of ElevenLabs (MLH, unverified)',
        requirements: ['Use ElevenLabs'],
        requiredTech: ['speech'],
      },
    ],
  },
] as const;
