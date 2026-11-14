import { expect, test } from '@playwright/test';

test('loads the app with no third-party requests', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (req) => urls.push(req.url()));

  await page.goto('./');
  await expect(page.locator('h1')).toHaveText('Beatboy');

  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    expect(url.startsWith('http://localhost:4173/')).toBe(true);
  }
});
