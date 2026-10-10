/**
 * `/`: sends the signed-in user to their workspace (first membership, from `me`), to onboarding when they
 * have none, and to sign-in when the session is missing.
 */
import { Navigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { qk } from '../lib/query';
import { ErrorBox } from './page-states';
import { isUnauthorized } from './people/shared';

export function Home() {
  const me = useQuery({ queryKey: qk('me'), queryFn: () => api('me'), retry: false });
  if (me.isError) {
    if (isUnauthorized(me.error)) return <Navigate to="/login" replace />;
    return (
      <main className="grid min-h-dvh place-items-center bg-canvas p-6 max-sm:p-4">
        <div className="w-full max-w-md">
          <ErrorBox what="your account" error={me.error} onRetry={() => void me.refetch()} />
        </div>
      </main>
    );
  }
  if (me.isPending)
    return <main className="min-h-dvh bg-canvas" aria-busy="true" aria-label="Opening your workspace" />;
  const first = me.data.memberships[0];
  return <Navigate to={first ? `/w/${first.workspaceId}/mc` : '/onboarding'} replace />;
}
