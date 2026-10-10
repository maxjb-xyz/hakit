import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateProjectQueries } from './ws';
describe('project query invalidation', () => {
  it('invalidates only the connected project for project-scoped endpoints', () => {
    const client = new QueryClient();
    const here = ['missionControl', { pid: 'here' }];
    const there = ['missionControl', { pid: 'there' }];
    client.setQueryData(here, {});
    client.setQueryData(there, {});
    invalidateProjectQueries(client, 'here', ['missionControl']);
    expect(client.getQueryState(here)?.isInvalidated).toBe(true);
    expect(client.getQueryState(there)?.isInvalidated).toBe(false);
    client.clear();
  });
  it('does not poll unrelated queries and preserves workspace event invalidations', () => {
    const client = new QueryClient();
    const activity = ['listActivity', { pid: 'here' }];
    const members = ['listMembers', { wid: 'team' }];
    client.setQueryData(activity, {});
    client.setQueryData(members, {});
    invalidateProjectQueries(client, 'here', ['missionControl']);
    expect(client.getQueryState(activity)?.isInvalidated).toBe(false);
    invalidateProjectQueries(client, 'here', ['listMembers']);
    expect(client.getQueryState(members)?.isInvalidated).toBe(true);
    client.clear();
  });
});
