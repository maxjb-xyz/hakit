/**
 * T-704 · Responsive & a11y pass. Mock mode only (fixtures give every screen data without accounts).
 * For every route (S1–S14) at 375 / 768 / 1440px: axe (WCAG 2.1 A/AA) reports no violations, the page never
 * scrolls horizontally, and there is a main landmark plus one h1.
 * `SCREENSHOTS=1 pnpm --filter @hakit/web test:e2e e2e/a11y.spec.ts` also writes docs/screenshots/<name>-<width>.png at 1440 and 375 for the submission (T-706).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ids } from '@hakit/contracts/fixtures';
import { REAL } from './support';

const w = `/w/${ids.workspace}`;
const ROUTES: Array<[name: string, path: string]> = [
  ['s1-login', '/login'],
  ['s1-join', '/j/ORBIT7K2QX'],
  ['s2-new-workspace', '/new'],
  ['s3-onboarding-profile', '/onboarding'],
  ['s3-onboarding-skills', '/onboarding?step=skills'],
  ['s3-onboarding-availability', '/onboarding?step=availability'],
  ['s10-mission-control', `${w}/mc`],
  ['s6-plan-idea', `${w}/plan?step=idea`],
  ['s7-plan-constraints', `${w}/plan?step=constraints`],
  ['s8-plan-review', `${w}/plan?step=plan`],
  ['s9-plan-assign', `${w}/plan?step=assign`],
  ['s11-tasks', `${w}/tasks`],
  ['s11-task-inspector', `${w}/tasks?task=HK-1`],
  ['s5-team', `${w}/team`],
  ['s5-team-members', `${w}/team?tab=members`],
  ['s5-team-availability', `${w}/team?tab=availability`],
  ['s2-team-invite', `${w}/team?invite=1`],
  ['s4-member-profile', `${w}/team/${ids.users.priya}`],
  ['s12-code', `${w}/code`],
  ['s13-agents', `${w}/agents`],
  ['s14-settings', `${w}/settings`],
];
const WIDTHS = [375, 768, 1440];
const SHOTS = !!process.env.SCREENSHOTS;
const shotDir = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));

test.skip(REAL, 'The a11y pass runs against mock-mode fixtures');

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  // Skeletons gone: nothing on the page is still busy loading.
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({
      viewport: { width, height: width < 768 ? 812 : 900 },
      contextOptions: { reducedMotion: 'reduce' },
    });

    for (const [name, path] of ROUTES) {
      test(name, async ({ page }) => {
        await page.goto(path);
        await settle(page);

        await expect(page.locator('main')).toHaveCount(1);
        await expect(page.locator('h1')).toHaveCount(1);

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);

        const axe = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        const summary = axe.violations.map(
          (v) => `${v.impact} ${v.id}: ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`,
        );
        expect(summary, summary.join('\n')).toEqual([]);

        if (SHOTS && (width === 1440 || width === 375)) {
          mkdirSync(shotDir, { recursive: true });
          await page.screenshot({ path: `${shotDir}${name}-${width}.png` });
        }
      });
    }
  });
}

test.describe('keyboard', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('focus is visible on every tab stop in the shell', async ({ page }) => {
    await page.goto(`${w}/mc`);
    await settle(page);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const visible = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return true;
        const s = getComputedStyle(el);
        return s.outlineStyle !== 'none' && s.outlineWidth !== '0px';
      });
      expect(visible, `tab stop ${i + 1} has no visible focus`).toBe(true);
    }
  });
});
