/**
 * SSE helpers for S6 (ideas) and S8 (plan generation, T-305). Every event is re-validated with the contract schema
 * (CLAUDE.md: validate every boundary); the reducers are pure and unit-tested.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IdeaStreamEvent,
  PlanStreamEvent,
  type Feasibility,
  type Idea,
  type PlanOutline,
  type TaskDraft,
} from '@hakit/contracts';
import { stream } from '../../lib/api';

/* ------------------------------- plan generation ------------------------------- */

export type PlanStage = Extract<PlanStreamEvent, { type: 'stage' }>['stage'];
export interface PlanStreamState {
  running: boolean;
  /** Stages seen so far, in order, with the server's message (DESIGN §9: real stage names, not spinners). */
  stages: { stage: PlanStage; message: string }[];
  outline: PlanOutline | null;
  tasksByEpic: Record<string, TaskDraft[]>;
  feasibility: Feasibility | null;
  planId: string | null;
  error: { code: string; message: string; fallbackAvailable: boolean } | null;
}
export const idlePlanStream: PlanStreamState = {
  running: false,
  stages: [],
  outline: null,
  tasksByEpic: {},
  feasibility: null,
  planId: null,
  error: null,
};

export function planStreamReducer(s: PlanStreamState, e: PlanStreamEvent): PlanStreamState {
  switch (e.type) {
    case 'stage':
      return { ...s, stages: [...s.stages, { stage: e.stage, message: e.message }] };
    case 'outline':
      return { ...s, outline: e.outline };
    case 'epic_tasks':
      return { ...s, tasksByEpic: { ...s.tasksByEpic, [e.epicKey]: e.tasks } };
    case 'validation':
      return { ...s, feasibility: e.feasibility };
    case 'done':
      return { ...s, running: false, planId: e.planId };
    case 'error':
      return {
        ...s,
        running: false,
        error: { code: e.code, message: e.message, fallbackAvailable: e.fallbackAvailable },
      };
  }
}

/* ------------------------------------ ideas ------------------------------------ */

export interface IdeaStreamState {
  running: boolean;
  stage: string | null;
  ideas: Idea[];
  error: string | null;
}
export const idleIdeaStream: IdeaStreamState = { running: false, stage: null, ideas: [], error: null };

export function ideaStreamReducer(s: IdeaStreamState, e: IdeaStreamEvent): IdeaStreamState {
  switch (e.type) {
    case 'stage':
      return { ...s, stage: e.message };
    case 'idea':
      return { ...s, ideas: [...s.ideas.filter((i) => i.id !== e.idea.id), e.idea] };
    case 'done':
      return { ...s, running: false, stage: null };
    case 'error':
      return { ...s, running: false, stage: null, error: e.message };
  }
}

/* ------------------------------------ hook ------------------------------------ */

type Schema<E> = { safeParse: (v: unknown) => { success: true; data: E } | { success: false } };

/**
 * Runs one SSE request at a time; a new `start` or `cancel` aborts the previous one. `onEnd` fires once per run
 * that finished on its own (not cancelled), with the final state.
 */
export function useSseRun<E, S extends { running: boolean }>(opts: {
  idle: S;
  schema: Schema<E>;
  reduce: (s: S, e: E) => S;
  onError: (s: S, message: string) => S;
  onEnd?: (s: S) => void;
}) {
  const [state, setState] = useState(opts.idle);
  const ctrl = useRef<AbortController | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  useEffect(() => () => ctrl.current?.abort(), []);

  const start = useCallback(
    async (name: Parameters<typeof stream>[0], args: { params: Record<string, string>; body: unknown }) => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      const { idle, schema, reduce, onError } = optsRef.current;
      let s: S = { ...idle, running: true };
      setState(s);
      try {
        for await (const raw of stream<unknown>(name, { ...args, signal: c.signal })) {
          const parsed = schema.safeParse(raw);
          if (!parsed.success) continue; // Unknown or malformed event: ignore rather than crash the screen.
          s = reduce(s, parsed.data);
          setState(s);
        }
        if (s.running) s = onError(s, 'The stream ended early. Nothing was saved from this run.');
      } catch (err) {
        if (c.signal.aborted) return;
        s = onError(s, err instanceof Error ? err.message : 'Request failed');
      }
      if (c.signal.aborted) return;
      setState(s);
      optsRef.current.onEnd?.(s);
    },
    [],
  );

  const cancel = useCallback(() => {
    ctrl.current?.abort();
    setState((s) => ({ ...s, running: false }));
  }, []);
  const reset = useCallback(() => {
    ctrl.current?.abort();
    setState(optsRef.current.idle);
  }, []);

  return { state, start, cancel, reset };
}

export const usePlanStream = (onEnd?: (s: PlanStreamState) => void) =>
  useSseRun<PlanStreamEvent, PlanStreamState>({
    idle: idlePlanStream,
    schema: PlanStreamEvent,
    reduce: planStreamReducer,
    onError: (s, message) => ({
      ...s,
      running: false,
      error: { code: 'STREAM_FAILED', message, fallbackAvailable: false },
    }),
    onEnd,
  });

export const useIdeaStream = (onEnd?: (s: IdeaStreamState) => void) =>
  useSseRun<IdeaStreamEvent, IdeaStreamState>({
    idle: idleIdeaStream,
    schema: IdeaStreamEvent,
    reduce: ideaStreamReducer,
    onError: (s, message) => ({ ...s, running: false, stage: null, error: message }),
    onEnd,
  });
