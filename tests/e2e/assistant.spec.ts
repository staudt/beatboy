import { mkdirSync } from 'node:fs';
import { expect, test as base, type Locator, type Page } from '@playwright/test';

const ORIGIN = 'http://localhost:4173/';

const LAYOUTS = {
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
} as const;
type LayoutName = keyof typeof LAYOUTS;

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
const log = (page: Page): Promise<Entry[]> =>
  page.evaluate(() => (window as unknown as { __beatboy: { scheduledLog: Entry[] } }).__beatboy.scheduledLog.map((e) => ({ ...e })));
const clearLog = (page: Page) =>
  page.evaluate(() => (window as unknown as { __beatboy: { scheduledLog: Entry[] } }).__beatboy.scheduledLog.splice(0));

const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 900;
async function press(page: Page, loc: Locator): Promise<void> {
  if (isMobile(page)) await loc.tap();
  else await loc.click();
}

const play = (page: Page) => page.getByRole('button', { name: 'Play', exact: true });
const stopBtn = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });
const fillBtn = (page: Page) => page.getByTestId('fill-btn');
const bpmInput = (page: Page) => page.getByRole('textbox', { name: 'Tempo in BPM' });

async function open(page: Page): Promise<void> {
  await page.goto('./');
  await expect(play(page)).toBeVisible();
}

async function setBpm(page: Page, v: number): Promise<void> {
  await bpmInput(page).fill(String(v));
  await bpmInput(page).press('Enter');
  await expect(bpmInput(page)).toHaveValue(String(v));
}

