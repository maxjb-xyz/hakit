import { z } from 'zod';
import { explainAssignment, type ExplainContext, type SolvedAssignment } from '@hakit/engine';
import type { LlmProvider } from './types';

/** Optional batch polish selects only fact-preserving prose variants; free-form additions are impossible. */
export async function polishExplanations(
  assignments: SolvedAssignment[],
  ctx: ExplainContext,
  llm: LlmProvider,
) {
  const templates = assignments.map((a) =>
    explainAssignment({ ...a, score: a.breakdown.total }, a.alternatives, ctx),
  );
  if (!assignments.length) return [];
  const Schema = z.object({
    choices: z.array(
      z.object({
        index: z
          .number()
          .int()
          .min(0)
          .max(assignments.length - 1),
        style: z.enum(['compact', 'expanded']),
      }),
    ),
  });
  try {
    const result = Schema.parse(
      await llm.generateStructured({
        task: 'assign.explain',
        tier: 'fast',
        schema: Schema,
        system:
          'Select compact or expanded phrasing for each assignment, based only on supplied facts. Return one choice per index. Do not add facts, numbers, or people.',
        input: assignments.map((a, index) => ({
          index,
          reasonCodes: a.reasonCodes,
          score: a.breakdown.total,
          alternativeDeltas: a.alternatives.map((alt) => alt.delta),
        })),
      }),
    );
    if (
      result.choices.length !== assignments.length ||
      new Set(result.choices.map((c) => c.index)).size !== assignments.length
    )
      throw new Error('Invalid explanation batch');
    return templates.map((text, index) => {
      const choice = result.choices.find((c) => c.index === index)!;
      const name = ctx.memberName(assignments[index]!.userId);
      return {
        explanation:
          choice.style === 'expanded' ? `Assigned to ${name}. Reasons: ${text.slice(name.length + 2)}` : text,
        explanationSource: 'ai' as const,
      };
    });
  } catch {
    return templates.map((explanation) => ({ explanation, explanationSource: 'template' as const }));
  }
}
