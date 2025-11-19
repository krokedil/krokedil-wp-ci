import { test, expect } from '@playwright/test';

/**
 * Tiny e2e smoke test to verify that Playwright is configured correctly
 * and can navigate to the configured baseURL.
 */

test('home page responds', async ({ page }) => {
  // baseURL is provided via E2E_BASE_URL (see playwright.config.ts)
  await page.goto('/');

  // We keep this intentionally loose, as different blueprints may have different titles.
  await expect(page).toHaveTitle(/wordpress/i);
});
