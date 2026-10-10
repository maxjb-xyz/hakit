import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { handleQueue, handlers } from './index';
import { githubWebhookJob } from './github-webhook';
import { pushFixture } from '../services/github/fixtures.test-data';

afterEach(() => vi.restoreAllMocks());
const env = { HAKIT_MOCKS: '1', EMBED_DIM: '1024' } as Env;
function message(body: unknown) {
  return { body, attempts: 2, ack: vi.fn(), retry: vi.fn() };
}
const job = { type: 'github.webhook', deliveryId: 'delivery-1', event: 'push', payload: pushFixture };

describe('GitHub queue dispatch', () => {
  it('registers the real T-403 handler', () => {
    expect(handlers['github.webhook']).toBe(githubWebhookJob);
  });
  it('acknowledges a valid message after processing succeeds', async () => {
    const handler = vi.spyOn(handlers, 'github.webhook').mockResolvedValue();
    const msg = message(job);
    await handleQueue({ messages: [msg] } as unknown as MessageBatch<unknown>, env);
    expect(handler).toHaveBeenCalledWith(job, expect.objectContaining({ env }));
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });
  it('requests a retry instead of acknowledging failed processing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(handlers, 'github.webhook').mockRejectedValue(new Error('database unavailable'));
    const msg = message(job);
    await handleQueue({ messages: [msg] } as unknown as MessageBatch<unknown>, env);
    expect(msg.ack).not.toHaveBeenCalled();
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 4 });
  });
  it('acknowledges invalid job envelopes without sending them to the handler', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handler = vi.spyOn(handlers, 'github.webhook').mockResolvedValue();
    const msg = message({ type: 'github.webhook' });
    await handleQueue({ messages: [msg] } as unknown as MessageBatch<unknown>, env);
    expect(handler).not.toHaveBeenCalled();
    expect(msg.ack).toHaveBeenCalledTimes(1);
    expect(msg.retry).not.toHaveBeenCalled();
  });
});
