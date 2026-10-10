/** Screen registry S1–S14 (DESIGN §8). Each FE task replaces one export with a real screen in its own file. */
import { Button } from '@hakit/ui';

export { Login } from './Login';
export { Join } from './Join';
export { Onboarding } from './Onboarding';
export { MissionControl } from './MissionControl';
export { Plan } from './Plan';
export { Tasks } from './Tasks';
export { Team } from './Team';
export { MemberProfile } from './MemberProfile';
export { Code } from './Code';
export { Agents } from './Agents';
export { Settings } from './Settings';
export function UiGallery() {
  return (
    <section className="space-y-6 p-6">
      <p className="text-caption uppercase tracking-wide text-subtle">/_ui · T-102, T-103</p>
      <h1 className="font-display text-display-sm text-strong">Component gallery</h1>
      <div className="flex flex-wrap items-center gap-2">
        {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
          <Button key={v} variant={v}>
            {v}
          </Button>
        ))}
        <Button variant="primary" loading>
          loading
        </Button>
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} className="size-6 rounded-full" style={{ background: `var(--color-member-${i})` }} />
        ))}
      </div>
    </section>
  );
}
