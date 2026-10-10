/** Board, tasks, dependencies, assignment. Owners: PL (CRUD), IN (solver/explanations). */
import { Hono } from 'hono';
import * as fx from '@hakit/contracts/fixtures';
import type { AppEnv } from '../lib/context';
import { route } from '../lib/route';
import { mockOr } from '../lib/mock';
import { notFound } from '../lib/errors';

export const tasks = new Hono<AppEnv>();

const findTask = (tid: string) =>
  fx.tasks.find((t) => t.id === tid) ??
  (() => {
    throw notFound('Task');
  })();

route(tasks, 'getBoard', ({ c }) => mockOr(c, 'T-312', () => fx.board));
route(tasks, 'createTask', ({ c, body }) =>
  mockOr(c, 'T-312', () => ({
    ...fx.tasks[0]!,
    ...body,
    id: fx.ids.task(99),
    key: 'HK-99',
    status: 'todo' as const,
    assigneeId: null,
    startedAt: null,
    completedAt: null,
  })),
);
route(tasks, 'updateTask', ({ c, params, body }) =>
  mockOr(c, 'T-312', () => ({ ...findTask(params.tid), ...body })),
);
route(tasks, 'putDependency', ({ c }) => mockOr(c, 'T-312', () => ({ ok: true as const })));
route(tasks, 'deleteDependency', ({ c }) => mockOr(c, 'T-312', () => ({ ok: true as const })));

route(tasks, 'solveAssignments', ({ c }) =>
  mockOr(c, 'T-309', () => ({
    assignments: fx.assignments.map((a) => ({ ...a, status: 'proposed' as const })),
    unassignedTaskIds: [],
    warnings: [],
    load: fx.missionControl.lanes.map((l) => ({
      userId: l.userId,
      assignedHours: l.assignedHours,
      availableHours: l.availableHours,
    })),
  })),
);
route(tasks, 'acceptAssignments', ({ c }) => mockOr(c, 'T-311', () => fx.board));
route(tasks, 'manualAssign', ({ c, params, body }) =>
  mockOr(c, 'T-311', () => {
    const base = fx.assignments.find((a) => a.taskId === params.tid) ?? fx.assignments[0]!;
    return {
      ...base,
      taskId: params.tid,
      userId: body.userId,
      source: 'manual' as const,
      locked: body.lock,
      reasonCodes: ['MANUAL'],
    };
  }),
);
route(tasks, 'explainAssignment', ({ c, params }) =>
  mockOr(c, 'T-310', () => {
    const assignment = fx.assignments.find((a) => a.taskId === params.tid);
    if (!assignment) throw notFound('Assignment');
    return { assignment, solverPick: null };
  }),
);
