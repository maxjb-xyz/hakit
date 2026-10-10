import { beforeAll, expect, it } from 'vitest';
import { schema } from '@hakit/db';
import { JobAccepted, JobMessage } from '@hakit/contracts';
import { createHarness } from '../test/harness';
let h: Awaited<ReturnType<typeof createHarness>>, uid: string, token: string, wid: string;
beforeAll(async () => {
  h = await createHarness();
  const user = await h.signIn(204);
  uid = user.id;
  token = user.token;
  const [workspace] = await h.db
    .insert(schema.workspaces)
    .values({ name: 'Team', slug: 'import-team', createdBy: uid, deadlineAt: new Date('2099-01-01') })
    .returning();
  wid = workspace!.id;
  await h.db
    .insert(schema.memberships)
    .values({ workspaceId: wid, userId: uid, role: 'owner', colorIndex: 0 });
}, 30000);
it('enqueues only the signed-in member and returns the accepted contract', async () => {
  const response = await h.call(`/w/${wid}/members/me/skills/import`, {
    method: 'POST',
    token,
    json: { userId: 'someone-else' },
  });
  expect(response.status).toBe(200);
  expect(JobAccepted.safeParse(await response.json()).success).toBe(true);
  expect(h.jobs.send).toHaveBeenCalledWith(
    JobMessage.parse({
      type: 'skills.import',
      workspaceId: wid,
      userId: uid,
    }),
  );
});
it('rejects anonymous requests', async () => {
  expect((await h.call(`/w/${wid}/members/me/skills/import`, { method: 'POST', json: {} })).status).toBe(401);
});
it('rejects nonmembers', async () => {
  const other = await h.signIn(205);
  expect(
    (await h.call(`/w/${wid}/members/me/skills/import`, { method: 'POST', token: other.token, json: {} }))
      .status,
  ).toBe(404);
});
it('requires CSRF protection', async () => {
  expect(
    (await h.call(`/w/${wid}/members/me/skills/import`, { method: 'POST', token, json: {}, csrf: false }))
      .status,
  ).toBe(403);
});
