import type { EngineMember, EngineTask, ProjectState } from './types';
export const member = (id: string, skill = 'react', hours = 20): EngineMember => ({
  userId: id,
  skills: [{ slug: skill, level: 4, confidence: 1, confirmed: true }],
  learningGoals: [],
  avoid: [],
  availability: [],
  availableHours: hours,
  profileEmbedding: null,
  interestsEmbedding: null,
});
export const task = (id: string, skill = 'react', hours = 2): EngineTask => ({
  id,
  key: `HK-${id.replace(/\D/g, '') || '1'}`,
  status: 'todo',
  priority: 'must',
  estimateHours: hours,
  requiredSkills: [{ skillSlug: skill, level: 3, weight: 1 }],
  startedAt: null,
  embedding: null,
});
export const state = (
  tasks = [task('t1')],
  members = [member('m1'), member('m2', 'python')],
): ProjectState => ({
  now: new Date('2026-10-10T00:00:00Z'),
  deadlineAt: new Date('2026-10-11T00:00:00Z'),
  submissionBufferHours: 3,
  tasks,
  members,
  dependencies: [],
  activeAssignments: [],
  lastActivityByTask: {},
  lastActivityByMember: {},
  taxonomy: new Map(),
});
