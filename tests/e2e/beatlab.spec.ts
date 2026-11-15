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

const beatText = (page: Page): Locator => page.getByRole('textbox', { name: 'Beat text' });

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
    const cur = parseInt((await out.textContent()) ?? '0', 10);
    if (cur === beats) break;
    const down = cur > beats;
    await press(page, page.getByRole('button', { name: `Beats ${down ? 'down' : 'up'}` }));
    if (down) {
      const ok = page.getByRole('dialog').getByRole('button', { name: 'Remove' });
      if (await ok.isVisible().catch(() => false)) await press(page, ok);
    }
  }
  await expect(out).toHaveText(`${beats} beat${beats === 1 ? '' : 's'}`);
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

const trigger = (page: Page): Locator => page.getByRole('button', { name: /^Patterns:/ });
const panel = (page: Page): Locator => page.getByRole('dialog', { name: 'Patterns' });
const nameField = (page: Page): Locator => page.getByRole('textbox', { name: 'Pattern name' });
const option = (page: Page, name: RegExp | string): Locator => panel(page).getByRole('option', { name });

async function openPicker(page: Page): Promise<void> {
  await press(page, trigger(page));
  await expect(panel(page)).toBeVisible();
}

async function closePicker(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
}

/** Creates a new beat; the panel stays open for naming, so close it. */
async function newBeat(page: Page): Promise<void> {
  await openPicker(page);
  await press(page, panel(page).getByRole('button', { name: 'New beat' }));
  await closePicker(page);
}

async function waitSaved(page: Page): Promise<void> {
  await expect(page.locator('.chip-saved')).toHaveText('Saved');
}

async function open(page: Page): Promise<void> {
  await page.goto('./#/editor');
  await expect(patternName(page)).toBeVisible();
}

