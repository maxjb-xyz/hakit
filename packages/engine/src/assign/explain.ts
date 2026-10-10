/** Fact-only deterministic templates: no model or clock required. */
import type { ReasonCode } from '@hakit/contracts';
export interface ExplainContext {
  memberName: (userId: string) => string;
  taskKey: (taskId: string) => string;
  skillName: (slug: string) => string;
}
export function explainAssignment(
  chosen: { userId: string; reasonCodes: ReasonCode[]; score: number },
  alternatives: Array<{ userId: string; delta: number; reasonCodes: ReasonCode[] }>,
  ctx: ExplainContext,
): string {
  const render = (reason: ReasonCode) => {
    const [code, arg = ''] = reason.split(':');
    const skill = () => ctx.skillName(arg);
    switch (code) {
      case 'STRONG_SKILL_MATCH':
        return `meets the ${skill()} requirement`;
      case 'PARTIAL_SKILL_MATCH':
        return `partially meets the ${skill()} requirement`;
      case 'RELATED_SKILL':
        return `has related experience for ${skill()}`;
      case 'SEMANTIC_MATCH':
        return 'has relevant project experience';
      case 'BALANCES_LOAD':
        return 'helps balance the workload';
      case 'NEAR_CAPACITY':
        return 'is near capacity';
      case 'LEARNING_GOAL':
        return `wants to learn ${skill()}`;
      case 'AVOIDED_SKILL':
        return `prefers to avoid ${skill()} (review this assignment)`;
      case 'OWNS_PREDECESSOR':
        return `owns prerequisite ${arg.startsWith('HK-') ? arg : ctx.taskKey(arg)}`;
      case 'OWNS_SUCCESSOR':
        return `owns dependent task ${arg.startsWith('HK-') ? arg : ctx.taskKey(arg)}`;
      case 'AVAILABLE_AT_START':
        return 'is available at the estimated start';
      case 'UNAVAILABLE_AT_START':
        return 'is unavailable at the estimated start';
      case 'CRITICAL_PATH':
        return 'is assigned critical path work';
      case 'ONLY_QUALIFIED':
        return 'is the only member meeting all skill requirements';
      case 'OVERRIDE_LOCKED':
        return 'has a preserved locked assignment';
      case 'MANUAL':
        return 'was assigned manually';
      default:
        return '';
    }
  };
  const facts = [...new Set(chosen.reasonCodes.map(render).filter(Boolean))];
  const sentence = `${ctx.memberName(chosen.userId)}: ${facts.join('; ') || 'highest feasible score'} (score ${chosen.score.toFixed(2)}).`;
  const others = alternatives
    .slice(0, 2)
    .map(
      (a) =>
        `${ctx.memberName(a.userId)} (${a.delta >= 0 ? '+' : ''}${a.delta.toFixed(2)} relative score${a.reasonCodes.length ? `; ${[...new Set(a.reasonCodes.map(render).filter(Boolean))].join('; ')}` : ''})`,
    );
  return sentence + (others.length ? ` Alternatives: ${others.join(' / ')}.` : '');
}
