/**
 * T-408: failed-delivery redelivery sweep. With the app JWT, list hook deliveries from the last 3 days and
 * request a redelivery for each GUID that never succeeded and is missing from our webhook_deliveries ledger.
 */
import { z } from 'zod';

export const HookDelivery = z.object({
  id: z.number().int(),
  guid: z.string().min(1),
  delivered_at: z.string(),
  status_code: z.number().int(),
  event: z.string(),
});
export type HookDelivery = z.infer<typeof HookDelivery>;

export const REDELIVERY_WINDOW_MS = 3 * 24 * 3600_000;
/** Bound GitHub calls per tick; anything left is picked up on the next sweep. */
export const REDELIVERY_LIMITS = { pages: 10, redeliveries: 25 } as const;

const ok = (status: number) => status >= 200 && status < 300;

/** Pure: the newest attempt id per GUID that should be redelivered. */
export function pickRedeliveries(deliveries: HookDelivery[], ledger: Set<string>, now: Date): number[] {
  const cutoff = now.getTime() - REDELIVERY_WINDOW_MS;
  const byGuid = new Map<string, { latest: HookDelivery; succeeded: boolean }>();
  for (const d of deliveries) {
    if (Date.parse(d.delivered_at) < cutoff) continue;
    const cur = byGuid.get(d.guid);
    if (!cur) byGuid.set(d.guid, { latest: d, succeeded: ok(d.status_code) });
    else {
      cur.succeeded ||= ok(d.status_code);
      if (d.id > cur.latest.id) cur.latest = d;
    }
  }
  const ids: number[] = [];
  for (const [guid, { latest, succeeded }] of byGuid)
    if (!succeeded && !ledger.has(guid)) ids.push(latest.id);
  return ids.sort((a, b) => a - b).slice(0, REDELIVERY_LIMITS.redeliveries);
}

export class GithubRedeliveryError extends Error {}

const nextCursor = (link: string | null) =>
  link?.match(/[?&]cursor=([^&>]+)[^>]*>;\s*rel="next"/)?.[1] ?? null;

export function githubRedeliveryClient(fetcher: typeof fetch = fetch) {
  const headers = (jwt: string) => ({
    authorization: `Bearer ${jwt}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'hakit',
  });
  return {
    /** Newest first; stops once a page reaches past `since`. */
    async listDeliveries(jwt: string, since: Date): Promise<HookDelivery[]> {
      const rows: HookDelivery[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < REDELIVERY_LIMITS.pages; page++) {
        const url = `https://api.github.com/app/hook/deliveries?per_page=100${cursor ? `&cursor=${cursor}` : ''}`;
        const res = await fetcher(url, { headers: headers(jwt) });
        if (!res.ok) throw new GithubRedeliveryError(`GitHub deliveries list failed (${res.status})`);
        const parsed = z.array(HookDelivery).safeParse(await res.json());
        if (!parsed.success)
          throw new GithubRedeliveryError('GitHub returned an invalid deliveries response');
        rows.push(...parsed.data);
        cursor = nextCursor(res.headers.get('link'));
        if (!cursor || parsed.data.some((d) => Date.parse(d.delivered_at) < since.getTime())) break;
      }
      return rows;
    },
    async redeliver(jwt: string, id: number): Promise<void> {
      const res = await fetcher(`https://api.github.com/app/hook/deliveries/${id}/attempts`, {
        method: 'POST',
        headers: headers(jwt),
      });
      if (!res.ok) throw new GithubRedeliveryError(`GitHub redelivery failed (${res.status})`);
    },
  };
}
export type GithubRedeliveryClient = ReturnType<typeof githubRedeliveryClient>;