async function setCountIn(page: Page, v: 'Off' | '1' | '2'): Promise<void> {
  const b = page.getByRole('group', { name: 'Count-in' }).getByRole('button', { name: v, exact: true });
  await press(page, b);
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

async function pickGroove(page: Page, name: string): Promise<void> {
  await press(page, page.getByRole('button', { name: /^Groove:/ }));
  await press(page, page.getByRole('dialog', { name: 'Groove' }).getByRole('option', { name: new RegExp(name) }));
  await expect(page.getByTestId('groove-name')).toHaveText(name);
}

async function setClick(page: Page, on: boolean): Promise<void> {
  const b = page.getByRole('button', { name: /^Click (on|off)$/ });
  if ((await b.getAttribute('aria-pressed')) !== String(on)) await press(page, b);
  await expect(b).toHaveAttribute('aria-pressed', String(on));
}

test('defaults to the Assistant and keeps same-origin requests only', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await open(page);
  await expect(page.getByRole('region', { name: 'Drum Assistant' })).toBeVisible();
  await expect(bpmInput(page)).toHaveValue('100');
  await expect(page.getByTestId('groove-name')).toHaveText('Click only');
  await expect(fillBtn(page)).toBeDisabled();
  for (const u of urls) if (!u.startsWith('data:') && !u.startsWith('blob:')) expect(u.startsWith(ORIGIN), u).toBe(true);
});

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} layout`, () => {
    test.use(LAYOUTS[name]);

    test('workflow A: 120 BPM click with a 1-bar count-in', async ({ page }) => {
      await open(page);
      await setBpm(page, 120);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => (await log(page)).length, { timeout: 2000 }).toBeGreaterThan(0);
      await page.waitForTimeout(2700);
      const entries = await log(page);
      const accents = entries.filter((e) => e.sound === 'clickAccent');
      const clicks = entries.filter((e) => e.sound === 'click');
      expect(accents.length).toBeGreaterThanOrEqual(2);
      expect(clicks.length).toBeGreaterThanOrEqual(3);
      const first = entries[0] as Entry;
      expect(first.sound).toBe('clickAccent');
      expect(Math.round(first.tick)).toBe(-1920);
      // first downbeat after the count-in is one bar (2 s at 120 BPM) after the first count-in click
      const down = accents.find((e) => Math.round(e.tick) === 0) as Entry;
      expect(down).toBeTruthy();
      expect(Math.abs(down.time - first.time - 2.0)).toBeLessThan(0.005);
      // lamps advance (we are past the count-in)
      await expect(page.locator('.gv-lamp.is-on')).toHaveCount(1);
      const seen = new Set<string>();
      for (let i = 0; i < 12; i++) {
        seen.add(String(await page.locator('.gv-lamp').evaluateAll((l) => l.findIndex((x) => x.classList.contains('is-on')))));
        await page.waitForTimeout(150);
      }
      expect(seen.size).toBeGreaterThan(1);
      await press(page, stopBtn(page));
      await expect(play(page)).toBeVisible();
    });

    test('workflow B: groove, click off, fill with crash', async ({ page }) => {
      await open(page);
      await setBpm(page, 120);
      await pickGroove(page, 'Rock 8ths');
      await expect(fillBtn(page)).toBeDisabled();
      await setCountIn(page, 'Off');
      await press(page, play(page));
      await expect(fillBtn(page)).toBeEnabled();
      await page.waitForTimeout(2300);
      let entries = await log(page);
      const kick0 = entries.find((e) => e.sound === 'kick' && Math.round(e.tick) === 0) as Entry;
      expect(kick0).toBeTruthy();
      for (const [sound, tick] of [
        ['snare', 480],
        ['hatClosed', 240],
        ['kick', 960],
        ['clickAccent', 0],
        ['click', 480],
      ] as const) {
        const e = entries.find((x) => x.sound === sound && Math.round(x.tick) === tick);
        expect(e, `${sound}@${tick}`).toBeTruthy();
        expect(Math.abs((e as Entry).time - kick0.time - tick / 960)).toBeLessThan(0.005);
      }

      // click off: no clicks scheduled afterwards
      await setClick(page, false);
      await page.waitForTimeout(400);
      await clearLog(page);
      await page.waitForTimeout(1200);
      expect((await log(page)).filter((e) => e.sound.startsWith('click'))).toEqual([]);

      // fill
      await clearLog(page);
      await press(page, fillBtn(page));
      await expect(fillBtn(page)).toHaveAttribute('data-state', /queued|active/);
      await expect(fillBtn(page)).toHaveAttribute('data-state', 'active');
      await expect(fillBtn(page)).toHaveAttribute('data-state', 'none', { timeout: 6000 });
      entries = await log(page);
      const toms = entries.filter((e) => e.sound.startsWith('tom'));
      expect(toms.length).toBeGreaterThan(0);
      const crash = entries.find((e) => e.sound === 'crash') as Entry;
      expect(crash).toBeTruthy();
      expect(Math.round(crash.tick) % 1920).toBe(0);
      expect(Math.max(...toms.map((e) => e.tick))).toBeLessThan(crash.tick);
      await press(page, stopBtn(page));
      await expect(fillBtn(page)).toBeDisabled();
    });

    test('count-in countdown 4..1 then lamps', async ({ page }) => {
      await open(page);
      await setBpm(page, 60);
      await press(page, play(page));
      const cd = page.getByTestId('countdown');
      for (const n of ['4', '3', '2', '1']) await expect(cd).toHaveText(n);
      await expect(cd).toHaveCount(0);
      await expect(page.locator('.gv-lamp')).toHaveCount(4);
      await expect(page.locator('.gv-lamp.is-on')).toHaveCount(1);
    });

    test('settings persist across reload', async ({ page }) => {
      await open(page);
      await setBpm(page, 133);
      await setCountIn(page, '2');
      await press(page, page.getByRole('button', { name: 'Beats down' }));
      await expect(page.getByRole('group', { name: 'Beats' }).locator('output')).toHaveText('3');
      await pickGroove(page, 'Punk');
      await setClick(page, false);
      await page.waitForTimeout(700);
      await page.reload();
      await expect(play(page)).toBeVisible();
      await expect(bpmInput(page)).toHaveValue('133');
      await expect(page.getByRole('group', { name: 'Beats' }).locator('output')).toHaveText('3');
      await expect(page.getByRole('group', { name: 'Count-in' }).getByRole('button', { name: '2', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('groove-name')).toHaveText('Punk');
      await expect(page.getByRole('button', { name: /^Click (on|off)$/ })).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.gv-lamp')).toHaveCount(3);
    });

    test('Edit in Beat Lab opens that pattern', async ({ page }) => {
      await open(page);
      await expect(page.getByRole('button', { name: 'Edit in Beat Lab' })).toHaveCount(0);
      await pickGroove(page, 'Punk');
      await press(page, page.getByRole('button', { name: 'Edit in Beat Lab' }));
      await expect(page).toHaveURL(/#\/lab$/);
      await expect(page.getByTestId('pattern-name')).toHaveText('Punk');
    });

    test('hold + repeats and the slider/tap set the tempo', async ({ page }) => {
      await open(page);
      await setBpm(page, 100);
      await press(page, page.getByRole('button', { name: 'Tempo up' }));
      await expect(bpmInput(page)).toHaveValue('101');
      await page.getByRole('slider', { name: 'Tempo slider' }).fill('150');
      await expect(bpmInput(page)).toHaveValue('150');
      // press and hold
      const up = (await page.getByRole('button', { name: 'Tempo up' }).boundingBox())!;
      await page.mouse.move(up.x + up.width / 2, up.y + up.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(1200);
      await page.mouse.up();
      expect(Number(await bpmInput(page).inputValue())).toBeGreaterThan(155);
      // no horizontal page scroll
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('screenshots', async ({ page }) => {
      mkdirSync('test-results/screenshots', { recursive: true });
      const shot = (n: string) => page.screenshot({ path: `test-results/screenshots/${name}-${n}.png` });
      await open(page);
      await setBpm(page, 120);
      await pickGroove(page, 'Rock 8ths');
      await shot('assistant');
      await setCountIn(page, 'Off');
      await press(page, play(page));
      await page.waitForTimeout(1300);
      await press(page, fillBtn(page));
      await page.waitForTimeout(500);
      await shot('assistant-playing');
      await press(page, stopBtn(page));
      if (name === 'mobile') {
        await setBpm(page, 60);
        await setCountIn(page, '1');
        await press(page, play(page));
        await expect(page.getByTestId('countdown')).toHaveText('3');
        await shot('assistant-countin');
        await press(page, stopBtn(page));
      }
    });
  });
}

test.describe('desktop keyboard', () => {
  test.use(LAYOUTS.desktop);

  test('Space, F, arrows and T on the Assistant', async ({ page }) => {
    await open(page);
    await setBpm(page, 100);
    await pickGroove(page, 'Rock 8ths');
    await setCountIn(page, 'Off');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    await expect(stopBtn(page)).toBeVisible();
    await expect(page.getByTestId('playing-assistant')).toBeVisible();
    await page.keyboard.press('f');
    await expect(fillBtn(page)).toHaveAttribute('data-state', /queued|active/);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await expect(bpmInput(page)).toHaveValue('102');
    await page.keyboard.press('ArrowDown');
    await expect(bpmInput(page)).toHaveValue('101');
    // the engine follows the groove's own tempo
    await expect.poll(() => page.evaluate(() => (window as unknown as { __beatboy: { engine: { bpm: number } } }).__beatboy.engine.bpm)).toBe(101);
    // arrows on a focused slider keep their own behavior
    await page.getByRole('slider', { name: 'Tempo slider' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(bpmInput(page)).toHaveValue('102');
    // Space toggles even with a slider focused
    await page.keyboard.press('Space');
    await expect(play(page)).toBeVisible();
  });

  test('Space plays the lab on #/lab; groove hands over to the lab and back', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Space');
    await expect(stopBtn(page)).toBeVisible();
    await page.getByRole('button', { name: /Beat Lab/ }).click();
    // the groove is playing: the lab shows stopped (and the tab dot marks the groove)
    await expect(play(page)).toBeVisible();
    await expect(page.getByTestId('playing-assistant')).toBeVisible();
    await expect(page.getByTestId('playing-lab')).toHaveCount(0);
    await play(page).click();
    await expect(stopBtn(page)).toBeVisible();
    await expect(page.getByTestId('playing-lab')).toBeVisible();
    await expect(page.getByTestId('playing-assistant')).toHaveCount(0);
    await page.getByRole('button', { name: /Assistant/ }).click();
    await expect(play(page)).toBeVisible();
    // Space on the lab toggles the lab pattern
    await page.getByRole('button', { name: /Beat Lab/ }).click();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Space');
    await expect(play(page)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(stopBtn(page)).toBeVisible();
    await page.keyboard.press('Space');
    await expect(play(page)).toBeVisible();
  });
});
