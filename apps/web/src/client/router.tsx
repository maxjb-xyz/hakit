import { createBrowserRouter, Navigate } from 'react-router';
import { ids } from '@hakit/contracts/fixtures';
import { AppShell } from './shell/AppShell';
import * as S from './routes/screens';

/** Routes per DESIGN §6. Each screen moves to its own lazy module as it's implemented. */
export const router = createBrowserRouter([
  { path: '/', element: <Navigate to={`/w/${ids.workspace}/mc`} replace /> },
  { path: '/login', element: <S.Login /> },
  { path: '/j/:code', element: <S.Join /> },
  { path: '/onboarding/*', element: <S.Onboarding /> },
  { path: '/_ui', element: <S.UiGallery /> },
  {
    path: '/w/:wid',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="mc" replace /> },
      { path: 'mc', element: <S.MissionControl /> },
      { path: 'plan/*', element: <S.Plan /> },
      { path: 'tasks', element: <S.Tasks /> },
      { path: 'team', element: <S.Team /> },
      { path: 'team/:uid', element: <S.MemberProfile /> },
      { path: 'code', element: <S.Code /> },
      { path: 'agents', element: <S.Agents /> },
      { path: 'settings', element: <S.Settings /> },
    ],
  },
]);
