import {
  LAYOUTS,
  cards,
  clearLog,
  engineBpm,
  expect,
  goDrummer,
  goEditor,
  log,
  mode,
  open,
  play,
  press,
  isMobile,
  pickGroove,
  setCountInOff,
  stopBtn,
  test,
  type LayoutName,
} from './fixtures';
import type { Locator, Page } from '@playwright/test';

const patternName = (page: Page) => page.getByTestId('pattern-name');
const cell = (page: Page, sound: string, step: number): Locator =>
  page.locator(`[data-cell][data-sound="${sound}"][data-step="${step}"]`);

async function pickPattern(page: Page, name: string): Promise<void> {
  await press(page, page.getByRole('button', { name: /^Patterns:/ }));
  await press(page, page.getByRole('dialog', { name: 'Patterns' }).getByRole('option', { name: new RegExp(`^${name}`) }).first());
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Patterns' })).toHaveCount(0);
  await expect(patternName(page)).toHaveText(name);
}

/** The Practice song (one looping Rock 8ths section) playing at 100 BPM, no count-in. */
async function startPractice(page: Page): Promise<void> {
  await open(page);
  await setCountInOff(page);
  await clearLog(page);
  await press(page, play(page));
  await expect(stopBtn(page)).toBeVisible();
  await expect.poll(() => mode(page)).toBe('song');
}

/**
 * The tick -> time mapping must stay one straight line (no restart, no tempo/phase jump) and the sound must not
 * stop for more than a beat.
 */
async function expectContinuous(page: Page, bpm = 100): Promise<void> {
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

const waitMore = (page: Page, ms = 700) => page.waitForTimeout(ms);

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} link`, () => {
    test.use(LAYOUTS[name]);

    test('Drummer -> Editor continues the same beat; edits are live; the section follows the copy', async ({ page }) => {
      await startPractice(page);
      await waitMore(page);
      await goEditor(page);
      await expect(patternName(page)).toHaveText('Rock 8ths');
      await expect(stopBtn(page)).toBeVisible();
      expect(await mode(page)).toBe('song');
      await waitMore(page);
      await expectContinuous(page);

      // editing the built-in makes a copy; a new note is heard live and the song keeps playing it
      await clearLog(page);
      if (isMobile(page)) await press(page, page.getByRole('button', { name: 'Snare pad' }));
      for (const s of [2, 6, 10, 14]) await press(page, cell(page, 'snare', s));
      await expect(patternName(page)).toHaveText('My Rock 8ths');
      await expect.poll(async () => (await log(page)).some((e) => e.sound === 'snare' && e.tick % 480 === 240), { timeout: 4000 }).toBe(true);
      expect(await mode(page)).toBe('song');

      await goDrummer(page);
      await expect(stopBtn(page)).toBeVisible();
      expect(await mode(page)).toBe('song');
      await expect(cards(page).nth(0).getByRole('button', { name: /^Section groove:/ })).toContainText('My Rock 8ths');
      await waitMore(page);
      await expectContinuous(page);
    });

    test('another beat in the editor keeps the sound going (lab); back to the Drummer stops it', async ({ page }) => {
      await startPractice(page);
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
      await startPractice(page);
      await goEditor(page);
      await press(page, page.getByRole('button', { name: 'Duplicate pattern' }));
      await expect(patternName(page)).toHaveText('Rock 8ths copy');
      await expect.poll(() => mode(page)).toBe('lab');
      await goDrummer(page);
      await expect.poll(() => mode(page)).toBe('idle');
    });

    test('the section that is playing right now is the one the editor opens', async ({ page }) => {
      await open(page);
      await setCountInOff(page);
      // second section with another groove, jumped to while playing
      await press(page, page.getByRole('button', { name: 'Add Chorus', exact: true }));
      await pickGroove(page, cards(page).nth(1), 'Punk');
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, cards(page).nth(1).locator('.sc-l1 .sc-num'));
      await expect(page.getByTestId('now-name')).toHaveText('Chorus', { timeout: 6000 });
      await goEditor(page);
      await expect(patternName(page)).toHaveText('Punk');
      expect(await mode(page)).toBe('song');
    });

    test('Editor Play when stopped loops the pattern alone; Stop stops', async ({ page }) => {
      await page.goto('./#/editor');
      await expect(patternName(page)).toHaveText('Rock 8ths');
      await press(page, play(page));
      await expect.poll(() => mode(page)).toBe('lab');
      await press(page, stopBtn(page));
      await expect.poll(() => mode(page)).toBe('idle');
    });

    test('old #/assistant and #/lab URLs redirect', async ({ page }) => {
      await page.goto('./#/lab');
      await expect(patternName(page)).toBeVisible();
      await expect(page).toHaveURL(/#\/editor$/);
      await page.goto('./#/assistant');
      await page.reload();
      await expect(page.getByRole('region', { name: 'Drummer', exact: true })).toBeVisible();
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
