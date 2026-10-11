import { describe, expect, it } from 'vitest';
import { githubRedeliveryClient, pickRedeliveries, REDELIVERY_LIMITS, type HookDelivery } from './redelivery';

const now = new Date('2026-10-11T12:00:00Z');
const d = (id: number, guid: string, status: number, hoursAgo = 1): HookDelivery => ({
  id,
  guid,
  status_code: status,
  event: 'push',
  delivered_at: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(),
});

describe('pickRedeliveries', () => {
  it('redelivers failed GUIDs missing from the ledger', () => {
    expect(pickRedeliveries([d(1, 'a', 500), d(2, 'b', 202), d(3, 'c', 0)], new Set(), now)).toEqual([1, 3]);
  });
  it('skips GUIDs already in the ledger', () => {
    expect(pickRedeliveries([d(1, 'a', 500)], new Set(['a']), now)).toEqual([]);
  });
  it('skips GUIDs where any attempt succeeded and uses the newest failed attempt otherwise', () => {
    expect(
      pickRedeliveries([d(1, 'a', 500), d(4, 'a', 200), d(2, 'b', 500), d(5, 'b', 502)], new Set(), now),
    ).toEqual([5]);
  });
  it('ignores deliveries older than three days', () => {
    expect(pickRedeliveries([d(1, 'a', 500, 73)], new Set(), now)).toEqual([]);
  });
  it('caps redeliveries per sweep', () => {
    const many = Array.from({ length: 40 }, (_, i) => d(i + 1, `g${i}`, 500));
    expect(pickRedeliveries(many, new Set(), now)).toHaveLength(REDELIVERY_LIMITS.redeliveries);
  });
});

describe('githubRedeliveryClient', () => {
  it('follows the cursor and posts redelivery attempts', async () => {
    const calls: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/attempts')) return new Response(null, { status: 202 });
      const first = !url.includes('cursor=');
      return new Response(JSON.stringify([d(first ? 2 : 1, first ? 'b' : 'a', 500)]), {
        headers: first
          ? { link: '<https://api.github.com/app/hook/deliveries?per_page=100&cursor=abc>; rel="next"' }
          : {},
      });
    }) as typeof fetch;
    const client = githubRedeliveryClient(fetcher);
    const rows = await client.listDeliveries('jwt', new Date(now.getTime() - 72 * 3600_000));
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    await client.redeliver('jwt', 2);
    expect(calls).toEqual([
      'GET https://api.github.com/app/hook/deliveries?per_page=100',
      'GET https://api.github.com/app/hook/deliveries?per_page=100&cursor=abc',
      'POST https://api.github.com/app/hook/deliveries/2/attempts',
    ]);
  });
  it('throws on a failed list', async () => {
    const client = githubRedeliveryClient((async () => new Response('', { status: 401 })) as typeof fetch);
    await expect(client.listDeliveries('jwt', now)).rejects.toThrow('401');
  });
});
