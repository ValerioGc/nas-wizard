import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const testDir = defineBddConfig({
  features: 'src/tests/e2e/features/**/*.feature',
  steps: 'src/tests/e2e/steps/**/*.ts',
  outputDir: 'src/tests/e2e/.features-gen',
});

export default defineConfig({
  testDir,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'on-first-retry',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node src/tests/e2e/fixtures/forge.mjs 3012',
      url: 'http://127.0.0.1:3012/repos/example/nas-gateway/releases/latest',
      reuseExistingServer: !process.env.CI,
    },
    {
      command:
        'rm -rf backend/data/e2e && cargo run --locked --manifest-path backend/axum/Cargo.toml',
      env: {
        WIZARD_PORT: '3011',
        RUSTC_WRAPPER: '',
        NAS_GITHUB_API: 'http://127.0.0.1:3012',
        WIZARD_GATEWAY_REPOSITORY: 'example/nas-gateway',
        WIZARD_UI_REPOSITORY: 'example/nas-launcher',
        WIZARD_STATE_DIR: 'backend/data/e2e',
        WIZARD_DISKS_MODE: 'off',
      },
      url: 'http://127.0.0.1:3011/api/wizard',
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort',
      env: {
        NAS_WIZARD_TARGET: 'http://127.0.0.1:3011',
        CHOKIDAR_USEPOLLING: 'true',
      },
      url: 'http://127.0.0.1:5175',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node src/tests/e2e/fixtures/handover.mjs',
      url: 'http://127.0.0.1:3013/seed',
      reuseExistingServer: !process.env.CI,
    },
  ],
});
