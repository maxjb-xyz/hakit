/**
 * T-207 · S2 in the browser (mock mode): create a workspace from the Knight Hacks template, make an invite link with
 * an expiry and a use limit, and reach the same panel from Team and Settings.
 */
import { expect, test } from '@playwright/test';
import { ids } from '@hakit/contracts/fixtures';
import { REAL } from './support';

test.skip(REAL, 'Runs against mock-mode fixtures');

test('create a workspace, then invite the team', async ({ page }) => {
  await page.goto('/new');
  await expect(page.getByRole('heading', { level: 1, name: 'Create a workspace' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Knight Hacks IX/ })).toBeChecked();

  // Validation before anything is sent.
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByText('Give your team a name.')).toBeVisible();

  // Custom events need a deadline.
  await page.getByRole('radio', { name: /Custom event/ }).check();
  await expect(page.getByLabel('Submission deadline')).toBeVisible();
  await page.getByRole('radio', { name: /Knight Hacks IX/ }).check();

  await page.getByLabel('Team name').fill('Team Orbit');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(new RegExp(`/new\\?wid=${ids.workspace}`));
  await expect(page.getByRole('heading', { level: 1, name: 'Bring your team' })).toBeVisible();

  await page.getByLabel('Link expires after').selectOption({ label: '1 week' });
  await page.getByRole('radio', { name: 'Up to' }).check();
  await page.getByLabel('Maximum uses').fill('99');
  await expect(page.getByText('Enter a number from 1 to 50.')).toBeVisible();
  await page.getByLabel('Maximum uses').fill('5');
  await page.getByRole('button', { name: 'Create invite link' }).click();

  await expect(page.getByText(/\/j\/ORBIT7K2QX$/)).toBeVisible();
  await expect(page.getByText('0 of 5 uses')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Set up your profile' })).toHaveAttribute(
    'href',
    `/onboarding?wid=${ids.workspace}`,
  );
});

test('invite panel opens from Team and lives in Settings', async ({ page }) => {
  await page.goto(`/w/${ids.workspace}/team`);
  const invite = page.getByRole('button', { name: 'Invite', exact: true });
  await expect(invite).toHaveAttribute('aria-expanded', 'false');
  await invite.click();
  await expect(page.getByRole('heading', { name: 'Invite teammates' })).toBeVisible();
  await expect(page).toHaveURL(/invite=1/);

  await page.goto(`/w/${ids.workspace}/settings`);
  await expect(page.getByRole('heading', { name: 'Invite teammates' })).toBeVisible();
});

test('workspace switcher and ⌘K lead to workspace creation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/w/${ids.workspace}/mc`);
  await page.getByRole('combobox', { name: 'Workspace' }).selectOption({ label: 'New workspace…' });
  await expect(page).toHaveURL(/\/new$/);

  await page.goto(`/w/${ids.workspace}/mc`);
  await page.getByRole('button', { name: /Search/ }).click();
  await page.keyboard.type('new workspace');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/new$/);
});
