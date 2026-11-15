import { expect, test as base, type Locator, type Page } from '@playwright/test';

const LAYOUTS = {
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
} as const;

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

interface Entry {
  time: number;
  tick: number;
  sound: string;
  vel: number;
}
type Bb = { __beatboy: { engine: { mode: string; bpm: number }; scheduledLog: Entry[] } };
const log = (page: Page): Promise<Entry[]> =>
  page.evaluate(() => (window as unknown as Bb).__beatboy.scheduledLog.map((e) => ({ ...e })));
const clearLog = (page: Page) => page.evaluate(() => (window as unknown as Bb).__beatboy.scheduledLog.splice(0));
const mode = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as Bb).__beatboy.engine.mode);
const engineBpm = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as Bb).__beatboy.engine.bpm);

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 900;
async function press(page: Page, loc: Locator): Promise<void> {
  if (isMobile(page)) await loc.tap();
  else await loc.click();
}

const play = (page: Page) => page.getByRole('button', { name: 'Play', exact: true });
const stopBtn = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });
const goEditor = (page: Page) => press(page, page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Beat Editor/ }));
const goDrummer = (page: Page) => press(page, page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: /^Drummer/ }));
const patternName = (page: Page) => page.getByTestId('pattern-name');
const grooveName = (page: Page) => page.getByTestId('groove-name');
const cell = (page: Page, sound: string, step: number): Locator =>
  page.locator(`[data-cell][data-sound="${sound}"][data-step="${step}"]`);

async function pickGroove(page: Page, name: string): Promise<void> {
  await press(page, page.getByRole('button', { name: /^Groove:/ }));
  await press(page, page.getByRole('dialog', { name: 'Groove' }).getByRole('option', { name: new RegExp(`^${name}`) }));
  await expect(grooveName(page)).toHaveText(name);
}

async function pickPattern(page: Page, name: string): Promise<void> {
  await press(page, page.getByRole('button', { name: /^Patterns:/ }));
  await press(page, page.getByRole('dialog', { name: 'Patterns' }).getByRole('option', { name: new RegExp(`^${name}`) }).first());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Patterns' })).toHaveCount(0);
  await expect(patternName(page)).toHaveText(name);
}

async function setCountInOff(page: Page): Promise<void> {
  await press(page, page.getByRole('group', { name: 'Count-in' }).getByRole('button', { name: 'Off', exact: true }));
}

/** Drummer on Rock 8ths at 120 bpm, no count-in, playing. */
async function startRock(page: Page): Promise<void> {
  await page.goto('./');
  await expect(play(page)).toBeVisible();
  const bpm = page.getByRole('textbox', { name: 'Tempo in BPM' });
  await bpm.fill('120');
  await bpm.press('Enter');
  await pickGroove(page, 'Rock 8ths');
  await setCountInOff(page);
  await clearLog(page);
  await press(page, play(page));
  await expect(stopBtn(page)).toBeVisible();
  await expect.poll(() => mode(page)).toBe('groove');
}

/**
 * The tick -> time mapping must stay one straight line (no restart, no tempo/phase jump) and the sound must not
 * stop for more than a beat.
 */
async function expectContinuous(page: Page, bpm = 120): Promise<void> {
  const es = await log(page);
  expect(es.length).toBeGreaterThan(8);
  const spt = 60 / (bpm * 480);
  const t0 = es[0]!;
  for (const e of es) {
    expect(e.tick, 'no count-in / restart').toBeGreaterThanOrEqual(0);
    expect(Math.abs(e.time - (t0.time + (e.tick - t0.tick) * spt)), `tick ${e.tick}`).toBeLessThan(0.02);
  }
  const times = es.map((e) => e.time).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) expect(times[i]! - times[i - 1]!).toBeLessThanOrEqual(60 / bpm + 0.05);
}

async function waitMore(page: Page, ms = 700): Promise<void> {
  await page.waitForTimeout(ms);
}

