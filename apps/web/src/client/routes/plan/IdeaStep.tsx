/**
 * S6 Idea (T-304): two entry cards ("I have an idea" / "Generate ideas"), then the ideas as comparison columns with
 * deterministic team fit, challenges, complexity, risks and "why this team". Pick, refine, regenerate one.
 * Generation and refinement stream over SSE (T-303 `generateIdeas` / `refineIdea`).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Idea } from '@hakit/contracts';
import { Button, cn } from '@hakit/ui';
import { api } from '../../lib/api';
import { qk } from '../../lib/query';
import { MeasuredBar } from '../mission-control/shared';
import { AiGlyph } from '../mission-control/RecommendationList';
import { EmptyBox, ErrorBox, LoadingBlocks, Pill } from '../page-states';
import { useIdeaStream } from './streams';
import { Field, SectionHead, StageProgress, pct } from './ui';

const REFINE_PRESETS = ['Make it simpler', 'More ML', 'Fit a sponsor challenge'];

export function IdeaStep(props: { pid: string; selectedId: string | null; onPick: (id: string) => void }) {
  const { pid } = props;
  const qc = useQueryClient();
  const ideas = useQuery({
    queryKey: qk('listIdeas', { pid }),
    queryFn: () => api('listIdeas', { params: { pid } }),
  });
  const [busy, setBusy] = useState<{ kind: 'generate' | 'refine' | 'regenerate'; ideaId?: string } | null>(
    null,
  );
  const gen = useIdeaStream(() => {
    setBusy(null);
    void qc.invalidateQueries({ queryKey: qk('listIdeas', { pid }) });
  });

  // Saved ideas plus anything streamed this session that the list hasn't caught up with yet.
  const saved = ideas.data ?? [];
  const all = [...saved.map((i) => gen.state.ideas.find((s) => s.id === i.id) ?? i)];
  for (const s of gen.state.ideas) if (!all.some((i) => i.id === s.id)) all.push(s);
  all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = props.selectedId ?? saved.find((i) => i.selected)?.id ?? null;

  const generate = (count: number, guidance?: string, kind: 'generate' | 'regenerate' = 'generate') => {
    setBusy({ kind });
    void gen.start('generateIdeas', { params: { pid }, body: { count, guidance: guidance || undefined } });
  };
  const refine = (idea: Idea, instruction: string) => {
    setBusy({ kind: 'refine', ideaId: idea.id });
    void gen.start('refineIdea', { params: { pid, iid: idea.id }, body: { instruction } });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <OwnIdeaCard pid={pid} onSaved={props.onPick} />
        <GenerateCard running={gen.state.running} onGenerate={(n, g) => generate(n, g)} />
      </div>

      {(gen.state.running || gen.state.error) && busy && (
        <StageProgress
          title={
            busy.kind === 'refine'
              ? 'Refining idea'
              : busy.kind === 'regenerate'
                ? 'Generating an alternative'
                : 'Generating ideas'
          }
          stages={gen.state.stage ? [gen.state.stage] : []}
          running={gen.state.running}
          onCancel={() => {
            gen.cancel();
            setBusy(null);
          }}
        />
      )}
      {gen.state.error && (
        <div role="alert" className="rounded-md border border-danger bg-surface px-4 py-3 text-body">
          <p className="text-default">
            AI ideas are unavailable right now ({gen.state.error}). You can still describe your own idea
            above.
          </p>
        </div>
      )}

      <section aria-labelledby="ideas-h" className="space-y-3">
        <SectionHead
          id="ideas-h"
          title="Ideas"
          meta={all.length ? `${all.length} · team fit is deterministic skill coverage` : undefined}
        />
        {ideas.isError ? (
          <ErrorBox what="ideas" error={ideas.error} onRetry={() => void ideas.refetch()} />
        ) : ideas.isPending ? (
          <LoadingBlocks label="Loading ideas" rows={2} />
        ) : all.length === 0 ? (
          <EmptyBox
            message="No ideas yet. Describe yours, or generate three that fit this team."
            action={
              <Button variant="primary" onClick={() => generate(3)} disabled={gen.state.running}>
                Generate 3 ideas
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {all.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                picked={idea.id === selected}
                busy={gen.state.running}
                refining={busy?.kind === 'refine' && busy.ideaId === idea.id}
                onPick={() => props.onPick(idea.id)}
                onRefine={(text) => refine(idea, text)}
                onRegenerate={() =>
                  generate(
                    1,
                    `Propose one alternative that is clearly different from "${idea.candidate.title}".`,
                    'regenerate',
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function OwnIdeaCard({ pid, onSaved }: { pid: string; onSaved: (id: string) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [pitch, setPitch] = useState('');
  const [notes, setNotes] = useState('');
  const submit = useMutation({
    mutationFn: () =>
      api('submitIdea', {
        params: { pid },
        body: { title: title.trim(), pitch: pitch.trim(), notes: notes.trim() || undefined },
      }),
    onSuccess: (idea) => {
      setTitle('');
      setPitch('');
      setNotes('');
      void qc.invalidateQueries({ queryKey: qk('listIdeas', { pid }) });
      onSaved(idea.id);
    },
  });
  return (
    <form
      className="space-y-3 rounded-md border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim() && pitch.trim()) submit.mutate();
      }}
    >
      <h2 className="text-body font-medium text-strong">I have an idea</h2>
      <Field label="Title" value={title} onChange={setTitle} required maxLength={120} />
      <Field label="Pitch" value={pitch} onChange={setPitch} multiline rows={2} required />
      <Field
        label="Notes or links"
        value={notes}
        onChange={setNotes}
        multiline
        rows={2}
        hint="Optional. Repos, docs, anything the planner should know."
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          loading={submit.isPending}
          disabled={!title.trim() || !pitch.trim()}
        >
          Use this idea
        </Button>
        {submit.isError && (
          <span role="alert" className="text-label text-danger">
            Couldn't save ({submit.error.message}). Your text is still here.
          </span>
        )}
      </div>
    </form>
  );
}

function GenerateCard(props: { running: boolean; onGenerate: (count: number, guidance: string) => void }) {
  const [guidance, setGuidance] = useState('');
  return (
    <form
      className="space-y-3 rounded-md border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        props.onGenerate(3, guidance.trim());
      }}
    >
      <h2 className="flex items-center gap-2 text-body font-medium text-strong">
        <AiGlyph /> Generate ideas
      </h2>
      <p className="text-body text-muted">
        Three ideas built around this team's skills, availability and the selected sponsor challenges.
      </p>
      <Field
        label="Guidance"
        value={guidance}
        onChange={setGuidance}
        multiline
        rows={3}
        maxLength={1000}
        hint="Optional, e.g. “something for students”, “use the Hugging Face challenge”."
      />
      <Button type="submit" variant="primary" loading={props.running}>
        Generate 3 ideas
      </Button>
    </form>
  );
}

function IdeaCard(props: {
  idea: Idea;
  picked: boolean;
  busy: boolean;
  refining: boolean;
  onPick: () => void;
  onRefine: (instruction: string) => void;
  onRegenerate: () => void;
}) {
  const { idea } = props;
  const c = idea.candidate;
  const [refineOpen, setRefineOpen] = useState(false);
  const [text, setText] = useState('');
  const ai = idea.source === 'ai';
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-md border bg-surface p-4',
        props.picked ? 'border-accent-500' : 'border-border',
        ai && 'border-l-2 border-l-ai',
        props.refining && 'opacity-60',
      )}
      aria-busy={props.refining || undefined}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 text-body-lg font-medium text-strong">{c.title}</h3>
        {props.picked ? (
          <Pill tone="accent">
            <span aria-hidden>✓</span> Picked
          </Pill>
        ) : (
          <Pill title={ai ? 'Generated by AI' : 'Written by your team'}>
            {ai && <AiGlyph />}
            {ai ? 'AI' : 'Yours'}
          </Pill>
        )}
      </div>
      <p className="text-body text-default">{c.pitch}</p>

      <div className="space-y-1">
        <div className="flex items-baseline justify-between text-label">
          <span className="text-muted">Team fit</span>
          <span className="text-strong">{pct(idea.teamFit)}</span>
        </div>
        <MeasuredBar value={idea.teamFit} label={`Team fit ${pct(idea.teamFit)}`} tone="accent" />
        <p className="text-caption text-subtle">Share of the stack's skills someone on the team has.</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-label">
        <div>
          <dt className="text-subtle">Complexity</dt>
          <dd className="text-default">
            {c.complexity}/5 <span className="text-subtle">(AI estimate)</span>
          </dd>
        </div>
        <div>
          <dt className="text-subtle">Challenges</dt>
          <dd className="text-default">{c.challengesAddressed.length || 'None'}</dd>
        </div>
      </dl>

      {c.challengesAddressed.length > 0 && (
        <ul className="space-y-1 text-label">
          {c.challengesAddressed.map((ch) => (
            <li key={ch.challengeKey} className="flex gap-2">
              <span className="shrink-0 font-mono text-subtle">{ch.challengeKey}</span>
              <span className="text-default">{ch.how}</span>
            </li>
          ))}
        </ul>
      )}

      {c.whyThisTeam.length > 0 && (
        <div>
          <h4 className="flex items-center gap-1.5 text-caption uppercase tracking-wide text-subtle">
            <AiGlyph /> Why this team
          </h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-label text-default">
            {c.whyThisTeam.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {c.risks.length > 0 && (
        <div>
          <h4 className="text-caption uppercase tracking-wide text-subtle">Risks</h4>
          <ul className="mt-1 space-y-0.5 text-label text-default">
            {c.risks.map((r) => (
              <li key={r} className="flex gap-1.5">
                <span aria-hidden className="text-warning">
                  ⚠
                </span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          variant={props.picked ? 'secondary' : 'primary'}
          aria-pressed={props.picked}
          onClick={props.onPick}
        >
          {props.picked ? 'Picked' : 'Pick'}
        </Button>
        <Button
          size="sm"
          aria-expanded={refineOpen}
          onClick={() => setRefineOpen((o) => !o)}
          disabled={props.busy}
        >
          Refine
        </Button>
        {ai && (
          <Button size="sm" variant="ghost" onClick={props.onRegenerate} disabled={props.busy}>
            Regenerate one
          </Button>
        )}
      </div>
      {refineOpen && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            props.onRefine(text.trim());
            setRefineOpen(false);
            setText('');
          }}
        >
          <div className="flex flex-wrap gap-1.5">
            {REFINE_PRESETS.map((p) => (
              <Button
                key={p}
                size="sm"
                variant="ghost"
                type="button"
                disabled={props.busy}
                onClick={() => {
                  props.onRefine(p);
                  setRefineOpen(false);
                }}
              >
                {p}
              </Button>
            ))}
          </div>
          <Field label="Or describe the change" value={text} onChange={setText} maxLength={1000} />
          <Button size="sm" type="submit" disabled={!text.trim() || props.busy}>
            Refine idea
          </Button>
        </form>
      )}
    </li>
  );
}
