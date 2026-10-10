/**
 * Confirmed activity↔task linking by explicit reference (docs/AI.md §C.5 step 1). Implemented (shared by GH + IN).
 * Branch: `hk-12-short-title` (also feature/hk-12). Commit/PR text: `HK-12` anywhere (case-insensitive).
 */
const BRANCH_RE = /(?:^|[/_-])hk-(\d+)(?=$|[/_-])/i;
const TEXT_RE = /\bHK-(\d+)\b/gi;

export function taskNumberFromBranch(ref: string | null | undefined): number | null {
  if (!ref) return null;
  const m = ref.replace(/^refs\/heads\//, '').match(BRANCH_RE);
  return m ? Number(m[1]) : null;
}

export function taskNumbersFromText(text: string | null | undefined): number[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(TEXT_RE)].map((m) => Number(m[1])))];
}

/** Branch name suggested by the "copy branch name" button (T-312). */
export function branchNameFor(taskNumber: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return slug ? `hk-${taskNumber}-${slug}` : `hk-${taskNumber}`;
}
