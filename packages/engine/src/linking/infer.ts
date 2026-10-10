/**
 * Inferred activity↔task linking (docs/AI.md §C.5 step 2). Pure: vectors come in, a scored decision comes out.
 * Embeddings are only inputs; the threshold, margin and assignee boost decide.
 */
import { cosine } from '../assign/solve';

export const LINK_MIN_SCORE = 0.55;
export const LINK_MIN_MARGIN = 0.05;
export const LINK_ASSIGNEE_BOOST = 0.1;

export interface LinkCandidate {
  taskId: string;
  embedding: number[];
  /** Users with an active assignment on the task. */
  assigneeIds: string[];
  /** Work in progress (`in_progress`/`in_review`/`blocked`), as opposed to merely open. */
  active: boolean;
}

export interface InferredLink {
  taskId: string;
  /** Boosted score clamped to [0, 1]. */
  confidence: number;
}

function pick(vector: number[], candidates: LinkCandidate[], authorId: string | null): InferredLink | null {
  const scored = candidates
    .filter((c) => c.embedding.length === vector.length)
    .map((c) => ({
      taskId: c.taskId,
      score:
        cosine(vector, c.embedding) +
        (authorId !== null && c.assigneeIds.includes(authorId) ? LINK_ASSIGNEE_BOOST : 0),
    }))
    .sort((a, b) => b.score - a.score || a.taskId.localeCompare(b.taskId));
  const [best, second] = scored;
  if (!best || best.score < LINK_MIN_SCORE) return null;
  if (second && best.score - second.score < LINK_MIN_MARGIN) return null;
  return { taskId: best.taskId, confidence: Math.min(1, Math.max(0, best.score)) };
}

/**
 * Score the author's active tasks first, then all open tasks; the assignee boost applies in both passes.
 * Returns null (`none`) unless the winner reaches LINK_MIN_SCORE and leads second place by LINK_MIN_MARGIN.
 */
export function inferTaskLink(
  vector: number[],
  candidates: LinkCandidate[],
  authorId: string | null,
): InferredLink | null {
  if (authorId !== null) {
    const own = candidates.filter((c) => c.active && c.assigneeIds.includes(authorId));
    const result = own.length ? pick(vector, own, authorId) : null;
    if (result) return result;
  }
  return pick(vector, candidates, authorId);
}