test('loads at the sub-path with same-origin requests only and the default pattern', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (req) => urls.push(req.url()));
  await page.goto('./#/editor');
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

    test('select a pad and toggle a step on/off (accent/ghost only via the popover)', async ({ page }) => {
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
      await expect(c).toHaveAttribute('aria-label', 'Snare step 1, off');
      await expect(c).toHaveAttribute('aria-pressed', 'false');
      await press(page, c);
      await expect(c).toHaveAttribute('aria-label', 'Snare step 1, normal');
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
      // A plain tap on an accented step turns it off (it does not cycle to ghost).
      await press(page, c);
      await expect(c).toHaveAttribute('aria-label', 'Snare step 2, off');
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
      await openPicker(page);
      await expect(option(page, /^Rock 8ths/)).toBeVisible();
    });

    test('beat text: live apply, errors, Escape and blur revert', async ({ page }) => {
      await open(page);
      await newBeat(page);
      await expect(patternName(page)).toHaveText('Beat 1');
      const box = beatText(page);
      await expect(box).toBeVisible();
      await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
      await box.fill('kh . h .  sh . h .  kh . kh .  sh . h .');
      await expect(page.locator('.parse.ok')).toContainText('16 steps · 4 beats');
      if (isMobile(page)) await press(page, page.getByRole('tab', { name: 'Grid' }));
      await press(page, pad(page, 'Kick'));
      // 8th-note text (written with its rests) lands on every other square of the 16th grid.
      for (const s of [0, 8, 10]) await expect(cell(page, 'kick', s)).toHaveAttribute('aria-pressed', 'true');
      await expect(cell(page, 'kick', 4)).toHaveAttribute('aria-pressed', 'false');
      await press(page, pad(page, 'Snare'));
      for (const s of [4, 12]) await expect(cell(page, 'snare', s)).toHaveAttribute('aria-pressed', 'true');
      await press(page, pad(page, 'Hi-hat closed'));
      for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) await expect(cell(page, 'hatClosed', s)).toHaveAttribute('aria-pressed', 'true');
      await expect(cell(page, 'hatClosed', 1)).toHaveAttribute('aria-pressed', 'false');

      // Invalid text: error shown, last valid pattern kept.
      await box.fill('k h\nk q');
      await expect(page.locator('.parse.err')).toContainText("Line 2, col 3: Unknown sound 'q'");
      await page.waitForTimeout(500);
      await expect(cell(page, 'hatClosed', 2)).toHaveAttribute('aria-pressed', 'true');
      await box.fill('k . . . '.repeat(33));
      await expect(page.locator('.parse.err')).toContainText('Too many steps: maximum is 128 (32 beats)');
      await page.waitForTimeout(500);
      await expect(cell(page, 'hatClosed', 2)).toHaveAttribute('aria-pressed', 'true');

      // Escape reverts the field to the pattern's text and blurs.
      await box.focus();
      await box.press('Escape');
      await expect(box).not.toBeFocused();
      await expect(page.locator('.parse.ok')).toContainText('16 steps · 4 beats');
      await expect(box).toHaveValue(/^kh \. h \./);

      // Blur with invalid text reverts too, with a hint.
      await box.fill('k q');
      await expect(page.locator('.parse.err')).toBeVisible();
      await box.blur();
      await expect(page.getByText('Reverted — invalid beat')).toBeVisible();
      await expect(box).toHaveValue(/^kh \. h \./);
    });

    test('beat text sits directly above the step grid (below the pads on phones), no tab switch needed', async ({ page }) => {
      await open(page);
      const box = (await beatText(page).boundingBox())!;
      const padBox = (await pad(page, 'Kick').boundingBox())!;
      const gridBox = (await cell(page, 'kick', 0).boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(gridBox.y);
      if (isMobile(page)) {
        expect(padBox.y + padBox.height).toBeLessThanOrEqual(box.y);
        const tabs = (await page.getByRole('tablist', { name: 'Editor view' }).boundingBox())!;
        expect(tabs.y + tabs.height).toBeLessThanOrEqual(box.y);
        // The MIX tab shows the mix without the text field.
        await press(page, page.getByRole('tab', { name: 'Mix' }));
        await expect(beatText(page)).toHaveCount(0);
        await press(page, page.getByRole('tab', { name: 'Grid' }));
        await expect(beatText(page)).toBeVisible();
      } else {
        // Inside the grid panel, right column, beside (not above) the pads.
        const panel = page.getByRole('region', { name: 'Pattern grid' });
        await expect(panel.getByRole('textbox', { name: 'Beat text' })).toBeVisible();
        expect(box.x).toBeGreaterThanOrEqual(padBox.x + padBox.width);
        const length = (await panel.getByRole('group', { name: 'Beats', exact: true }).boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(length.y);
      }
      await expect(page.getByRole('tab', { name: 'Text' })).toHaveCount(0);
    });

    test('every pad shows its notation letter as a key-cap badge', async ({ page }) => {
      await open(page);
      const expected: Record<string, string> = {
        Kick: 'k', Snare: 's', 'Side stick': 'j', Clap: 'l', 'Hi-hat closed': 'h', 'Hi-hat pedal': 'd', 'Hi-hat open': 'o', Ride: 'r',
        'Ride bell': 'e', Crash: 'c', 'Crash 2': 'i', 'High tom': 't', 'Mid tom': 'm', 'Floor tom': 'f', Tambourine: 'z', Cowbell: 'w',
      };
      expect(Object.keys(expected)).toHaveLength(16);
      for (const [name, letter] of Object.entries(expected)) {
        const p = page.getByRole('button', { name: `${name} pad, letter ${letter}`, exact: true });
        await expect(p.getByTestId('sound-key')).toHaveText(letter);
        await expect(p).toHaveAttribute('title', `${name} \u2014 type ${letter}`);
        // The badge stays inside the pad and does not cover the label.
        const pb = (await p.boundingBox())!;
        const kb = (await p.getByTestId('sound-key').boundingBox())!;
        const lb = (await p.locator('.pad-label').boundingBox())!;
        expect(kb.x).toBeGreaterThanOrEqual(pb.x);
        expect(kb.y + kb.height).toBeLessThanOrEqual(lb.y + lb.height);
        expect(kb.y + kb.height <= lb.y + 1 || kb.x + kb.width <= lb.x + 1 || kb.y >= lb.y + lb.height).toBe(true);
      }
    });

    test('typing applies live; grid edits rewrite the field', async ({ page }) => {
      await open(page);
      await newBeat(page);
      await beatText(page).fill('kh . h .  sh . h .');
      await press(page, pad(page, 'Kick'));
      await expect(cell(page, 'kick', 0)).toHaveAttribute('aria-pressed', 'true', { timeout: 1000 });
      // Grid edit -> field text.
      await press(page, cell(page, 'kick', 3));
      await expect(beatText(page)).toHaveValue(/^kh \. h k/);
    });

    test('a grid change does not clobber the field while typing; blur shows the merged result', async ({ page }) => {
      await open(page);
      await newBeat(page);
      const box = beatText(page);
      await box.fill('k . . .  s . . .  h');
      await expect(page.locator('.parse.ok')).toHaveText('9 steps');
      // A grid toggle that happens elsewhere while the field is focused (synthetic mouse press, no blur).
      await cell(page, 'kick', 0).evaluate((el) => {
        const o = { bubbles: true, pointerType: 'mouse', button: 0 };
        el.dispatchEvent(new PointerEvent('pointerdown', o));
        document.dispatchEvent(new PointerEvent('pointerup', o));
      });
      await page.waitForTimeout(500);
      await expect(box).toBeFocused();
      await expect(box).toHaveValue('k . . .  s . . .  h');
      await box.blur();
      // Desktop keeps 4 beats per line; phones break every 2 beats.
      await expect(box).toHaveValue(/^\. \. \. \.  s \. \. \.( \|\n|  )h/);
    });

    test('editing a built-in by typing makes a My copy that survives reload', async ({ page }) => {
      await open(page);
      await expect(patternName(page)).toHaveText('Rock 8ths');
      await beatText(page).fill('k . s .');
      await expect(patternName(page)).toHaveText('My Rock 8ths');
      await expect(page.getByRole('status').filter({ hasText: 'Saved as My Rock 8ths' })).toBeVisible();
      await expect(page.locator('.chip-saved')).toHaveText('Saved');
      await page.reload();
      await expect(patternName(page)).toHaveText('My Rock 8ths');
      await expect(beatText(page)).toHaveValue(/^k \. s \./);
    });

    test('Space types in the beat text and does not start playback', async ({ page }) => {
      await open(page);
      const box = beatText(page);
      await box.fill('k');
      await box.press('Space');
      await expect(box).toHaveValue('k ');
      await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
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
      // Desktop: the beat text sits above the grid header inside the panel; the header follows it.
      const textBox = isMobile(page) ? null : (await beatText(page).boundingBox())!;
      expect(gb.y - (textBox ? textBox.y + textBox.height : pb.y)).toBeLessThanOrEqual(isMobile(page) ? 24 : 110);
      expect(gb.x).toBeGreaterThan(pb.x + pb.width / 2);

      // An empty last beat is removed without asking.
      await press(page, page.getByRole('button', { name: 'Beats up' }));
      await expect(beatsOut(page)).toHaveText('5 beats');
      await expect(page.locator('[data-cell][data-sound="kick"]')).toHaveCount(20);
      await press(page, page.getByRole('button', { name: 'Beats down' }));
      await expect(beatsOut(page)).toHaveText('4 beats');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await press(page, cell(page, 'kick', 0));
      await press(page, cell(page, 'kick', 14));
      await press(page, page.getByRole('button', { name: 'Beats up' }));
      // The new beat is empty (not a copy).
      for (const s of [16, 17, 18, 19]) await expect(cell(page, 'kick', s)).toHaveAttribute('aria-pressed', 'false');
      await expect(cell(page, 'kick', 14)).toHaveAttribute('aria-pressed', 'true');
      await press(page, page.getByRole('button', { name: 'Beats down' }));
      await expect(beatsOut(page)).toHaveText('4 beats');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await press(page, page.getByRole('button', { name: 'Beats down' }));
      const dlg = page.getByRole('dialog', { name: 'Remove beat 4?' });
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText('It has notes.');
      await press(page, dlg.getByRole('button', { name: 'Cancel' }));
      await expect(beatsOut(page)).toHaveText('4 beats');
      await press(page, page.getByRole('button', { name: 'Beats down' }));
      await press(page, page.getByRole('dialog').getByRole('button', { name: 'Remove' }));
      await expect(beatsOut(page)).toHaveText('3 beats');
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

    test('pattern picker: new, duplicate, rename, delete', async ({ page }) => {
      await open(page);
      // Built-ins can't be deleted.
      await expect(page.getByRole('button', { name: 'Delete pattern' })).toBeDisabled();

      await newBeat(page);
      await expect(patternName(page)).toHaveText('Beat 1');

      await press(page, page.getByRole('button', { name: 'Duplicate pattern' }));
      await expect(patternName(page)).toHaveText('Beat 1 copy');

      await openPicker(page);
      await nameField(page).fill('Groove');
      await nameField(page).press('Enter');
      await expect(panel(page)).toHaveCount(0);
      await expect(patternName(page)).toHaveText('Groove');

      await openPicker(page);
      await expect(option(page, /^Beat 1\b/).first()).toBeVisible();
      await expect(option(page, /^Groove/)).toHaveAttribute('aria-selected', 'true');
      await press(page, option(page, /^Beat 1 /).first());
      await expect(panel(page)).toHaveCount(0);
      await expect(patternName(page)).toHaveText('Beat 1');
      await openPicker(page);
      await press(page, option(page, /^Groove/));
      await expect(patternName(page)).toHaveText('Groove');

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
      await openPicker(page);
      await expect(option(page, /^Groove/)).toHaveCount(0);
    });

    test('picker: panel opens directly below the trigger and stays inside the viewport', async ({ page }) => {
      await open(page);
      await openPicker(page);
      const t = (await trigger(page).boundingBox())!;
      const pb = (await panel(page).boundingBox())!;
      const vw = page.viewportSize()!.width;
      expect(pb.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
      expect(pb.y - (t.y + t.height)).toBeLessThan(16);
      expect(pb.x).toBeGreaterThanOrEqual(0);
      expect(pb.x + pb.width).toBeLessThanOrEqual(vw);
      if (isMobile(page)) {
        expect(pb.x).toBeCloseTo(16, 0);
        expect(pb.width).toBeCloseTo(vw - 32, 0);
      } else {
        expect(pb.width).toBeCloseTo(360, 0);
        expect(Math.abs(pb.x - t.x)).toBeLessThan(2);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });

    test('picker: typing renames live and persists; Escape reverts', async ({ page }) => {
      await open(page);
      await newBeat(page);
      await openPicker(page);
      await nameField(page).fill('Funk idea');
      await expect(patternName(page)).toHaveText('Funk idea');
      await nameField(page).press('Enter');
      await expect(panel(page)).toHaveCount(0);
      await waitSaved(page);
      await page.reload();
      await expect(patternName(page)).toHaveText('Funk idea');

      await openPicker(page);
      await nameField(page).fill('Oops');
      await expect(patternName(page)).toHaveText('Oops');
      await page.keyboard.press('Escape');
      await expect(panel(page)).toHaveCount(0);
      await expect(patternName(page)).toHaveText('Funk idea');
    });

    test('picker: search filters rows', async ({ page }) => {
      await open(page);
      await openPicker(page);
      const all = await panel(page).getByRole('option').count();
      expect(all).toBeGreaterThan(8);
      await panel(page).getByRole('searchbox', { name: 'Find pattern' }).fill('rock');
      const n = await panel(page).getByRole('option').count();
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThan(all);
      await expect(option(page, /^Rock 8ths/)).toBeVisible();
      await expect(option(page, /^Funk/)).toHaveCount(0);
      await panel(page).getByRole('searchbox', { name: 'Find pattern' }).fill('zzzz');
      await expect(panel(page).getByRole('option')).toHaveCount(0);
    });

    test('picker: + New beat keeps the panel open ready to name', async ({ page }) => {
      await open(page);
      await openPicker(page);
      await press(page, panel(page).getByRole('button', { name: 'New beat' }));
      await expect(panel(page)).toBeVisible();
      await expect(patternName(page)).toHaveText('Beat 1');
      await expect(nameField(page)).toHaveValue('Beat 1');
      if (!isMobile(page)) {
        await expect(nameField(page)).toBeFocused();
        await page.keyboard.type('Named at once');
        await expect(patternName(page)).toHaveText('Named at once');
      }
    });

    test('picker: clicking outside closes', async ({ page }) => {
      await open(page);
      await openPicker(page);
      await page.mouse.click(5, page.viewportSize()!.height - 5);
      await expect(panel(page)).toHaveCount(0);
    });
  });
}

test('desktop picker: renaming a built-in makes a copy and keeps focus; arrows + Enter select', async ({ browser }) => {
  const ctx = await browser.newContext(LAYOUTS.desktop);
  const page = await ctx.newPage();
  await open(page);
  await openPicker(page);
  await expect(nameField(page)).toBeFocused();
  const rows = await page.getByRole('option').count();

  // Escape after typing a name for a built-in leaves no stray copy behind.
  await page.keyboard.type('Scratch name', { delay: 30 });
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(patternName(page)).toHaveText('Rock 8ths');
  await openPicker(page);
  await expect(page.getByRole('option')).toHaveCount(rows);
  await expect(option(page, /^Scratch name/)).toHaveCount(0);

  // For a built-in the name is a draft until committed with Enter (no copy while typing).
  await page.keyboard.type('My own groove', { delay: 120 });
  await expect(patternName(page)).toHaveText('Rock 8ths');
  await expect(nameField(page)).toBeFocused();
  await expect(nameField(page)).toHaveValue('My own groove');
  await page.keyboard.press('Enter');
  await waitSaved(page);
  await page.reload();
  await expect(patternName(page)).toHaveText('My own groove');
  // The built-in is untouched.
  await openPicker(page);
  await expect(option(page, /^Rock 8ths/)).toBeVisible();

  // Keyboard selection from the search field.
  const search = page.getByRole('searchbox', { name: 'Find pattern' });
  await search.focus();
  await search.fill('rock');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const active = await search.getAttribute('aria-activedescendant');
  expect(active).toBeTruthy();
  const label = await page.locator(`[id="${active}"] .bi-name`).textContent();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toHaveCount(0);
  await expect(patternName(page)).toHaveText(label!);
  await expect(trigger(page)).toBeFocused();
  await ctx.close();
});

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
    await lane.scrollIntoViewIfNeeded();
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
    await expect(cell(page, 'kick', 2)).toHaveAttribute('aria-label', 'Kick step 3, off');
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
  await page.goto('./#/editor');
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
  await page.goto('./#/editor');
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
    await page.goto('./#/editor');
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

test('drummer tab is reachable from the editor', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Drummer/ }).click();
  await expect(page.getByRole('region', { name: 'Drummer' })).toBeVisible();
  await expect(page).toHaveURL(/#\/drummer$/);
});

test('screenshots', async ({ browser }) => {
  mkdirSync('test-results/screenshots', { recursive: true });
  for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
    const ctx = await browser.newContext(LAYOUTS[name]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./#/editor');
    await expect(patternName(page)).toBeVisible();
    const shot = (n: string) => page.screenshot({ path: `test-results/screenshots/${name}-${n}.png`, fullPage: true });

    await beatText(page).fill('kh . h . sh . h .  kh . kh . sh . h .  kh . h . sh . h .  k . . . s . . .  kh . h . sh . h .  kh . h . s s s .');
    await page.waitForTimeout(450);
    await press(page, pad(page, 'Snare'));
    await press(page, cell(page, 'snare', 3));
    await press(page, cell(page, 'snare', 3));
    await press(page, cell(page, 'snare', 7));
    await press(page, cell(page, 'snare', 7));
    await press(page, cell(page, 'snare', 7));
    await page.waitForTimeout(450);
    await shot('editor');

    await beatText(page).fill('k');
    await beatText(page).pressSequentially(' q');
    await expect(page.locator('.parse.err')).toBeVisible();
    await shot('editor-error');
    await beatText(page).press('Escape');

    if (isMobile(page)) {
      await press(page, page.getByRole('tab', { name: 'Mix' }));
      await press(page, page.getByRole('button', { name: 'Mute Hi-hat closed' }));
    } else {
      await press(page, page.getByRole('button', { name: 'Mute Hi-hat closed' }));
    }
    await shot('mix');

    if (isMobile(page)) await press(page, page.getByRole('tab', { name: 'Grid' }));
    await openPicker(page);
    await page.waitForTimeout(450);
    await shot('browser');
    await closePicker(page);

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
      await shot(`editor-${label}`);
      if (label === '2x3') await shot('editor-triplet');
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
    await shot('editor-8beats');
    expect(errors).toEqual([]);
    await ctx.close();
  }
});

test.describe('editor layout across widths', () => {
  for (const w of [360, 375, 414, 580, 768, 899, 900, 1024, 1440]) {
    test(`beat text, header and transport do not overlap or overflow at ${w}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: w < 900, isMobile: w < 900 });
      const page = await ctx.newPage();
      await page.goto('./#/editor');
      await expect(patternName(page)).toBeVisible();
      await beatText(page).fill('kh . h .  sh . h .  kh . kh .  sh . h .  kh . h .  sh . h .');
      await expect(page.locator('.parse.ok')).toContainText('24 steps');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = (await beatText(page).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(w);
      const head = (await page.locator('.pattern-header').boundingBox())!;
      const pads = (await pad(page, 'Kick').boundingBox())!;
      expect(head.y + head.height).toBeLessThanOrEqual(box.y + 1);
      const grid = (await cell(page, 'kick', 0).boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(grid.y);
      if (w < 900) expect(pads.y + pads.height).toBeLessThanOrEqual(box.y + 1);
      else expect(box.x).toBeGreaterThanOrEqual(pads.x + pads.width);
      // The caption and its Syntax toggle sit side by side without overlapping.
      const cap = (await page.locator('.beattext-caption .parse').boundingBox())!;
      const tog = (await page.locator('.syntax-toggle').boundingBox())!;
      expect(cap.x + cap.width).toBeLessThanOrEqual(tog.x + 1);
      await ctx.close();
    });
  }
});
