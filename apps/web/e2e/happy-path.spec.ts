/**
 * T-701 · E2E happy path: onboarding → plan → assign → webhook → Mission Control → accept a recommendation.
 *
 * Runs in two modes (support.ts): mock mode locally/CI, real mode against a preview with E2E_LOGIN_SECRET. In real
 * mode, steps whose handler belongs to an unmerged task (501 naming it) take the closest real fallback, or skip,
 * and say so as a `pending` annotation. The path tightens on its own as B/C/D merge; no edits needed here.
 */
import { randomUUID } from 'node:crypto';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { ids } from '@hakit/contracts/fixtures';
import type { Task } from '@hakit/contracts';
import { call, orFallback, orSkip, postWebhook, REAL, stream, testLogin } from './support';

test.describe.configure({ mode: 'serial' });

/** State handed from step to step. Mock mode uses the fixture ids the mock handlers accept. */
const run = {
  /** Unique per run so repeat runs on a shared preview DB never collide. */
  tag: randomUUID().slice(0, 8),
  wid: ids.workspace,
  pid: ids.project,
  ownerId: ids.users.priya,
  teammateId: ids.users.marcus,
  tasks: [] as Task[],
};
let owner: APIRequestContext;
let teammate: APIRequestContext;

test.beforeAll(async ({ baseURL }) => {
  owner = await request.newContext({ baseURL });
  teammate = await request.newContext({ baseURL });
  if (REAL) {
    const base = 900_000_000 + Math.floor(Math.random() * 90_000_000);
    run.ownerId = await testLogin(owner, base, `e2e-owner-${run.tag}`);
    run.teammateId = await testLogin(teammate, base + 1, `e2e-mate-${run.tag}`);
  }
});

test.afterAll(async () => {
  await owner?.dispose();
  await teammate?.dispose();
});

test('onboarding: workspace, invite, teammate joins, availability', async () => {
  const me = await call(owner, 'me');
  expect(me.user.id).toBe(run.ownerId);

  if (REAL) {
    const now = Date.now();
    const ws = await call(owner, 'createWorkspace', {
      body: {
        name: `E2E ${run.tag}`,
        startsAt: new Date(now - 3600_000).toISOString(),
        deadlineAt: new Date(now + 24 * 3600_000).toISOString(),
      },
    });
    run.wid = ws.id;
  }

  const invite = await call(owner, 'createInvite', { params: { wid: run.wid }, body: { maxUses: 1 } });
  const preview = await call(teammate, 'previewInvite', { params: { code: invite.code } });
  expect(preview.workspaceName.length).toBeGreaterThan(0);
  const joined = await call(teammate, 'acceptInvite', { params: { code: invite.code } });
  expect(joined.id).toBe(run.wid);

  const members = await call(owner, 'listMembers', { params: { wid: run.wid } });
  expect(members.map((m) => m.user.id)).toEqual(expect.arrayContaining([run.ownerId, run.teammateId]));

  await call(teammate, 'updateProfile', {
    params: { wid: run.wid, uid: run.teammateId },
    body: { learningGoals: [] },
  });
});

test('project: create and set constraints', async () => {
  const project = await call(owner, 'createProject', {
    params: { wid: run.wid },
    body: { name: `Orbit ${run.tag}`, pitch: 'E2E happy path project' },
  });
  if (REAL) run.pid = project.id;
  const saved = await call(owner, 'putConstraints', {
    params: { pid: run.pid },
    body: { constraints: [{ kind: 'required_tech', value: 'TypeScript' }] },
  });
  expect(saved).toBeTruthy();
});

test('plan: idea → generated plan → accept (mock provider)', async () => {
  run.tasks = await orFallback(
    async () => {
      const [idea] = await call(owner, 'listIdeas', { params: { pid: run.pid } });
      const ideaId =
        idea?.id ??
        (
          await call(owner, 'submitIdea', {
            params: { pid: run.pid },
            body: { title: 'Orbit', pitch: 'Hackathon team OS' },
          })
        ).id;
      const events = await stream(owner, 'generatePlan', { params: { pid: run.pid }, body: { ideaId } });
      const done = events.find((e) => e.type === 'done');
      expect(done, `plan stream ended without done: ${JSON.stringify(events.at(-1))}`).toBeTruthy();
      const planId = done!.planId as string;
      const plan = await call(owner, 'getPlan', { params: { pid: run.pid, planId } });
      expect(plan.id).toBe(planId);
      const board = await call(owner, 'acceptPlan', { params: { pid: run.pid, planId } });
      return board.tasks;
    },
    // Plan generation is IN's (T-303/T-305): build the board by hand so assignment onward still runs for real.
    async () => {
      const titles = ['Auth flow', 'Plan screen', 'Webhook ingest'];
      const tasks: Task[] = [];
      for (const title of titles) {
        tasks.push(
          await call(owner, 'createTask', {
            params: { pid: run.pid },
            body: { title, priority: 'must', estimateHours: 2 },
          }),
        );
      }
      await call(owner, 'putDependency', { params: { tid: tasks[1]!.id, depId: tasks[0]!.id }, body: {} });
      return tasks;
    },
  );
  expect(run.tasks.length).toBeGreaterThan(0);
});

