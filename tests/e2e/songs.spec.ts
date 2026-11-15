import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  BAR,
  LAYOUTS,
  ORIGIN,
  at,
  bpmInput,
  breakBtn,
  cards,
  clearLog,
  clickBtn,
  engineBpm,
  expect,
  goDrummer,
  goEditor,
  isMobile,
  log,
  loopBtn,
  makeShortSong,
  mode,
  nav,
  newSong,
  nextBtn,
  nowName,
  open,
  pickGroove,
  pickSong,
  play,
  press,
  queued,
  setBpm,
  setCountInOff,
  songName,
  sounds,
  stopBtn,
  test,
  waitSaved,
  type LayoutName,
} from './fixtures';

const labels = (page: Page) => cards(page).locator('.sc-label').allTextContents();
const toast = (page: Page) => page.locator('.toast');

/** Touch drag through CDP (Playwright has no touch-move API). */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { release?: boolean } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await send('touchStart', from);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await send('touchMove', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
    await page.waitForTimeout(16);
  }
  if (opts.release !== false) await send('touchEnd');
  return { release: () => send('touchEnd') };
}

async function center(page: Page, sel: ReturnType<Page['locator']>) {
  const b = (await sel.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}

async function dragHandle(page: Page, row: number, toRow: number, opts: { release?: boolean } = {}) {
  const h = cards(page).nth(row).locator('.sc-handle');
  await h.scrollIntoViewIfNeeded();
  const a = await center(page, h);
  const target = await center(page, cards(page).nth(toRow));
  const to = { x: a.x, y: target.y + (toRow > row ? 6 : -6) };
  if (isMobile(page)) return touchDrag(page, a, to, opts);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  if (opts.release !== false) await page.mouse.up();
  return { release: () => page.mouse.up() };
}

test('first run: same-origin only, Practice song selected, one tap plays', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await open(page);
  await expect(page.getByRole('region', { name: 'Drummer', exact: true })).toBeVisible();
  await expect(songName(page)).toHaveText('Practice');
  await expect(cards(page)).toHaveCount(1);
  await expect(bpmInput(page)).toHaveValue('100');
  await expect(page.getByRole('button', { name: 'Loop this section' })).toHaveAttribute('aria-pressed', 'true');
  await clearLog(page);
  await press(page, play(page)); // the one tap
  await expect(stopBtn(page)).toBeVisible();
  await expect.poll(async () => at(await log(page), 0, 'kick'), { timeout: 5000 }).toBeTruthy();
  const es = await log(page);
  expect(es.filter((e) => e.sound.startsWith('click') && e.tick < 0).map((e) => Math.round(e.tick))).toEqual([-1920, -1440, -960, -480]);
  await expect(nowName(page)).toHaveText('Groove');
  // it loops: still the same section after its 4 bars have passed
  await expect(page.getByTestId('loop-badge')).toBeVisible();
  await press(page, stopBtn(page));
  await pickSong(page, /^Demo song/);
  await expect(songName(page)).toHaveText('Demo song');
  for (const u of urls) if (!u.startsWith('data:') && !u.startsWith('blob:')) expect(u.startsWith(ORIGIN), u).toBe(true);
});

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} layout`, () => {
    test.use(LAYOUTS[name]);

    test('1. demo song: count-in clicks, then the intro groove; the NOW bar advances', async ({ page }) => {
      await open(page);
      await pickSong(page, /^Demo song/);
      await expect(cards(page)).toHaveCount(8);
      await expect(bpmInput(page)).toHaveValue('112');
      await expect(nowName(page)).toHaveText('Intro');
      await expect(nextBtn(page)).toBeDisabled();
      await setBpm(page, 200);
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect(page.getByTestId('countdown')).toBeVisible();
      await expect.poll(async () => at(await log(page), 0, 'kick'), { timeout: 4000 }).toBeTruthy();
      const es = await log(page);
      const clicks = es.filter((e) => e.sound.startsWith('click') && e.tick < 0);
      expect(clicks.map((e) => Math.round(e.tick))).toEqual([-1920, -1440, -960, -480]);
      expect(clicks[0]!.sound).toBe('clickAccent');
      expect(at(es, 0, 'ride')).toBeTruthy(); // Ride Rock
      await expect(nowName(page)).toHaveText('Intro');
      await expect(page.getByTestId('now-bar')).toContainText('bar 1 / 4');
      await expect(page.getByTestId('now-bar')).toContainText('bar 2 / 4', { timeout: 4000 });
      await expect(cards(page).nth(0)).toHaveAttribute('aria-current', 'true');
      await press(page, stopBtn(page));
      await expect(play(page)).toBeVisible();
      expect(await mode(page)).toBe('idle');
    });

    test('2. workflow: new song, chips, grooves and bars persist across reload', async ({ page }) => {
      await open(page);
      await makeShortSong(page);
      await page.waitForTimeout(600); // shared settings debounce
      await page.reload();
      await expect(play(page)).toBeVisible();
      await expect(songName(page)).toHaveText('Song 1');
      await expect(bpmInput(page)).toHaveValue('200');
      await expect(cards(page)).toHaveCount(3);
      expect(await labels(page)).toEqual(['Intro', 'Verse', 'Chorus']);
      for (const [i, g] of ['Ride Rock', 'Rock 8ths', 'Rock 16ths'].entries()) {
        await expect(cards(page).nth(i).getByRole('button', { name: /^Section groove:/ })).toContainText(g);
        await expect(cards(page).nth(i).getByRole('textbox', { name: 'Bars in section' })).toHaveValue('2');
      }
    });

    test('3. a short song plays end to end on the bar lines, ends with a crash and stops itself', async ({ page }) => {
      await open(page);
      await makeShortSong(page);
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect(nowName(page)).toHaveText('Intro');
      await expect(nowName(page)).toHaveText('Verse', { timeout: 4000 });
      await expect(nowName(page)).toHaveText('Chorus', { timeout: 4000 });
      await expect.poll(async () => at(await log(page), 6 * BAR, 'crash'), { timeout: 6000 }).toBeTruthy();
      const es = await log(page);
      const t0 = at(es, 0, 'kick')!.time;
      for (const bar of [2, 4]) {
        const k = at(es, bar * BAR, 'kick')!;
        expect(k, `kick at bar ${bar}`).toBeTruthy();
        expect(Math.abs(k.time - t0 - bar * 1.2)).toBeLessThan(0.005);
      }
      expect(Math.abs(at(es, 6 * BAR, 'crash')!.time - t0 - 6 * 1.2)).toBeLessThan(0.005);
      expect(at(es, 6 * BAR, 'kick')).toBeTruthy();
      expect(sounds(es, 6 * BAR + 1, 99 * BAR)).toEqual([]);
      await expect(play(page)).toBeVisible({ timeout: 6000 });
      expect(await mode(page)).toBe('idle');
    });

    test('4. NEXT lands on the next bar line; pressing it twice cancels', async ({ page }) => {
      await open(page);
      await makeShortSong(page);
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, nextBtn(page));
      await expect(queued(page)).toContainText(/Next → VERSE/i);
      await expect(nowName(page)).toHaveText('Verse', { timeout: 3000 });
      await expect(queued(page)).toHaveCount(0);
      const es = await log(page);
      const t0 = at(es, 0, 'kick')!.time;
      expect(at(es, 0, 'ride')).toBeTruthy();
      const verse = at(es, BAR, 'hatClosed')!;
      expect(verse).toBeTruthy();
      expect(Math.abs(verse.time - t0 - 1.2)).toBeLessThan(0.005);
      expect(es.filter((e) => e.sound === 'ride' && e.tick >= BAR && e.tick < 3 * BAR)).toEqual([]);
      await press(page, stopBtn(page));

      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, nextBtn(page));
      await expect(queued(page)).toBeVisible();
      await press(page, nextBtn(page));
      await expect(queued(page)).toHaveCount(0);
      await expect.poll(async () => at(await log(page), BAR, 'ride'), { timeout: 3000 }).toBeTruthy();
      await expect(nowName(page)).toHaveText('Intro');
      expect((await log(page)).filter((e) => e.sound === 'hatClosed' && e.tick >= BAR && e.tick < 2 * BAR)).toEqual([]);
    });

    test('5. LOOP repeats the section until it is switched off', async ({ page }) => {
      await open(page);
      await makeShortSong(page);
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, loopBtn(page));
      await expect(loopBtn(page)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByTestId('loop-badge')).toBeVisible();
      await expect.poll(async () => at(await log(page), 2 * BAR, 'ride'), { timeout: 4000 }).toBeTruthy();
      await expect(nowName(page)).toHaveText('Intro');
      await press(page, loopBtn(page));
      await expect(loopBtn(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(nowName(page)).toHaveText('Verse', { timeout: 4000 });
    });

    test('6. BREAK: stab, a silent bar, then the crash that resumes', async ({ page }) => {
      await open(page);
      await makeShortSong(page);
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, breakBtn(page));
      await expect(page.getByTestId('break-badge')).toBeVisible();
      await expect.poll(async () => at(await log(page), 2 * BAR, 'crash'), { timeout: 4000 }).toBeTruthy();
      const es = await log(page);
      expect(at(es, BAR, 'crash')).toBeTruthy();
      expect(at(es, BAR, 'kick')).toBeTruthy();
      expect(sounds(es, BAR + 1, 2 * BAR)).toEqual([]);
      expect(es.some((e) => e.sound.startsWith('click') && e.tick >= BAR && e.tick < 2 * BAR)).toBe(true);
      expect(at(es, 2 * BAR, 'kick')).toBeTruthy();
    });

    test('7. tapping a row while playing jumps at the next bar line; while stopped it picks the start', async ({ page }) => {
      await open(page);
      await makeShortSong(page);
      // stopped: choose the start section
      await press(page, cards(page).nth(1).locator('.sc-num'));
      await expect(cards(page).nth(1)).toHaveClass(/is-selected/);
      await expect(nowName(page)).toHaveText('Verse');
      await press(page, cards(page).nth(0).locator('.sc-num'));
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, cards(page).nth(2).locator('.sc-num'));
      await expect(queued(page)).toContainText(/Jump → CHORUS/i);
      await expect(nowName(page)).toHaveText('Chorus', { timeout: 3000 });
      const es = await log(page);
      const t0 = at(es, 0, 'kick')!.time;
      const hat = at(es, BAR, 'hatClosed')!;
      expect(hat).toBeTruthy();
      expect(Math.abs(hat.time - t0 - 1.2)).toBeLessThan(0.005);
      expect(es.filter((e) => e.sound === 'ride' && e.tick >= BAR)).toEqual([]);
    });

    test('8. the shared tempo follows the song and writes back to it', async ({ page }) => {
      await open(page);
      await expect(bpmInput(page)).toHaveValue('100');
      await pickSong(page, /^Demo song/);
      await expect(bpmInput(page)).toHaveValue('112');
      expect(await engineBpm(page)).toBe(112);
      await setBpm(page, 150);
      expect(await engineBpm(page)).toBe(150);
      await waitSaved(page);
      await newSong(page);
      await expect(songName(page)).toHaveText('Song 1');
      await expect(bpmInput(page)).toHaveValue('150');
      await setBpm(page, 90);
      await pickSong(page, /^Demo song/);
      await expect(bpmInput(page)).toHaveValue('150');
      await pickSong(page, /^Practice/);
      await expect(bpmInput(page)).toHaveValue('100');
      await pickSong(page, /^Demo song/);
      await waitSaved(page);
      await page.waitForTimeout(500);
      await page.reload();
      await expect(songName(page)).toHaveText('Demo song');
      await expect(bpmInput(page)).toHaveValue('150');
      await press(page, page.getByRole('button', { name: /^Song:/ }));
      await expect(page.getByRole('dialog', { name: 'Song' }).getByRole('option', { name: /^Song 1/ })).toContainText('90 BPM');
    });

    test('9. a pattern used by a song cannot be deleted', async ({ page }) => {
      await open(page);
      await goEditor(page);
      await press(page, page.getByRole('button', { name: /^Patterns:/ }));
      await press(page, page.getByRole('dialog', { name: 'Patterns' }).getByRole('button', { name: /New beat/ }));
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('pattern-name')).toHaveText('Beat 1');
      await goDrummer(page);
      await pickGroove(page, cards(page).nth(0), 'Beat 1');
      await goEditor(page);
      await expect(page.getByTestId('pattern-name')).toHaveText('Beat 1');
      await press(page, page.getByRole('button', { name: 'Delete pattern' }));
      const dlg = page.getByRole('dialog', { name: "Can't delete this pattern" });
      await expect(dlg).toContainText('Used in: Practice');
      await expect(dlg.getByRole('button', { name: 'Delete' })).toHaveCount(0);
      await press(page, dlg.getByRole('button', { name: 'OK' }));
      await expect(dlg).toHaveCount(0);
      await expect(page.getByTestId('pattern-name')).toHaveText('Beat 1');
    });

    test('10. CLICK toggles the metronome live while the song plays', async ({ page }) => {
      await open(page);
      await setCountInOff(page);
      await expect(clickBtn(page)).toHaveAttribute('aria-pressed', 'true');
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => (await log(page)).some((e) => e.sound.startsWith('click'))).toBe(true);
      await press(page, clickBtn(page));
      await expect(clickBtn(page)).toHaveAttribute('aria-pressed', 'false');
      await page.waitForTimeout(300);
      await clearLog(page);
      await page.waitForTimeout(1500);
      const off = await log(page);
      expect(off.filter((e) => e.sound.startsWith('click'))).toEqual([]);
      expect(off.length).toBeGreaterThan(0);
      await press(page, clickBtn(page));
      await expect.poll(async () => (await log(page)).some((e) => e.sound.startsWith('click')), { timeout: 3000 }).toBe(true);
      // persisted
      await press(page, clickBtn(page));
      await page.waitForTimeout(600);
      await page.reload();
      await expect(clickBtn(page)).toHaveAttribute('aria-pressed', 'false');
    });

    test('11. rows are inline-editable: rename, bars, copy below, delete + Undo', async ({ page }) => {
      await open(page);
      await pickSong(page, /^Demo song/);
      // rename by tapping the label
      await press(page, cards(page).nth(0).getByRole('button', { name: /^Rename/ }));
      const input = cards(page).nth(0).getByRole('textbox', { name: 'Section name' });
      await input.fill('Count off');
      await input.press('Enter');
      await expect(cards(page).nth(0).locator('.sc-label')).toHaveText('Count off');
      await press(page, cards(page).nth(0).getByRole('button', { name: /^Rename/ }));
      await cards(page).nth(0).getByRole('textbox', { name: 'Section name' }).fill('zzz');
      await page.keyboard.press('Escape');
      await expect(cards(page).nth(0).locator('.sc-label')).toHaveText('Count off');
      // bars stepper
      const bars = cards(page).nth(1).getByRole('textbox', { name: 'Bars in section' });
      await expect(bars).toHaveValue('8');
      await press(page, cards(page).nth(1).getByRole('button', { name: 'Bars up' }));
      await expect(bars).toHaveValue('9');
      await press(page, cards(page).nth(1).getByRole('button', { name: 'Bars down' }));
      await press(page, cards(page).nth(1).getByRole('button', { name: 'Bars down' }));
      await expect(bars).toHaveValue('7');
      // copy: inserted right below
      await press(page, cards(page).nth(1).getByRole('button', { name: 'Duplicate section' }));
      await expect(cards(page)).toHaveCount(9);
      const l = await labels(page);
      expect(l[2]).toBe(l[1]);
      expect(l[0]).toBe('Count off');
      await expect(cards(page).nth(2).getByRole('textbox', { name: 'Bars in section' })).toHaveValue('7');
      // delete + undo restores it in place
      await press(page, cards(page).nth(2).getByRole('button', { name: 'Delete section' }));
      await expect(cards(page)).toHaveCount(8);
      await expect(toast(page)).toContainText('Removed');
      await press(page, toast(page).getByRole('button', { name: 'Undo' }));
      await expect(cards(page)).toHaveCount(9);
      expect(await labels(page)).toEqual(l);
      await expect(toast(page)).toHaveCount(0, { timeout: 6500 });
      // toggles
      const fill = cards(page).nth(0).getByRole('button', { name: 'Fill into next section' });
      await expect(fill).toHaveAttribute('aria-pressed', 'false');
      await press(page, fill);
      await expect(fill).toHaveAttribute('aria-pressed', 'true');
      await waitSaved(page);
    });

    test('12. changing a groove while playing takes effect on the next bars', async ({ page }) => {
      await open(page);
      await setCountInOff(page);
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => at(await log(page), 0, 'kick')).toBeTruthy();
      const offbeatSnare = (es: { sound: string; tick: number }[]) => es.some((e) => e.sound === 'snare' && Math.round(e.tick) % 480 === 240);
      expect(offbeatSnare(await log(page))).toBe(false); // Rock 8ths
      await pickGroove(page, cards(page).nth(0), 'Punk');
      await expect.poll(async () => offbeatSnare(await log(page)), { timeout: 6000 }).toBe(true);
      expect(await mode(page)).toBe('song');
    });

    test('13. reordering: the handle drags; a drag elsewhere scrolls instead; keyboard moves too', async ({ page }) => {
      await open(page);
      await pickSong(page, /^Demo song/);
      const before = await labels(page);
      // dragging the handle of row 0 below row 2
      await dragHandle(page, 0, 2);
      await expect.poll(() => labels(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
      await waitSaved(page);
      // keyboard: focus the handle, ArrowUp moves the row up and announces it
      const h = cards(page).nth(2).locator('.sc-handle');
      await h.focus();
      await page.keyboard.press('ArrowUp');
      await expect.poll(() => labels(page)).toEqual([before[1], before[0], before[2], ...before.slice(3)]);
      await expect(page.getByTestId('announce')).toContainText(/moved to position 2 of 8/);
      await expect(cards(page).nth(1).locator('.sc-handle')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => labels(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
      // survives a reload
      await page.waitForTimeout(500);
      await waitSaved(page);
      await page.reload();
      await expect(songName(page)).toHaveText('Demo song');
      expect(await labels(page)).toEqual([before[1], before[2], before[0], ...before.slice(3)]);
    });

    test('14. keyboard: Space, arrows, B, L, F, C drive the song (desktop)', async ({ page }) => {
      test.skip(isMobile(page), 'keyboard');
      await open(page);
      await pickSong(page, /^Demo song/);
      await setCountInOff(page);
      await page.locator('body').click({ position: { x: 5, y: 300 } });
      await page.keyboard.press('Space');
      await expect(stopBtn(page)).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await expect(queued(page)).toContainText(/Next → VERSE/i);
      await page.keyboard.press('ArrowRight');
      await expect(queued(page)).toHaveCount(0);
      await page.keyboard.press('ArrowRight');
      await expect(nowName(page)).toHaveText(/^Verse/, { timeout: 4000 });
      await page.keyboard.press('ArrowLeft');
      await expect(queued(page)).toContainText(/Prev → INTRO/i);
      await expect(nowName(page)).toHaveText('Intro', { timeout: 4000 });
      await page.keyboard.press('l');
      await expect(loopBtn(page)).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('l');
      await expect(loopBtn(page)).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press('c');
      await expect(clickBtn(page)).toHaveAttribute('aria-pressed', 'false');
      await page.keyboard.press('c');
      await expect(clickBtn(page)).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('f');
      await expect(page.getByTestId('song-fill-btn')).not.toHaveAttribute('data-state', 'none');
      await expect(page.getByTestId('song-fill-btn')).toHaveAttribute('data-state', 'none', { timeout: 6000 });
      await page.keyboard.press('b');
      await expect(page.getByTestId('break-badge')).toBeVisible();
      await page.keyboard.press('PageDown');
      await expect(queued(page)).toBeVisible();
      await page.keyboard.press('Space');
      await expect(play(page)).toBeVisible();
      expect(await mode(page)).toBe('idle');
    });

    test('15. link: a playing song follows into the Beat Editor and back', async ({ page }) => {
      await open(page);
      await pickSong(page, /^Demo song/);
      await setCountInOff(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect(nowName(page)).toHaveText('Intro');
      await goEditor(page);
      await expect(page.getByTestId('pattern-name')).toHaveText('Ride Rock');
      expect(await mode(page)).toBe('song');
      await expect(page.getByTestId('playing-drummer')).toBeVisible();
      await goDrummer(page);
      await expect(stopBtn(page)).toBeVisible();
      expect(await mode(page)).toBe('song');
      await expect(nav(page, /^Drummer/)).toBeVisible();
    });

    test('16. screenshots and layout', async ({ page }) => {
      mkdirSync('test-results/screenshots', { recursive: true });
      const shot = (n: string) => page.screenshot({ path: `test-results/screenshots/${name}-${n}.png` });
      await open(page);
      await pickSong(page, /^Demo song/);
      await setCountInOff(page);
      await shot('song');
      const overflow = await page.evaluate(() => document.querySelector('.view')!.scrollWidth - document.querySelector('.view')!.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, nextBtn(page));
      await expect(queued(page)).toBeVisible();
      await shot('song-playing');
      if (name === 'mobile') {
        // the now-playing bar sits right above the transport, which sits right above the tab bar; both stay put
        const box = async (sel: string) => (await page.locator(sel).first().boundingBox())!;
        const geom = async () => ({ now: await box('.now'), bar: await box('.sv-bar'), tabs: await box('.tabs-bottom') });
        const g = await geom();
        expect(g.now.height).toBeLessThanOrEqual(84);
        expect(Math.abs(g.bar.y - (g.now.y + g.now.height))).toBeLessThanOrEqual(12);
        expect(Math.abs(g.tabs.y - (g.bar.y + g.bar.height))).toBeLessThanOrEqual(14);
        await page.evaluate(() => document.querySelector('.view')!.scrollTo(0, 300));
        await page.waitForTimeout(150);
        const g2 = await geom();
        expect(Math.abs(g2.now.y - g.now.y)).toBeLessThan(2);
        expect(Math.abs(g2.bar.y - g.bar.y)).toBeLessThan(2);
        // the last row and the add chips are reachable
        await page.evaluate(() => document.querySelector('.view')!.scrollTo(0, 99999));
        await page.waitForTimeout(150);
        const lastChip = (await page.getByRole('button', { name: 'Add Outro', exact: true }).boundingBox())!;
        expect(lastChip.y + lastChip.height).toBeLessThanOrEqual((await box('.now')).y + 1);
        await page.evaluate(() => document.querySelector('.view')!.scrollTo(0, 0));
      }
      await press(page, stopBtn(page));
      if (name === 'mobile') {
        // touch targets (icon buttons may be 38 wide when 44 tall)
        const small = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('.sv button, .sv .gv-check')]
            .filter((el) => el.offsetParent !== null)
            .map((el) => ({ n: el.getAttribute('aria-label') ?? el.textContent, h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }))
            .filter((b) => b.h < 43.5 || b.w < 31.5),
        );
        expect(small.filter((b) => !/Tap tempo|Previous section/.test(String(b.n)))).toEqual([]);
        // mid-drag
        const h = cards(page).nth(1).locator('.sc-handle');
        const a = await center(page, h);
        const ctl = await touchDrag(page, a, { x: a.x, y: a.y + 150 }, { release: false });
        await page.waitForTimeout(250);
        await shot('song-dragging');
        await ctl.release();
      }
    });

    test('17. mobile: dragging outside the handle scrolls the list and does not reorder', async ({ page }) => {
      test.skip(!isMobile(page), 'touch');
      await open(page);
      await pickSong(page, /^Demo song/);
      const before = await labels(page);
      const scroll0 = await page.evaluate(() => document.querySelector('.view')!.scrollTop);
      const a = await center(page, cards(page).nth(3).locator('.sc-num'));
      await touchDrag(page, a, { x: a.x, y: a.y - 220 });
      await page.waitForTimeout(400);
      expect(await page.evaluate(() => document.querySelector('.view')!.scrollTop)).toBeGreaterThan(scroll0 + 50);
      expect(await labels(page)).toEqual(before);
    });
  });
}

test.describe('settings', () => {
  test.use(LAYOUTS.desktop);
  test('the settings sheet holds count-in, click volume and crash after fill', async ({ page }) => {
    await open(page);
    await press(page, page.getByRole('button', { name: 'Drummer settings' }));
    const dlg = page.getByRole('dialog', { name: 'Drummer settings' });
    await expect(dlg.getByRole('group', { name: 'Count-in' }).getByRole('button', { name: '1', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(dlg.getByRole('slider', { name: 'Click volume' })).toBeVisible();
    await expect(dlg.getByRole('checkbox', { name: /Crash after fill/ })).toBeChecked();
  });
});
