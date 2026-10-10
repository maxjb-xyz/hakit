/**
 * POST /webhooks/github (INTEGRATIONS §1.5). Owner: GH (T-401).
 * Verify X-Hub-Signature-256 over the RAW body → dedupe X-GitHub-Delivery (webhook_deliveries) → enqueue → 202 in <1s.
 */
import { Hono } from 'hono';
import type { AppEnv } from '../lib/context';
import { HttpError } from '../lib/errors';

export const githubWebhook = new Hono<AppEnv>();

githubWebhook.post('/webhooks/github', async (c) => {
  const raw = await c.req.text();
  const ok = await c.var.services.github.verifyWebhook(raw, c.req.header('x-hub-signature-256') ?? null);
  if (!ok) throw new HttpError(401, 'bad_signature', 'Invalid webhook signature');
  const deliveryId = c.req.header('x-github-delivery');
  const event = c.req.header('x-github-event');
  if (!deliveryId || !event) throw new HttpError(400, 'missing_headers', 'Missing GitHub delivery headers');
  if (c.var.mocks) return c.json({ accepted: true, deliveryId }, 202);
  // TODO(T-401): INSERT webhook_deliveries ON CONFLICT DO NOTHING; if duplicate → 200.
  await c.env.JOBS.send({ type: 'github.webhook', deliveryId, event, payload: JSON.parse(raw) });
  return c.json({ accepted: true }, 202);
});
