import { mkdirSync } from 'node:fs';
import { expect, test as base, type Locator, type Page } from '@playwright/test';

const ORIGIN = 'http://localhost:4173/';

const LAYOUTS = {
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
} as const;
type LayoutName = keyof typeof LAYOUTS;

// Fails any test that logs console.error or throws a page error.
const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
      await use(errors);
      expect(errors, 'no console errors').toEqual([]);
    },
    { auto: true },
  ],
});

const cell = (page: Page, sound: string, step: number): Locator =>
  page.locator(`[data-cell][data-sound="${sound}"][data-step="${step}"]`);
const pad = (page: Page, name: string): Locator => page.getByRole('button', { name: `${name} pad` });
const patternName = (page: Page): Locator => page.getByTestId('pattern-name');
const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 900;

async function press(page: Page, loc: Locator): Promise<void> {
  if (isMobile(page)) await loc.tap();
  else await loc.click();
}

async function openText(page: Page): Promise<void> {
  if (isMobile(page)) await press(page, page.getByRole('tab', { name: 'Text' }));
  await expect(page.getByRole('textbox', { name: 'Beat text' })).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  if (isMobile(page)) {
    const s = page.getByRole('button', { name: 'Pattern settings' });
    if ((await s.getAttribute('aria-expanded')) !== 'true') await press(page, s);
  }
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.locator('.chip-saved')).toHaveText('Saved');
}

async function open(page: Page): Promise<void> {
  await page.goto('./');
  await expect(patternName(page)).toBeVisible();
}

