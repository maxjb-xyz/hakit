/**
 * Plan materialization (T-308): a PlanDocument becomes milestones, HK-numbered tasks and dependencies in one
 * transaction. Pure planning of rows lives in `planRows` so it can be unit-tested without a database.
 */
import type { PlanDocument, TaskRequiredSkill } from '@hakit/contracts';

export interface PlannedRows {
  milestones: { key: string; title: string; ordinal: number; targetAt: Date | null }[];
  tasks: {
    key: string;
    number: number;
    milestoneKey: string | null;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    priority: 'must' | 'should' | 'could';
    estimateHours: number;
    requiredSkills: TaskRequiredSkill[];
  }[];
  /** [taskKey, dependsOnKey]; unknown keys and self-edges are dropped (validators flag them upstream). */
  dependencies: [string, string][];
}

export function planRows(doc: PlanDocument, firstNumber: number, eventStart: Date | null): PlannedRows {
  const epicMilestone = new Map(doc.outline.epics.map((e) => [e.key, e.milestoneKey]));
  const milestoneKeys = new Set(doc.outline.milestones.map((m) => m.key));
  const taskKeys = new Set(doc.tasks.map((t) => t.key));
  return {
    milestones: doc.outline.milestones.map((m, i) => ({
      key: m.key,
      title: m.title,
      ordinal: i + 1,
      targetAt: eventStart ? new Date(eventStart.getTime() + m.targetHour * 3_600_000) : null,
    })),
    tasks: doc.tasks.map((t, i) => {
      const mk = epicMilestone.get(t.epicKey) ?? null;
      return {
        key: t.key,
        number: firstNumber + i,
        milestoneKey: mk && milestoneKeys.has(mk) ? mk : null,
        title: t.title.slice(0, 200),
        description: t.description,
        acceptanceCriteria: t.acceptanceCriteria,
        priority: t.priority,
        estimateHours: t.estimateHours,
        requiredSkills: t.requiredSkills.map((s) => ({
          skillSlug: s.slug,
          level: s.level,
          weight: s.weight,
        })),
      };
    }),
    dependencies: [
      ...new Map(
        doc.tasks.flatMap((t) =>
          t.dependsOn
            .filter((d) => d !== t.key && taskKeys.has(d))
            .map((d) => [`${t.key}>${d}`, [t.key, d] as [string, string]]),
        ),
      ).values(),
    ],
  };
}
