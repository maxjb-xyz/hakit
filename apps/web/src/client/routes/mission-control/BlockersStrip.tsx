/** S11 band 3: blocked tasks with their blocked-by chain and owners. */
import type { MissionControlSnapshot } from '@hakit/contracts';
import { MemberAvatar, StatusIcon } from '../tasks/meta';
import { Panel, TaskRef, ago, memberName, type Lookup } from './shared';

export function BlockersStrip({ s, lookup }: { s: MissionControlSnapshot; lookup: Lookup }) {
  return (
    <Panel title="Blockers" meta={s.blockers.length}>
      {s.blockers.length === 0 ? (
        <p className="flex items-center gap-2 px-4 py-4 text-body text-muted">
          <StatusIcon status="done" /> Nothing is blocked.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-3 p-3">
          {s.blockers.map((b) => {
            const owner = lookup.member(b.ownerId);
            return (
              <li
                key={b.taskId}
                className="flex min-w-0 flex-1 basis-72 items-start gap-3 rounded-sm border border-border bg-raised px-3 py-2.5"
              >
                <StatusIcon status="blocked" className="mt-1" />
                <div className="min-w-0 flex-1">
                  <TaskRef taskId={b.taskId} lookup={lookup} withTitle className="max-w-full text-body" />
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-label text-muted">
                    Blocked by
                    {b.blockedByTaskIds.map((id) => {
                      const dep = lookup.task(id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1">
                          <TaskRef taskId={id} lookup={lookup} />
                          {dep?.assigneeId && (
                            <span className="text-subtle">({memberName(lookup.member(dep.assigneeId))})</span>
                          )}
                        </span>
                      );
                    })}
                    {b.since && <span className="text-subtle">· {ago(b.since, lookup.now)}</span>}
                  </p>
                </div>
                <MemberAvatar member={owner} />
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