test('assign: solve and accept, or assign manually', async () => {
  const board = await orFallback(
    async () => {
      const proposal = await call(owner, 'solveAssignments', { params: { pid: run.pid }, body: {} });
      expect(proposal.assignments.length).toBeGreaterThan(0);
      return call(owner, 'acceptAssignments', {
        params: { pid: run.pid },
        body: { assignmentIds: proposal.assignments.map((a) => a.id) },
      });
    },
    // Solver is IN's (T-309): the manual path is real and exercises the same accepted-assignment state.
    async () => {
      const [first, second] = run.tasks;
      await call(owner, 'manualAssign', { params: { tid: first!.id }, body: { userId: run.ownerId } });
      if (second) {
        await call(owner, 'manualAssign', { params: { tid: second.id }, body: { userId: run.teammateId } });
      }
      return call(owner, 'getBoard', { params: { pid: run.pid } });
    },
  );
  // Fixture boards mix statuses; a real board must hold the assignments just accepted.
  const accepted = board.assignments.filter((a) => !REAL || a.status === 'active');
  expect(accepted.length).toBeGreaterThan(0);
});

test('webhook: signed push is accepted once and reaches Mission Control', async () => {
  const repoId = Number(process.env.E2E_REPO_ID ?? 0);
  if (REAL && repoId) await call(owner, 'connectRepo', { params: { pid: run.pid }, body: { repoId } });

  const sha = randomUUID().replace(/-/g, '').padEnd(40, '0');
  const title = `HK e2e commit ${run.tag}`;
  const payload = {
    ref: 'refs/heads/main',
    created: false,
    deleted: false,
    repository: { id: repoId || 1 },
    sender: { id: 1, login: 'e2e-bot' },
    commits: [
      {
        id: sha,
        message: title,
        timestamp: new Date().toISOString(),
        url: `https://github.com/example/e2e/commit/${sha}`,
        author: { name: 'e2e-bot', username: 'e2e-bot' },
      },
    ],
  };
  const delivery = randomUUID();
  const first = await postWebhook(owner, 'push', payload, delivery);
  expect(first.status(), await first.text()).toBe(202);
  if (REAL) {
    // Dedupe by delivery id: GitHub redelivery must not enqueue twice.
    const again = await postWebhook(owner, 'push', payload, delivery);
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
  }

  const snapshot = await call(owner, 'missionControl', { params: { pid: run.pid } });
  expect(snapshot.progress.tasksTotal).toBeGreaterThan(0);
  if (!REAL) return;
  if (!repoId) {
    test.info().annotations.push({
      type: 'pending',
      description: 'activity → MC: set E2E_REPO_ID to a repo the preview GitHub App can connect',
    });
    return;
  }
  // The queue consumer stores the commit and broadcasts it; MC reads it back.
  await expect
    .poll(
      async () =>
        (await call(owner, 'missionControl', { params: { pid: run.pid } })).recentActivity.some(
          (e) => e.title === title,
        ),
      { timeout: 20_000 },
    )
    .toBe(true);
});

test('recommendation: accept the open one and see the board change', async () => {
  const recs = await orSkip(() => call(owner, 'listRecommendations', { params: { pid: run.pid } }));
  const open = recs.find((r) => r.status === 'open');
  test.skip(!open, 'no open recommendation (rules need elapsed time; seed a stalled task on the preview)');
  const board = await call(owner, 'acceptRecommendation', { params: { rid: open!.id }, body: {} });
  expect(board.projectId).toBe(run.pid);
  if (REAL) {
    const snapshot = await call(owner, 'missionControl', { params: { pid: run.pid } });
    expect(snapshot.openRecommendations.map((r) => r.id)).not.toContain(open!.id);
  }
});

test('UI: the signed-in shell renders Mission Control', async ({ browser, baseURL }) => {
  test.skip(
    REAL,
    'screens still read fixture ids (T-104/T-503); re-enable when MC takes the project from the URL',
  );
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState() });
  const page = await context.newPage();
  await page.goto(`/w/${run.wid}/mc`);
  await expect(page.getByRole('heading', { name: /Mission Control/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Primary' })).toBeVisible();
  // The placeholder fetched the snapshot through the typed client and it parsed.
  await expect(page.getByText('ok', { exact: true })).toBeVisible();
  await context.close();
});
