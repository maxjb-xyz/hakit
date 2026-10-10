import { expect, it } from 'vitest';
import { explainAssignment, solveAssignments } from '@hakit/engine';
import { member, state, task } from '../../../../../../packages/engine/src/test-fixtures';
import { polishExplanations } from './explanations';
import type { LlmProvider } from './types';
const ctx = { memberName: () => 'Maya', skillName: (s: string) => s, taskKey: (s: string) => s };
it('polishes the batch in a fast call using only fact-preserving variants', async () => {
  const assignments = solveAssignments(state([task('t1')], [member('m1')]), {
    scope: 'all',
    respectLocks: true,
  }).assignments;
  const llm: LlmProvider = {
    name: 'gemini',
    generateStructured: async (req) => {
      expect(req.task).toBe('assign.explain');
      expect(req.tier).toBe('fast');
      expect(JSON.stringify(req.input)).not.toContain('Maya');
      return req.schema.parse({ choices: [{ index: 0, style: 'expanded' }] });
    },
  };
  const polished = await polishExplanations(assignments, ctx, llm);
  expect(polished[0]!.explanationSource).toBe('ai');
  expect(polished[0]!.explanation).toContain('Assigned to Maya.');
});
it('falls back for provider errors and incomplete or duplicate batch choices', async () => {
  const assignments = solveAssignments(state([task('t1')], [member('m1')]), {
    scope: 'all',
    respectLocks: true,
  }).assignments;
  for (const response of [
    null,
    { choices: [] },
    {
      choices: [
        { index: 0, style: 'compact' },
        { index: 0, style: 'compact' },
      ],
    },
  ]) {
    const llm: LlmProvider = {
      name: 'gemini',
      generateStructured: async (req) => {
        if (!response) throw new Error('down');
        return req.schema.parse(response);
      },
    };
    const [text] = await polishExplanations(assignments, ctx, llm);
    expect(text).toEqual({
      explanation: explainAssignment(
        { ...assignments[0]!, score: assignments[0]!.breakdown.total },
        assignments[0]!.alternatives,
        ctx,
      ),
      explanationSource: 'template',
    });
  }
});
