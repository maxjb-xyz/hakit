import type { EvalCase } from './cases';

/** Reject typos/empty selections before invoking a provider: zero cases cannot count as success. */
export function selectCases(cases: EvalCase[], selection?: string): EvalCase[] {
  if (!cases.length) throw new Error('No planning evaluation cases are configured');
  if (new Set(cases.map((c) => c.id)).size !== cases.length)
    throw new Error('Duplicate planning evaluation case IDs');
  if (selection === undefined || selection.trim() === 'all') return cases;
  const ids = [
    ...new Set(
      selection
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ];
  if (!ids.length) throw new Error('EVAL_CASES must select at least one case');
  const unknown = ids.filter((id) => !cases.some((c) => c.id === id));
  if (unknown.length) throw new Error('EVAL_CASES contains unknown case IDs; check the documented case list');
  return cases.filter((c) => ids.includes(c.id));
}
