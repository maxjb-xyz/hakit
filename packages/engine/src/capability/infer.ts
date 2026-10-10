/** Capability Intelligence (docs/AI.md §A). Owner: IN. Task: T-204. */
import type { EvidenceKind } from '@hakit/contracts';
import { NotImplementedError } from '../errors';

export interface RepoFacts {
  fullName: string;
  url: string;
  pushedAt: Date;
  sizeKb: number;
  isFork: boolean;
  languages: Record<string, number>; // linguist name → bytes
  topics: string[];
  /** Manifest/marker files found: path → raw content (content only for manifests we parse). */
  files: Record<string, string | null>;
  readmeExcerpt: string | null;
}

export interface EvidenceDraft {
  skillSlug: string;
  kind: EvidenceKind;
  sourceRef: string;
  url: string | null;
  weight: number;
  summary: string;
  observedAt: Date;
}

export interface InferredSkill {
  slug: string;
  level: number;
  confidence: number;
  evidence: EvidenceDraft[];
}

/** Deterministic language/manifest/topic → evidence mapping (AI.md §A.2 steps 3, 5). */
export function evidenceFromRepo(_repo: RepoFacts, _now: Date): EvidenceDraft[] {
  throw new NotImplementedError('T-204', 'evidenceFromRepo');
}

/** Σ weights → level/confidence per skill (AI.md §A.2 step 6). */
export function aggregateEvidence(_evidence: EvidenceDraft[]): InferredSkill[] {
  throw new NotImplementedError('T-204', 'aggregateEvidence');
}
