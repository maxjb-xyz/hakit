import { describe, expect, it } from 'vitest';
import type { Project } from '@hakit/contracts';
import { project as fixture } from '@hakit/contracts/fixtures';
import { resolveProject } from './project';

const p = (id: string, createdAt: string, status: Project['status'] = 'planning'): Project => ({
  ...fixture,
  id,
  createdAt,
  status,
});

describe('resolveProject', () => {
  const older = p('a', '2026-10-09T21:00:00Z', 'active');
  const newer = p('b', '2026-10-10T09:00:00Z');
  const newest = p('c', '2026-10-10T10:00:00Z');

  it('is null without projects', () => {
    expect(resolveProject([], 'a')).toBeNull();
  });
  it('takes the first preferred id that exists (URL, then remembered)', () => {
    expect(resolveProject([older, newer], 'zzz', 'b')?.id).toBe('b');
    expect(resolveProject([older, newer], 'a', 'b')?.id).toBe('a');
  });
  it('falls back to the active project, then the newest', () => {
    expect(resolveProject([older, newer, newest], null, 'gone')?.id).toBe('a');
    expect(resolveProject([newer, newest])?.id).toBe('c');
  });
});