test('loads at the sub-path with same-origin requests only and the default pattern', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (req) => urls.push(req.url()));
  await page.goto('./');
  await expect(patternName(page)).toHaveText('Rock 8ths');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  expect(page.url().startsWith(`${ORIGIN}beatboy/`)).toBe(true);
  expect(urls.length).toBeGreaterThan(0);
  for (const url of urls) {
    if (url.startsWith('data:') || url.startsWith('blob:')) continue;
    expect(url.startsWith(ORIGIN), url).toBe(true);
  }
});

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} layout`, () => {
    test.use(LAYOUTS[name]);

    test('select a pad and cycle a step', async ({ page }) => {
      await open(page);
      await press(page, pad(page, 'Snare'));
      await expect(pad(page, 'Snare')).toHaveAttribute('aria-pressed', 'true');
      await expect(pad(page, 'Kick')).toHaveAttribute('aria-pressed', 'false');

      const c = cell(page, 'snare', 0);
      await expect(c).toHaveAttribute('aria-pressed', 'false');
      await press(page, c);
      await expect(page.getByRole('status').filter({ hasText: 'Saved as My Rock 8ths' })).toBeVisible();
      await expect(c).toHaveAttribute('aria-pressed', 'true');
      await expect(c).toHaveAttribute('aria-label', 'Snare step 1, normal');
      await press(page, c);
      await expect(c).toHaveAttribute('aria-label', 'Snare step 1, accent');
      await press(page, c);
      await expect(c).toHaveAttribute('aria-label', 'Snare step 1, ghost');
      await press(page, c);
      await expect(c).toHaveAttribute('aria-label', 'Snare step 1, off');
      await expect(c).toHaveAttribute('aria-pressed', 'false');
    });

    test('velocity popover sets an exact level', async ({ page }) => {
      await open(page);
      await press(page, pad(page, 'Snare'));
      const c = cell(page, 'snare', 1);
      if (isMobile(page)) {
        const box = (await c.boundingBox())!;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
        await page.waitForTimeout(650);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await c.click({ button: 'right' });
      }
      await page.getByRole('button', { name: 'Accent', exact: true }).click();
      await expect(c).toHaveAttribute('aria-label', 'Snare step 2, accent');
    });

    test('play moves the playhead and schedules notes; stop works', async ({ page }) => {
      await open(page);
      await press(page, page.getByRole('button', { name: 'Play' }));
      await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();

      await expect
        .poll(() => page.evaluate(() => window.__beatboy?.scheduledLog.length ?? 0), { timeout: 2000 })
        .toBeGreaterThan(2);
      const times = await page.evaluate(() => window.__beatboy!.scheduledLog.map((e) => e.time));
      for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!);
      expect(times[times.length - 1]!).toBeGreaterThan(times[0]!);

      // The playing-step indicator moves.
      const seen = new Set<string>();
      await expect
        .poll(
          async () => {
            const s = await page.evaluate(() => document.querySelector<HTMLElement>('.cell.is-playing')?.dataset.step ?? '');
            if (s) seen.add(s);
            return seen.size;
          },
          { timeout: 4000, intervals: [50] },
        )
        .toBeGreaterThanOrEqual(3);

      await press(page, page.getByRole('button', { name: 'Stop' }));
      await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
      expect(await page.evaluate(() => window.__beatboy!.engine.playing)).toBe(false);
      await expect(page.locator('.cell.is-playing')).toHaveCount(0);
      const n = await page.evaluate(() => window.__beatboy!.scheduledLog.length);
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => window.__beatboy!.scheduledLog.length)).toBe(n);
    });

    test('editing a built-in saves a copy that survives a reload', async ({ page }) => {
      await open(page);
      await press(page, cell(page, 'kick', 1));
      await expect(patternName(page)).toHaveText('My Rock 8ths');
      await expect(page.getByRole('status').filter({ hasText: 'Saved as My Rock 8ths' })).toBeVisible();
      await expect(cell(page, 'kick', 1)).toHaveAttribute('aria-pressed', 'true');
      await waitSaved(page);

      await page.reload();
      await expect(patternName(page)).toHaveText('My Rock 8ths');
      await expect(cell(page, 'kick', 1)).toHaveAttribute('aria-pressed', 'true');
      // The built-in is still pristine.
      await press(page, page.getByRole('button', { name: 'Browse patterns' }));
      await expect(page.getByRole('button', { name: /^Rock 8ths/ })).toBeVisible();
    });

    test('text notation: apply and errors', async ({ page }) => {
      await open(page);
      await press(page, page.getByRole('button', { name: 'Browse patterns' }));
      await press(page, page.getByRole('button', { name: 'New beat' }));
      await expect(patternName(page)).toHaveText('Beat 1');
      await openSettings(page);
      await page.getByRole('combobox', { name: 'Grid resolution' }).selectOption({ label: '8ths' });

      await openText(page);
      const box = page.getByRole('textbox', { name: 'Beat text' });
      await box.fill('k+x x s+x x k+x k+x s+x x');
      await expect(page.locator('.parse.ok')).toContainText('✓ 1 bar · 4/4 · 8ths');
      await press(page, page.getByRole('button', { name: 'Apply' }));
      await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();

      if (isMobile(page)) await press(page, page.getByRole('tab', { name: 'Grid' }));
      await press(page, pad(page, 'Kick'));
      for (const s of [0, 4, 5]) await expect(cell(page, 'kick', s)).toHaveAttribute('aria-pressed', 'true');
      await expect(cell(page, 'kick', 2)).toHaveAttribute('aria-pressed', 'false');
      await press(page, pad(page, 'Snare'));
      for (const s of [2, 6]) await expect(cell(page, 'snare', s)).toHaveAttribute('aria-pressed', 'true');
      await press(page, pad(page, 'Hi-hat closed'));
      for (const s of [0, 1, 2, 3, 4, 5, 6, 7]) await expect(cell(page, 'hatClosed', s)).toHaveAttribute('aria-pressed', 'true');

      await openText(page);
      await box.fill('k x\nk q');
      await expect(page.locator('.parse.err')).toContainText("Line 2, col 3: Unknown sound 'q'");
      await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
      await press(page, page.getByRole('button', { name: 'Revert' }));
      await expect(page.locator('.parse.ok')).toBeVisible();
    });

    test('pattern browser: new, duplicate, rename, delete', async ({ page }) => {
      await open(page);
      // Built-ins can't be deleted.
      await expect(page.getByRole('button', { name: 'Delete pattern' })).toBeDisabled();

      await press(page, page.getByRole('button', { name: 'Browse patterns' }));
      await press(page, page.getByRole('button', { name: 'New beat' }));
      await expect(patternName(page)).toHaveText('Beat 1');

      await press(page, page.getByRole('button', { name: 'Duplicate pattern' }));
      await expect(patternName(page)).toHaveText('Beat 1 copy');

      await press(page, page.getByRole('button', { name: 'Rename pattern' }));
      const input = page.getByRole('textbox', { name: 'Pattern name' });
      await input.fill('Groove');
      await input.press('Enter');
      await expect(patternName(page)).toHaveText('Groove');

      await press(page, page.getByRole('button', { name: 'Browse patterns' }));
      await expect(page.getByRole('button', { name: /^Beat 1 · |^Beat 1\b/ }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /^Groove/ })).toBeVisible();
      await page.keyboard.press('Escape');

      await press(page, page.getByRole('button', { name: 'Delete pattern' }));
      await expect(page.getByRole('dialog', { name: 'Delete pattern?' })).toBeVisible();
      await press(page, page.getByRole('button', { name: 'Cancel' }));
      await expect(patternName(page)).toHaveText('Groove');

      await press(page, page.getByRole('button', { name: 'Delete pattern' }));
      await press(page, page.getByRole('dialog').getByRole('button', { name: 'Delete' }));
      await expect(patternName(page)).toHaveText('Beat 1');

      await waitSaved(page);
      await page.reload();
      await expect(patternName(page)).toHaveText('Beat 1');
      await press(page, page.getByRole('button', { name: 'Browse patterns' }));
      await expect(page.getByRole('button', { name: /^Groove/ })).toHaveCount(0);
    });
  });
}

test('desktop: click-drag paints a row and Space toggles playback', async ({ browser }) => {
  const ctx = await browser.newContext(LAYOUTS.desktop);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(patternName(page)).toBeVisible();
  const a = (await cell(page, 'tomHigh', 0).boundingBox())!;
  const b = (await cell(page, 'tomHigh', 5).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
  for (let s = 0; s <= 5; s++) await expect(cell(page, 'tomHigh', s)).toHaveAttribute('aria-pressed', 'true');
  await expect(cell(page, 'tomHigh', 6)).toHaveAttribute('aria-pressed', 'false');

  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  expect(errors).toEqual([]);
  await ctx.close();
});

test('assistant tab shows the iteration placeholder', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Assistant/ }).click();
  await expect(page.getByText('arrive in the next iteration')).toBeVisible();
  await expect(page).toHaveURL(/#\/assistant$/);
});

test('screenshots', async ({ browser }) => {
  mkdirSync('test-results/screenshots', { recursive: true });
  for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
    const ctx = await browser.newContext(LAYOUTS[name]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./');
    await expect(patternName(page)).toBeVisible();
    const shot = (n: string) => page.screenshot({ path: `test-results/screenshots/${name}-${n}.png`, fullPage: true });

    await press(page, pad(page, 'Snare'));
    await press(page, cell(page, 'snare', 3));
    await press(page, cell(page, 'snare', 3));
    await press(page, cell(page, 'snare', 7));
    await press(page, cell(page, 'snare', 7));
    await press(page, cell(page, 'snare', 7));
    await page.waitForTimeout(450);
    await shot('lab');

    await openText(page);
    await page.getByRole('textbox', { name: 'Beat text' }).scrollIntoViewIfNeeded();
    await shot('text');

    if (isMobile(page)) {
      await press(page, page.getByRole('tab', { name: 'Mix' }));
      await press(page, page.getByRole('button', { name: 'Mute Hi-hat closed' }));
    } else {
      await press(page, page.getByRole('button', { name: 'Mute Hi-hat closed' }));
    }
    await shot('mix');

    if (isMobile(page)) await press(page, page.getByRole('tab', { name: 'Grid' }));
    await press(page, page.getByRole('button', { name: 'Browse patterns' }));
    await expect(page.getByRole('dialog', { name: 'Patterns' })).toBeVisible();
    await page.waitForTimeout(450); // let the sheet animation finish
    await shot('browser');
    expect(errors).toEqual([]);
    await ctx.close();
  }
});
