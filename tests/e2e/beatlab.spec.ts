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

const beatsOut = (page: Page): Locator => page.getByRole('group', { name: 'Beats', exact: true }).locator('output');

/** Sets the loop length with the BEATS [–] n [+] control at the top right of the editor. */
async function setBeats(page: Page, beats: number): Promise<void> {
  const out = beatsOut(page);
  for (let guard = 0; guard < 40; guard++) {
    const cur = Number(await out.textContent());
    if (cur === beats) break;
    const down = cur > beats;
    await press(page, page.getByRole('button', { name: `Beats ${down ? 'down' : 'up'}` }));
    if (down) {
      const ok = page.getByRole('dialog').getByRole('button', { name: 'Remove' });
      if (await ok.isVisible().catch(() => false)) await press(page, ok);
    }
  }
  await expect(out).toHaveText(String(beats));
}

async function setFeel(page: Page, feel: 'Straight' | 'Triplet'): Promise<void> {
  await openSettings(page);
  await press(page, page.getByRole('button', { name: feel, exact: true }));
  await expect(page.getByRole('button', { name: feel, exact: true })).toHaveAttribute('aria-pressed', 'true');
}

/** Touch drag through CDP (real touch events, so the browser decides between scroll and tap). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  const n = 10;
  for (let i = 1; i <= n; i++) {
    const pt = { x: from.x + ((to.x - from.x) * i) / n, y: from.y + ((to.y - from.y) * i) / n };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function newBeat(page: Page): Promise<void> {
  await press(page, page.getByRole('button', { name: 'Browse patterns' }));
  await press(page, page.getByRole('button', { name: 'New beat' }));
  await expect(page.getByRole('dialog', { name: 'Patterns' })).toHaveCount(0);
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
      await openText(page);
      const box = page.getByRole('textbox', { name: 'Beat text' });
      await box.fill('k+x x s+x x k+x k+x s+x x');
      await expect(page.locator('.parse.ok')).toContainText('✓ 4 beats · read as 8ths');
      await press(page, page.getByRole('button', { name: 'Apply' }));
      await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();

      if (isMobile(page)) await press(page, page.getByRole('tab', { name: 'Grid' }));
      await press(page, pad(page, 'Kick'));
      // 8th-note text lands on every other square of the 16th grid.
      for (const s of [0, 8, 10]) await expect(cell(page, 'kick', s)).toHaveAttribute('aria-pressed', 'true');
      await expect(cell(page, 'kick', 4)).toHaveAttribute('aria-pressed', 'false');
      await press(page, pad(page, 'Snare'));
      for (const s of [4, 12]) await expect(cell(page, 'snare', s)).toHaveAttribute('aria-pressed', 'true');
      await press(page, pad(page, 'Hi-hat closed'));
      for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) await expect(cell(page, 'hatClosed', s)).toHaveAttribute('aria-pressed', 'true');
      await expect(cell(page, 'hatClosed', 1)).toHaveAttribute('aria-pressed', 'false');

      await openText(page);
      await box.fill('k x\nk q');
      await expect(page.locator('.parse.err')).toContainText("Line 2, col 3: Unknown sound 'q'");
      await box.fill('k---'.repeat(33));
      await expect(page.locator('.parse.err')).toContainText('Too many beats: maximum is 32');
      await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
      await press(page, page.getByRole('button', { name: 'Revert' }));
      await expect(page.locator('.parse.ok')).toBeVisible();
    });

    test('beats control and feel toggle resize the grid but keep squares the same size', async ({ page }) => {
      await open(page);
      await newBeat(page);
      await press(page, pad(page, 'Kick'));
      const kick = page.locator('[data-cell][data-sound="kick"]');
      await expect(kick).toHaveCount(16);
      const w4 = (await cell(page, 'kick', 0).boundingBox())!;
      if (isMobile(page)) expect(Math.abs(w4.width - w4.height)).toBeLessThanOrEqual(1); // square

      await setBeats(page, 3);
      await expect(kick).toHaveCount(12);
      const w3 = (await cell(page, 'kick', 0).boundingBox())!;
      expect(Math.abs(w3.width - w4.width)).toBeLessThanOrEqual(1);

      await setBeats(page, 4);
      await setFeel(page, 'Triplet');
      await expect(kick).toHaveCount(12); // 3 squares per beat
      const beat = cell(page, 'kick', 0).locator('xpath=..');
      await expect(beat.locator('[data-cell]')).toHaveCount(3);
      const wt = (await cell(page, 'kick', 0).boundingBox())!;
      expect(Math.abs(wt.width - w4.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(wt.height - w4.height)).toBeLessThanOrEqual(1);
      await expect(page.getByRole('slider', { name: 'Swing' })).toBeDisabled();

      await setBeats(page, 2);
      await setFeel(page, 'Straight');
      await expect(kick).toHaveCount(8);
      await expect(page.getByRole('slider', { name: 'Swing' })).toBeEnabled();
      await setBeats(page, 8);
      await expect(kick).toHaveCount(32);
    });

    test('BEATS control sits at the top right of the editor; + appends an empty beat; - confirms when the beat has notes', async ({ page }) => {
      await open(page);
      await newBeat(page);
      await press(page, pad(page, 'Kick'));
      const panel = page.locator(isMobile(page) ? '.lane' : '.fullgrid');
      const group = page.getByRole('group', { name: 'Beats', exact: true });

      // Flush top-right: right edge inside the panel's right edge, above the first row of squares.
      const pb = (await panel.boundingBox())!;
      const gb = (await group.boundingBox())!;
      const first = (await cell(page, 'kick', 0).boundingBox())!;
      expect(pb.x + pb.width - (gb.x + gb.width)).toBeGreaterThanOrEqual(-1);
      expect(pb.x + pb.width - (gb.x + gb.width)).toBeLessThanOrEqual(24);
      expect(gb.y + gb.height).toBeLessThanOrEqual(first.y);
      expect(gb.y - pb.y).toBeLessThanOrEqual(24);
      expect(gb.x).toBeGreaterThan(pb.x + pb.width / 2);

      // An empty last beat is removed without asking.
      await press(page, page.getByRole('button', { name: 'Beats up' }));
      await expect(beatsOut(page)).toHaveText('5');
      await expect(page.locator('[data-cell][data-sound="kick"]')).toHaveCount(20);
      await press(page, page.getByRole('button', { name: 'Beats down' }));
      await expect(beatsOut(page)).toHaveText('4');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await press(page, cell(page, 'kick', 0));
      await press(page, cell(page, 'kick', 14));
      await press(page, page.getByRole('button', { name: 'Beats up' }));
      // The new beat is empty (not a copy).
      for (const s of [16, 17, 18, 19]) await expect(cell(page, 'kick', s)).toHaveAttribute('aria-pressed', 'false');
      await expect(cell(page, 'kick', 14)).toHaveAttribute('aria-pressed', 'true');
      await press(page, page.getByRole('button', { name: 'Beats down' }));
      await expect(beatsOut(page)).toHaveText('4');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await press(page, page.getByRole('button', { name: 'Beats down' }));
      const dlg = page.getByRole('dialog', { name: 'Remove beat 4?' });
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText('It has notes.');
      await press(page, dlg.getByRole('button', { name: 'Cancel' }));
      await expect(beatsOut(page)).toHaveText('4');
      await press(page, page.getByRole('button', { name: 'Beats down' }));
      await press(page, page.getByRole('dialog').getByRole('button', { name: 'Remove' }));
      await expect(beatsOut(page)).toHaveText('3');
      await expect(page.locator('[data-cell][data-sound="kick"]')).toHaveCount(12);
      await expect(cell(page, 'kick', 0)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByRole('button', { name: 'Beats up' })).toBeEnabled();
    });

    test('while playing the lane follows the playhead; manual scroll shows the Follow chip', async ({ page }) => {
      await open(page);
      await newBeat(page);
      await setBeats(page, 8);
      await page.getByRole('slider', { name: 'Tempo slider' }).fill('240');
      const lane = page.getByTestId('lane');
      expect(await lane.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Follow' })).toHaveCount(0);

      await press(page, page.getByRole('button', { name: 'Play' }));
      const seen = new Set<number>();
      await expect
        .poll(async () => {
          seen.add(Math.round(await lane.evaluate((el) => el.scrollLeft)));
          return seen.size;
        }, { timeout: 6000, intervals: [60] })
        .toBeGreaterThanOrEqual(2); // 0 and at least one follow jump
      expect(Math.max(...seen)).toBeGreaterThan(40);
      await expect(page.getByRole('button', { name: 'Follow' })).toHaveCount(0);

      // The page itself never scrolls sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await lane.evaluate((el) => {
        el.scrollLeft = el.scrollLeft > 100 ? 0 : el.scrollLeft + 120;
      });
      const chip = page.getByRole('button', { name: 'Follow' });
      await expect(chip).toBeVisible();
      await press(page, chip);
      await expect(chip).toHaveCount(0);
      await press(page, page.getByRole('button', { name: 'Stop' }));
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

test.describe('mobile touch', () => {
  test.use(LAYOUTS.mobile);

  test('dragging the lane scrolls it and never toggles a cell; a tap still toggles', async ({ page }) => {
    await open(page);
    await newBeat(page);
    await setBeats(page, 8);
    await press(page, pad(page, 'Kick'));
    const lane = page.getByTestId('lane');
    const pressed = page.locator('[data-cell][aria-pressed="true"]');
    await expect(pressed).toHaveCount(0);
    expect(await lane.evaluate((el) => el.scrollLeft)).toBe(0);

    // Drag starting ON a cell, well beyond the 8 px tap slop.
    const c = (await cell(page, 'kick', 3).boundingBox())!;
    const y = c.y + c.height / 2;
    await touchDrag(page, { x: c.x + c.width / 2, y }, { x: c.x + c.width / 2 - 160, y });
    await page.waitForTimeout(200);
    expect(await lane.evaluate((el) => el.scrollLeft)).toBeGreaterThan(60);
    await expect(pressed).toHaveCount(0);

    // A drag back over cells does not toggle them either, and a tiny wobble still counts as a tap.
    await touchDrag(page, { x: 200, y }, { x: 330, y });
    await page.waitForTimeout(200);
    await expect(pressed).toHaveCount(0);

    await lane.evaluate((el) => (el.scrollLeft = 0));
    await cell(page, 'kick', 2).tap();
    await expect(cell(page, 'kick', 2)).toHaveAttribute('aria-pressed', 'true');
    await expect(pressed).toHaveCount(1);
    await cell(page, 'kick', 2).tap();
    await expect(cell(page, 'kick', 2)).toHaveAttribute('aria-label', 'Kick step 3, accent');
  });

  test('overview: tapping a column scrolls the lane, tapping a name selects the sound', async ({ page }) => {
    await open(page);
    await newBeat(page);
    await setBeats(page, 12);
    await press(page, pad(page, 'Snare'));
    await press(page, cell(page, 'snare', 0));
    const lane = page.getByTestId('lane');
    expect(await lane.evaluate((el) => el.scrollLeft)).toBe(0);
    await page.locator('.ov-row .ov-cells [data-ov-step="40"]').first().tap();
    await expect.poll(() => lane.evaluate((el) => el.scrollLeft)).toBeGreaterThan(300);
    await expect(page.locator('.ov-view')).toBeVisible();
    await press(page, page.locator('.ov-name').first());
    await expect(page.getByRole('region', { name: 'Snare steps' })).toBeVisible();
  });
});

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

test('desktop: Space plays/stops even when a button, step, slider or stepper has focus', async ({ browser }) => {
  const ctx = await browser.newContext(LAYOUTS.desktop);
  const page = await ctx.newPage();
  await page.goto('./');
  await expect(patternName(page)).toBeVisible();
  const play = page.getByRole('button', { name: 'Play' });
  const stop = page.getByRole('button', { name: 'Stop' });

  // A clicked step cell keeps focus; Space must toggle playback, not the cell.
  const c = cell(page, 'tomFloor', 3);
  await c.click();
  await expect(c).toHaveAttribute('aria-pressed', 'true');
  for (const target of [
    c,
    pad(page, 'Snare'),
    page.getByRole('button', { name: 'Tap tempo' }),
    page.getByRole('slider', { name: 'Tempo slider' }),
    page.getByRole('button', { name: 'Beats up' }),
  ]) {
    await target.focus();
    await page.keyboard.press('Space');
    await expect(stop).toBeVisible();
    await page.keyboard.press('Space');
    await expect(play).toBeVisible();
  }
  await expect(c).toHaveAttribute('aria-pressed', 'true'); // Space never cycled the step

  // Space still types in the beat text editor.
  const text = page.getByRole('textbox', { name: 'Beat text' });
  await text.fill('k');
  await text.press('Space');
  await expect(text).toHaveValue('k ');
  await expect(play).toBeVisible();
  await ctx.close();
});

for (const layout of ['mobile', 'desktop'] as const) {
  test(`${layout}: tempo slider sets BPM`, async ({ browser }) => {
    const ctx = await browser.newContext(LAYOUTS[layout]);
    const page = await ctx.newPage();
    await page.goto('./');
    await expect(patternName(page)).toBeVisible();
    const slider = page.getByRole('slider', { name: 'Tempo slider' });
    await expect(slider).toBeVisible();
    await slider.fill('150');
    await expect(page.getByRole('spinbutton', { name: 'Tempo in BPM' })).toHaveValue('150');
    await page.getByRole('button', { name: 'Tempo up' }).click();
    await expect(slider).toHaveValue('151');
    await ctx.close();
  });
}

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
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Patterns' })).toHaveCount(0);

    // Other grid shapes. Squares keep their size; the grid grows and shrinks.
    const variants: [string, number, number][] = name === 'mobile'
      ? [['2x3', 2, 3], ['4x2', 4, 2]]
      : [['7x4', 7, 4]];
    for (const [label, beats, steps] of variants) {
      await newBeat(page);
      await setBeats(page, beats);
      if (steps === 3) await setFeel(page, 'Triplet');
      const per = steps === 3 ? 3 : 4;
      await press(page, pad(page, 'Kick'));
      for (let s = 0; s < beats * per; s += per) await press(page, cell(page, 'kick', s));
      await press(page, pad(page, 'Hi-hat closed'));
      for (let s = 0; s < beats * per; s += steps === 3 ? 1 : 2) await press(page, cell(page, 'hatClosed', s));
      await page.locator('[data-testid="lane"]').evaluate((el) => (el.scrollLeft = 0));
      await page.waitForTimeout(450);
      await shot(`lab-${label}`);
      if (label === '2x3') await shot('lab-triplet');
    }

    // Eight beats: the loop runs on to the right.
    await newBeat(page);
    await setBeats(page, 8);
    await press(page, pad(page, 'Kick'));
    for (const s of [0, 6, 8, 16, 22, 24]) await press(page, cell(page, 'kick', s));
    await press(page, pad(page, 'Snare'));
    for (const s of [4, 12, 20, 28]) await press(page, cell(page, 'snare', s));
    await page.locator('[data-testid="lane"]').evaluate((el) => (el.scrollLeft = 0));
    await page.waitForTimeout(450);
    await shot('lab-8beats');
    expect(errors).toEqual([]);
    await ctx.close();
  }
});
