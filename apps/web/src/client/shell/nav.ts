/** Primary destinations (DESIGN §6 IA), shared by the sidebar, mobile tabs and the ⌘K palette. */
import type { ComponentType } from 'react';
import { IconAgents, IconCode, IconMission, IconPlan, IconSettings, IconTasks, IconTeam } from './icons';

export type NavItem = { to: string; label: string; icon: ComponentType; keywords?: string };

export const NAV: NavItem[] = [
  { to: 'mc', label: 'Mission Control', icon: IconMission, keywords: 'home dashboard status health' },
  { to: 'plan', label: 'Plan', icon: IconPlan, keywords: 'ideas constraints plan review' },
  { to: 'tasks', label: 'Tasks', icon: IconTasks, keywords: 'board list kanban' },
  { to: 'team', label: 'Team', icon: IconTeam, keywords: 'members skills capability' },
  { to: 'code', label: 'Code', icon: IconCode, keywords: 'github commits pull requests repo' },
  { to: 'agents', label: 'Agents', icon: IconAgents, keywords: 'claude sessions' },
];

export const SETTINGS: NavItem = {
  to: 'settings',
  label: 'Settings',
  icon: IconSettings,
  keywords: 'integrations workspace privacy tokens',
};
