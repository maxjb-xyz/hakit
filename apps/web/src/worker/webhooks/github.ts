/**
 * POST /webhooks/github (INTEGRATIONS §1.5). Owner: GH (T-401).
 * Verify X-Hub-Signature-256 over the RAW body → dedupe X-GitHub-Delivery (webhook_deliveries) → enqueue → 202 in <1s.
 */
import { Hono } from 'hono';
import { JobMessage } from '@hakit/contracts';
import { schema } from '@hakit/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AppEnv } from '../lib/context';
import { HttpError } from '../lib/errors';

export const githubWebhook = new Hono<AppEnv>();

const headersSchema = z.object({ deliveryId: z.string().trim().min(1), event: z.string().trim().min(1) });
// Event-specific payload validation belongs to the normalization job (T-403).
const payloadSchema = z.record(z.string(), z.unknown());
const supportedEvents = new Set([
  'installation',
  'installation_repositories',
  'repository',
  'push',
  'create',
  'delete',
  'pull_request',
  'pull_request_review',
]);

githubWebhook.post('/webhooks/github', async (c) => {
  const raw = await c.req.text();
  const ok = await c.var.services.github.verifyWebhook(raw, c.req.header('x-hub-signature-256') ?? null);
  if (!ok) throw new HttpError(401, 'bad_signature', 'Invalid webhook signature');
  const headers = headersSchema.safeParse({
    deliveryId: c.req.header('x-github-delivery'),
    event: c.req.header('x-github-event'),
  });
  if (!headers.success) throw new HttpError(400, 'missing_headers', 'Missing GitHub delivery headers');
  const { deliveryId, event } = headers.data;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_payload', 'Invalid webhook JSON');
  }
  const payload = payloadSchema.safeParse(json);
  if (!payload.success) throw new HttpError(400, 'invalid_payload', 'Webhook payload must be an object');
  if (!supportedEvents.has(event)) return c.json({ accepted: true, ignored: true }, 202);
  if (c.var.mocks) return c.json({ accepted: true, deliveryId }, 202);
  const job = JobMessage.parse({ type: 'github.webhook', deliveryId, event, payload: payload.data });
  const db = c.var.db();
  const claimed = await db
    .insert(schema.webhookDeliveries)
    .values({ deliveryId, event })
    .onConflictDoNothing({ target: schema.webhookDeliveries.deliveryId })
    .returning({ deliveryId: schema.webhookDeliveries.deliveryId });
  const inserted = claimed.length > 0;
  if (inserted) {
    try {
      await c.env.JOBS.send(job);
    } catch (err) {
      // Release the claim so a redelivery (manual or the T-408 sweep) can retry. Accepted race: a redelivery
      // arriving in the few ms between claim and release is answered as a duplicate and must be resent by hand.
      await db
        .delete(schema.webhookDeliveries)
        .where(
          and(
            eq(schema.webhookDeliveries.deliveryId, deliveryId),
            isNull(schema.webhookDeliveries.processedAt),
          ),
        );
      throw err;
    }
  }
  if (!inserted) return c.json({ accepted: true, duplicate: true }, 200);
  return c.json({ accepted: true }, 202);
});
