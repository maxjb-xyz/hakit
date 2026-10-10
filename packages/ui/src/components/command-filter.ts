/** Pure ranking for the command palette (DESIGN §6 "Global"). No DOM, so it is unit-tested directly. */

export type Rankable = { label: string; keywords?: string };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');

/**
 * Rank of `item` for `query`, lower is better; `null` means no match.
 * Every query word must appear in the label or keywords. Ranks: 0 the label or its first word equals
 * the query (exact `HK-1` beats `HK-12`), 1 label starts with the query, 2 a label word starts with it,
 * 3 every word starts a word somewhere, 4 substring matches.
 */
export function rankCommand(item: Rankable, query: string): number | null {
  const q = norm(query.trim());
  if (!q) return 0;
  const label = norm(item.label);
  const hay = `${label} ${norm(item.keywords ?? '')}`;
  const words = q.split(/\s+/);
  if (!words.every((w) => hay.includes(w))) return null;
  if (label === q || label.split(/\s+/)[0] === q) return 0;
  if (label.startsWith(q)) return 1;
  if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(q)}`, 'u').test(label)) return 2;
  const starts = hay.split(/[^\p{L}\p{N}]+/u);
  if (words.every((w) => starts.some((s) => s.startsWith(w)))) return 3;
  return 4;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matching items, best first; ties keep their original order so groups stay predictable. */
export function filterCommands<T extends Rankable>(items: readonly T[], query: string): T[] {
  return items
    .map((item, i) => ({ item, i, r: rankCommand(item, query) }))
    .filter((x): x is { item: T; i: number; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.item);
}
