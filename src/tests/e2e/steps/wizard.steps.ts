import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import type { WizardState } from '@/types/types';

const { Given, When, Then } = createBdd();

// The networks come from nmcli, which a test machine may not have: the page is told what is in
// reach instead.
Given('the wizard opens on a NAS never configured', async ({ page }) => {
  await page.route('**/api/wizard/network/scan', (route) =>
    route.fulfill({
      json: {
        connection: { kind: 'lan', connected: true, ssid: null },
        wifi: [{ ssid: 'Home', signal: 70, security: 'WPA2', known: false }],
        canConnect: false,
        wifiNote: null,
      },
    }),
  );
  await page.goto('/');
  await expect(page.getByTestId('wizard_start')).toBeVisible();
});
When('I go through the setup wizard up to the token', async ({ page }) => {
  await page.getByTestId('wizard_start').click();
  await page.getByTestId('wizard_username').fill('owner');
  await page.getByTestId('wizard_password').fill('long enough');
  await page.getByTestId('wizard_confirm').fill('long enough');
  await page.getByTestId('wizard_next').click();
  await expect(page.getByTestId('wizard_mtls')).toHaveCount(0);
  await expect(page.getByTestId('wizard_nas_name')).toHaveValue('nas');
  await page.getByTestId('wizard_nas_name').fill('attic');
  await page.getByTestId('wizard_theme_dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('wizard_next').click();
  await expect(page.getByTestId('wizard_network_Home')).toBeVisible();
  await page.getByTestId('wizard_next').click();
});
When('I check the token {string}', async ({ page }, token: string) => {
  await page.getByTestId('wizard_token').fill(token);
  await page.getByTestId('wizard_token_check').click();
});
Then('the token is refused by every repository', async ({ page }) => {
  const answers = page.getByTestId('wizard_token_answers');
  await expect(answers.getByRole('listitem')).toHaveCount(2);
  await expect(answers).toContainText('example/nas-gateway');
  await expect(answers.getByText('Token rifiutato')).toHaveCount(2);
});
Then('every repository can be read with the token', async ({ page }) => {
  const answers = page.getByTestId('wizard_token_answers');
  await expect(answers.getByText('Accessibile')).toHaveCount(2);
});
When('I complete the configuration', async ({ page }) => {
  await page.getByTestId('wizard_next').click();
  await expect(page.getByTestId('wizard_summary')).toContainText('owner');
  await expect(page.getByTestId('wizard_summary')).toContainText('attic');
  await expect(page.getByTestId('wizard_summary_mtls')).toHaveCount(0);
  await page.getByTestId('wizard_finish').click();
});
Then('the wizard downloads both releases and simulates the rest', async ({ page }) => {
  // The HTTPS authority is offered before handing over to password sign-in.
  const certificate = page.getByTestId('wizard_certificate');
  await expect(certificate).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wizard_device')).toHaveCount(0);
  await expect(page.getByTestId('wizard_certificate_confirm')).toHaveCount(0);
  await expect(page.getByTestId('wizard_go_to_login')).toBeEnabled();
  await page.getByTestId('wizard_go_to_login').click();
  await expect(page.getByTestId('wizard_simulated')).toBeVisible();
  await expect(page.getByTestId('wizard_install_download_gateway')).toContainText('version 9.9.9');
  await expect(page.getByTestId('wizard_install_download_ui')).toContainText('version 9.9.9');
  await expect(page.getByTestId('wizard_install_install_ui')).toContainText('simulated');
  await expect(page.locator('[data-state="done"]')).toHaveCount(10);
});

Given('the wizard is ready to hand over to the gateway', async ({ page }) => {
  const ready: WizardState = {
    phase: 'ready',
    steps: [{ id: 'handover', state: 'pending', detail: '' }],
    simulated: false,
    version: '9.9.9',
  };
  await page.route('**/api/wizard', (route) => route.fulfill({ json: ready }));
  await page.route('**/api/wizard/certificate', (route) =>
    route.fulfill({
      json: { caPem: '-----BEGIN CERTIFICATE-----\nAA==\n-----END CERTIFICATE-----' },
    }),
  );
  await page.route('**/api/wizard/finish', async (route) => {
    expect(route.request().method()).toBe('POST');
    await route.fulfill({ json: { ...ready, phase: 'done' } });
  });
  await page.route('**/health', (route) => route.fulfill({ status: 503, body: 'changing hands' }));
  await page.route('**/login', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main data-testid="nas_login">Login</main>' }),
  );
  await page.goto('/setup');
  await expect(page.getByTestId('wizard_go_to_login')).toBeEnabled();
});

When('I choose to go to login', async ({ page }) => {
  await page.getByTestId('wizard_go_to_login').click();
  await expect(page.getByTestId('wizard_handover')).toBeVisible();
});

Then(
  'the wizard waits for the gateway and opens login on the same HTTP origin',
  async ({ page }) => {
    const origin = new URL(page.url()).origin;
    expect(new URL(origin).protocol).toBe('http:');
    expect(new URL(origin).port).not.toBe('');

    await page.waitForResponse((response) => new URL(response.url()).pathname === '/health');
    await expect(page).toHaveURL(`${origin}/setup`);
    await page.route('**/health', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Wizard</title>' }),
    );
    await page.waitForResponse((response) => new URL(response.url()).pathname === '/health');
    await expect(page).toHaveURL(`${origin}/setup`);

    await page.route('**/health', (route) =>
      route.fulfill({ contentType: 'text/plain', body: 'ok' }),
    );
    await expect(page).toHaveURL(`${origin}/login`, { timeout: 10_000 });
    await expect(page.getByTestId('nas_login')).toBeVisible();
  },
);

const FORWARDED_ORIGIN = 'http://127.0.0.1:3013';

Given('the browser has cached the old gateway redirects for root and login', async ({ page }) => {
  await page.request.post(`${FORWARDED_ORIGIN}/reset`);
  await page.goto(`${FORWARDED_ORIGIN}/seed`);
  await page.evaluate(() => {
    document.cookie = 'handover_test=retained; SameSite=Lax; path=/';
    localStorage.setItem('handover_test', 'retained');
  });
  for (const path of ['/', '/login']) {
    const probe = await page.context().newPage();
    await probe.goto(`${FORWARDED_ORIGIN}${path}`).catch(() => null);
    await probe.close();
  }
  const before = await (await page.request.get(`${FORWARDED_ORIGIN}/stats`)).json();
  expect(before).toEqual({ root: 1, login: 1 });
  await page.request.post(`${FORWARDED_ORIGIN}/switch`);
  // The server is fixed now, but navigation still uses the old cached redirects.
  for (const path of ['/', '/login']) {
    const probe = await page.context().newPage();
    await probe.goto(`${FORWARDED_ORIGIN}${path}`).catch(() => null);
    await probe.close();
  }
  const after = await (await page.request.get(`${FORWARDED_ORIGIN}/stats`)).json();
  expect(after).toEqual(before);
});

When('I open the current wizard and choose to go to login', async ({ page }) => {
  await page.goto(`${FORWARDED_ORIGIN}/setup`);
  await expect(page.getByTestId('wizard_go_to_login')).toBeEnabled();
  await page.getByTestId('wizard_go_to_login').click();
});

Then('login and root keep the forwarded HTTP origin and browser settings', async ({ page }) => {
  await expect(page).toHaveURL(`${FORWARDED_ORIGIN}/login`, { timeout: 10_000 });
  await expect(page.getByTestId('nas_login')).toBeVisible();
  const saved = await page.evaluate(() => ({
    cookie: document.cookie,
    setting: localStorage.getItem('handover_test'),
  }));
  expect(saved.cookie).toContain('handover_test=retained');
  expect(saved.setting).toBe('retained');
  await page.goto(`${FORWARDED_ORIGIN}/`);
  await expect(page).toHaveURL(`${FORWARDED_ORIGIN}/setup`);
  await expect(page.getByTestId('wizard_go_to_login')).toBeVisible();
});