for (const name of Object.keys(LAYOUTS) as (keyof typeof LAYOUTS)[]) {
  test.describe(`${name} link`, () => {
    test.use(LAYOUTS[name]);

    test('Drummer -> Editor continues the same beat; edits are live; back again', async ({ page }) => {
      await startRock(page);
      await waitMore(page);
      await goEditor(page);
      await expect(patternName(page)).toHaveText('Rock 8ths');
      await expect(stopBtn(page)).toBeVisible();
      expect(await mode(page)).toBe('groove');
      await waitMore(page);
      await expectContinuous(page);

      // a new note is heard live (every beat gets a snare "e")
      await clearLog(page);
      if (isMobile(page)) await press(page, page.getByRole('button', { name: 'Snare pad' }));
      for (const s of [2, 6, 10, 14]) await press(page, cell(page, 'snare', s));
      await expect.poll(async () => (await log(page)).some((e) => e.sound === 'snare' && e.tick % 480 === 240), { timeout: 3000 }).toBe(true);

      await goDrummer(page);
      await expect(stopBtn(page)).toBeVisible();
      expect(await mode(page)).toBe('groove');
      await waitMore(page);
      await expectContinuous(page);
    });

    test('editing a built-in while linked: the Drummer follows the copy and keeps playing', async ({ page }) => {
      await startRock(page);
      await goEditor(page);
      if (isMobile(page)) await press(page, page.getByRole('button', { name: 'Snare pad' }));
      await press(page, cell(page, 'snare', 2));
      await expect(patternName(page)).toHaveText('My Rock 8ths');
      expect(await mode(page)).toBe('groove');
      await goDrummer(page);
      await expect(grooveName(page)).toHaveText('My Rock 8ths');
      await expect(stopBtn(page)).toBeVisible();
      expect(await mode(page)).toBe('groove');
      await waitMore(page);
      await expectContinuous(page);
    });

    test('another beat in the editor keeps the sound going; back to the Drummer stops it', async ({ page }) => {
      await startRock(page);
      await goEditor(page);
      await waitMore(page, 400);
      await pickPattern(page, 'Punk');
      await expect.poll(() => mode(page)).toBe('lab');
      await expect(stopBtn(page)).toBeVisible();
      await waitMore(page);
      await expectContinuous(page);
      await goDrummer(page);
      await expect.poll(() => mode(page)).toBe('idle');
      await expect(play(page)).toBeVisible();
    });

    test('Duplicate while linked, then the Drummer: stops', async ({ page }) => {
      await startRock(page);
      await goEditor(page);
      await press(page, page.getByRole('button', { name: 'Duplicate pattern' }));
      await expect(patternName(page)).toHaveText('Rock 8ths copy');
      await expect.poll(() => mode(page)).toBe('lab');
      await expect(stopBtn(page)).toBeVisible();
      await goDrummer(page);
      await expect.poll(() => mode(page)).toBe('idle');
    });

    test('Editor Play when linked starts the groove without a count-in', async ({ page }) => {
      await page.goto('./');
      await pickGroove(page, 'Rock 8ths');
      await press(page, page.getByRole('group', { name: 'Count-in' }).getByRole('button', { name: '2', exact: true }));
      await goEditor(page);
      await expect(patternName(page)).toHaveText('Rock 8ths');
      await clearLog(page);
      await press(page, play(page));
      await expect.poll(() => mode(page)).toBe('groove');
      await waitMore(page);
      const es = await log(page);
      expect(es.length).toBeGreaterThan(4);
      expect(Math.min(...es.map((e) => e.tick))).toBeGreaterThanOrEqual(0);
      await goDrummer(page);
      expect(await mode(page)).toBe('groove');
      await expect(stopBtn(page)).toBeVisible();
      await waitMore(page);
      await expectContinuous(page, 100);
    });

    test('Editor Play on an unlinked beat plays it alone; Stop stops', async ({ page }) => {
      await page.goto('./#/editor');
      await expect(patternName(page)).toHaveText('Rock 8ths');
      await press(page, play(page));
      await expect.poll(() => mode(page)).toBe('lab');
      await press(page, stopBtn(page));
      await expect.poll(() => mode(page)).toBe('idle');
    });

    test('click only keeps playing across tabs', async ({ page }) => {
      await page.goto('./');
      await setCountInOff(page);
      await press(page, play(page));
      await expect.poll(() => mode(page)).toBe('groove');
      await goEditor(page);
      await expect(stopBtn(page)).toBeVisible();
      await expect(patternName(page)).toHaveText('Rock 8ths'); // its own pattern, not linked
      await waitMore(page, 500);
      expect(await mode(page)).toBe('groove');
      await goDrummer(page);
      expect(await mode(page)).toBe('groove');
      await expect(stopBtn(page)).toBeVisible();
    });

    test('old #/assistant and #/lab URLs redirect', async ({ page }) => {
      await page.goto('./#/lab');
      await expect(patternName(page)).toBeVisible();
      await expect(page).toHaveURL(/#\/editor$/);
      await page.goto('./#/assistant');
      await page.reload();
      await expect(page.getByRole('region', { name: 'Drummer' })).toBeVisible();
      await expect(page).toHaveURL(/#\/drummer$/);
    });

    test('tempo is shared between the tabs', async ({ page }) => {
      await page.goto('./#/editor');
      await expect(patternName(page)).toBeVisible();
      const input = page.getByRole('spinbutton', { name: 'Tempo in BPM' });
      await input.fill('137');
      await input.press('Enter');
      await expect(input).toHaveValue('137');
      await expect.poll(() => engineBpm(page)).toBe(137);
      await goDrummer(page);
      await expect(page.getByRole('textbox', { name: 'Tempo in BPM' })).toHaveValue('137');
      // selecting another beat in the editor never changes it
      await goEditor(page);
      await pickPattern(page, 'Punk');
      await expect(input).toHaveValue('137');
    });
  });
}
