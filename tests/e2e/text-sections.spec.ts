import { mkdirSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import {
  BAR,
  LAYOUTS,
  at,
  cards,
  clearLog,
  expect,
  goDrummer,
  goEditor,
  isMobile,
  log,
  newSong,
  nextBtn,
  open,
  play,
  press,
  setBars,
  setBpm,
  setCountInOff,
  stopBtn,
  test,
  waitSaved,
  type Entry,
  type LayoutName,
} from './fixtures';

/** The beat text field lives in the section's dropdown panel (open it first). */
const field = (card: Locator) => card.getByTestId('beat-text');
/** The row's read-only display: groove name, or the written pattern of a song beat. */
const chip = (card: Locator) => card.getByRole('button', { name: /^Section groove:/ });
const info = (card: Locator) => card.getByTestId('beat-info');
const panelOf = (page: Page) => page.getByRole('dialog', { name: 'Section groove' });

async function openBeat(page: Page, card: Locator) {
  await press(page, chip(card));
  await expect(field(card)).toBeVisible();
}
/** Escape reverts and closes (focus returns to the display). */
async function closeBeat(page: Page, card: Locator) {
  await page.keyboard.press('Escape');
  await expect(panelOf(page)).toHaveCount(0);
}
/** Open the panel, check the text field, close it again. */
async function expectBeat(page: Page, card: Locator, text: string) {
  await openBeat(page, card);
  await expect(field(card)).toHaveValue(text);
  await closeBeat(page, card);
}

/** Every step is one 16th square: kick + hat on beat 1, snare + hat on beat 3 (tick 960) of a 16-step, 4-beat beat. */
const A = 'kh . . .  . . . .  sh . . .  . . . .';
/** Kicks on beats 1 and 3. */
const B = 'k . . .  . . . .  k . . .  . . . .';

/** Open the panel, type the text, Enter commits and closes. */
async function typeBeat(page: Page, card: Locator, text: string) {
  await openBeat(page, card);
  await field(card).fill(text);
  await field(card).press('Enter');
  await expect(panelOf(page)).toHaveCount(0);
}

/** What each bar of the log plays: bar index -> "tick:sound" set (clicks excluded). */
function byBar(es: Entry[]): Map<number, string[]> {
  const m = new Map<number, string[]>();
  for (const e of es) {
    if (e.sound.startsWith('click')) continue;
    const b = Math.floor(Math.round(e.tick) / BAR);
    const arr = m.get(b) ?? [];
    arr.push(`${Math.round(e.tick) - b * BAR}:${e.sound}`);
    m.set(b, arr);
  }
  for (const [k, v] of m) m.set(k, v.sort());
  return m;
}

interface Rec {
  id: string;
  name: string;
  builtIn?: boolean;
  ownerSongId?: string;
  category?: string;
  timeSig?: { num: number };
}
/** All patterns stored in IndexedDB. */
const dbPatterns = (page: Page): Promise<Rec[]> =>
  page.evaluate(
    () =>
      new Promise<Rec[]>((resolve, reject) => {
        const open = indexedDB.open('beatboy');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('patterns').objectStore('patterns').getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result as Rec[]);
          };
        };
      }),
  );
const owned = async (page: Page) => (await dbPatterns(page)).filter((p) => p.ownerSongId);

const grooveNames = async (page: Page, card: Locator): Promise<string[]> => {
  await press(page, chip(card));
  const names = await page.getByRole('dialog', { name: 'Section groove' }).getByRole('option').locator('.bi-name').allTextContents();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Section groove' })).toHaveCount(0);
  return names;
};

/** A fresh song: one 4-bar Verse (Rock 8ths), 200 BPM, no count-in. */
async function freshSong(page: Page): Promise<Locator> {
  await open(page);
  await newSong(page);
  await expect(cards(page)).toHaveCount(1);
  await setBars(page, 0, 4);
  await setBpm(page, 200);
  await setCountInOff(page);
  return cards(page).nth(0);
}

const queuedBadge = (page: Page) => page.getByTestId('queued-badge');

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} layout: text sections`, () => {
    test.use(LAYOUTS[name]);

    test('1. typing makes a song beat, plays it, and leaves the groove alone', async ({ page }) => {
      const c = await freshSong(page);
      await expect(chip(c)).toContainText('Rock 8ths');
      await openBeat(page, c);
      await expect(info(c)).toHaveText('16 steps · 4 beats');
      await expect(field(c)).toHaveAttribute('aria-label', 'Beat for Verse');
      await field(c).press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await field(c).pressSequentially('kh . . . . . . . sh . . . . . . .'); // Space must type a space, not start the song
      await expect(field(c)).toHaveValue('kh . . . . . . . sh . . . . . . .');
      await expect(stopBtn(page)).toHaveCount(0);
      await expect(info(c)).toHaveText('16 steps · 4 beats');
      await field(c).press('Enter');
      await expect(panelOf(page)).toHaveCount(0);
      await expect(chip(c)).toHaveAttribute('aria-label', 'Section groove: Song beat');
      await expect(c.getByTestId('beat-display-text')).toHaveText(A); // a song beat shows its pattern
      await expect(chip(c)).toBeFocused();
      await expectBeat(page, c, A);
      await waitSaved(page);
      await expect.poll(async () => (await owned(page)).length).toBe(1);
      const [own] = await owned(page);
      expect(own!.name).toBe('Song 1 · Verse');
      expect(own!.builtIn).toBe(false);

      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => at(await log(page), BAR, 'kick'), { timeout: 5000 }).toBeTruthy();
      const bars = byBar(await log(page));
      expect(bars.get(0)).toEqual(['0:hatClosed', '0:kick', '960:hatClosed', '960:snare']);
      expect(bars.get(1)).toEqual(bars.get(0));
      await press(page, stopBtn(page));

      // Rock 8ths itself is untouched: choose it again
      await press(page, chip(c));
      await press(page, panelOf(page).getByRole('option', { name: /^Rock 8ths/ }));
      await expect(panelOf(page)).toHaveCount(0);
      await expect(chip(c)).toContainText('Rock 8ths');
      await expect(c.getByTestId('beat-display-text')).toHaveText('Rock 8ths');
      await openBeat(page, c);
      await expect(info(c)).toHaveText('16 steps · 4 beats');
      await expect(field(c)).not.toHaveValue(A);
      await closeBeat(page, c);
      // the song beat is kept until the next start (picking a groove never deletes it)
      expect((await owned(page)).length).toBe(1);
    });

    test('2. editing while playing is heard within the look-ahead, bar by bar, with no glitch', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(page, c, A);
      await press(page, c.getByRole('button', { name: 'Loop this section' }));
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => at(await log(page), BAR, 'kick'), { timeout: 5000 }).toBeTruthy();
      await typeBeat(page, c, B);
      await expect(chip(c)).toHaveAttribute('aria-label', 'Section groove: Song beat'); // in place: still the one beat
      await expect.poll(async () => byBar(await log(page)).get(5)?.join(), { timeout: 8000 }).toBe('0:kick,960:kick');
      const es = await log(page);
      const bars = byBar(es);
      const old = ['0:hatClosed', '0:kick', '960:hatClosed', '960:snare'];
      const neu = ['0:kick', '960:kick'];
      const kinds = [...bars.entries()].filter(([b]) => b >= 0 && b <= 5).map(([, v]) => (v.join() === old.join() ? 'old' : v.join() === neu.join() ? 'new' : 'mixed'));
      // old bars first, then new bars; a mid-bar change can mix at most the bar being scheduled
      expect(kinds[0]).toBe('old');
      expect(kinds.at(-1)).toBe('new');
      expect(kinds.filter((k) => k === 'mixed').length).toBeLessThanOrEqual(1);
      expect(kinds.indexOf('new')).toBeGreaterThan(kinds.lastIndexOf('old'));
      expect((await owned(page)).length).toBe(1);
      await press(page, stopBtn(page));
    });

    test('2b. the edit is live while the panel is still open (before Enter)', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(page, c, A);
      await press(page, c.getByRole('button', { name: 'Loop this section' }));
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => at(await log(page), BAR, 'kick'), { timeout: 5000 }).toBeTruthy();
      await openBeat(page, c);
      await field(c).fill(B); // no Enter: the debounce applies it
      await expect.poll(async () => byBar(await log(page)).get(5)?.join(), { timeout: 8000 }).toBe('0:kick,960:kick');
      await closeBeat(page, c);
      await press(page, stopBtn(page));
    });

    test('3. invalid text shows an error, keeps the last beat, saves nothing; Escape reverts', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(page, c, A);
      await waitSaved(page);
      await press(page, c.getByRole('button', { name: 'Loop this section' }));
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await openBeat(page, c);
      await field(c).fill('kh . q .');
      await expect(c.getByTestId('beat-error')).toHaveText("col 6: Unknown sound 'q'");
      await expect(field(c)).toHaveAttribute('aria-invalid', 'true');
      await expect(page.getByRole('button', { name: 'Save as groove' })).toBeDisabled();
      await field(c).press('Enter'); // invalid text is never applied: the panel stays open
      await expect(field(c)).toBeVisible();
      await page.waitForTimeout(500);
      expect((await owned(page)).length).toBe(1);
      await expect.poll(async () => at(await log(page), BAR, 'kick'), { timeout: 5000 }).toBeTruthy();
      for (const [, v] of [...byBar(await log(page)).entries()].slice(0, -1)) expect(v).toEqual(['0:hatClosed', '0:kick', '960:hatClosed', '960:snare']);
      await field(c).press('Escape');
      await expect(panelOf(page)).toHaveCount(0);
      await expect(chip(c)).toBeFocused();
      await expectBeat(page, c, A);
      // clicking outside with invalid text: dropped
      await openBeat(page, c);
      await field(c).fill('kh . q .');
      await page.mouse.click(2, page.viewportSize()!.height - 2);
      await expect(panelOf(page)).toHaveCount(0);
      await expect(queuedBadge(page)).toHaveCount(0); // the click-outside is not a row tap
      await expectBeat(page, c, A);
      await press(page, stopBtn(page));
    });

    test('3b. clicking outside commits valid text', async ({ page }) => {
      const c = await freshSong(page);
      await openBeat(page, c);
      await field(c).fill(A);
      await page.mouse.click(2, page.viewportSize()!.height - 2);
      await expect(panelOf(page)).toHaveCount(0);
      await expect(chip(c)).toHaveAttribute('aria-label', 'Section groove: Song beat');
      await expectBeat(page, c, A);
    });

    test('4. save as groove: in the panel, named, listed in pickers and the editor, section keeps it', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(page, c, A);
      expect(await grooveNames(page, c)).not.toContain('Song 1 · Verse');
      await press(page, chip(c));
      const dlg = panelOf(page);
      await expect(dlg.getByRole('button', { name: 'Open in Beat Editor' })).toBeVisible();
      await expect(dlg.getByRole('textbox', { name: 'Groove name' })).toHaveValue('Song 1 · Verse');
      await dlg.getByRole('textbox', { name: 'Groove name' }).fill('Backbeat quarters');
      await press(page, dlg.getByRole('button', { name: 'Save as groove' }));
      await expect(page.getByRole('status').filter({ hasText: 'Saved as groove Backbeat quarters' })).toBeVisible();
      await expect(panelOf(page)).toHaveCount(0);
      await expect(chip(c)).toContainText('Backbeat quarters');
      await expect(c.getByTestId('beat-display-text')).toHaveText('Backbeat quarters');
      await press(page, chip(c));
      await expect(panelOf(page).getByRole('button', { name: 'Save as groove' })).toHaveCount(0);
      await expect(panelOf(page).getByTestId('beat-groove-name')).toHaveText('Backbeat quarters');
      await expect(panelOf(page).getByText('saved groove', { exact: true })).toBeVisible();
      await expect(field(c)).toHaveValue(A);
      await page.keyboard.press('Escape');
      expect(await grooveNames(page, c)).toContain('Backbeat quarters');
      await expect.poll(async () => (await dbPatterns(page)).some((p) => p.name === 'Backbeat quarters' && !p.ownerSongId), { timeout: 5000 }).toBe(true);
      expect((await owned(page)).length).toBe(0);
      await goEditor(page);
      await press(page, page.getByRole('button', { name: /^Patterns:/ }));
      await expect(page.getByRole('dialog', { name: 'Patterns' }).getByRole('option', { name: /^Backbeat quarters/ })).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('4b. a built-in groove is labelled, its text is editable and makes a local copy', async ({ page }) => {
      const c = await freshSong(page);
      await press(page, chip(c));
      await expect(panelOf(page).getByTestId('beat-groove-name')).toHaveText('Rock 8ths');
      await expect(panelOf(page).getByText('Built-in', { exact: true })).toBeVisible();
      await expect(panelOf(page).getByRole('textbox', { name: 'Groove name' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    test('5. Open in Beat Editor opens the beat there; changing it there changes the song beat', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(page, c, A);
      await press(page, chip(c));
      await press(page, panelOf(page).getByRole('button', { name: 'Open in Beat Editor' }));
      await expect(page.getByTestId('pattern-name')).toHaveText('Song 1 · Verse');
      await expect(page.getByTestId('song-beat-tag')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save as groove' })).toBeVisible();
      // the picker list does not contain song beats, but the open one is shown
      await press(page, page.getByRole('button', { name: /^Patterns:/ }));
      const opts = page.getByRole('dialog', { name: 'Patterns' }).getByRole('option');
      await expect(opts.filter({ hasText: 'Song 1 · Verse' })).toHaveCount(1);
      await page.keyboard.press('Escape');
      // toggle the kick on step 3 (beat 1, "e" of the 16th grid) and go back
      const cell = page.locator('[data-cell][data-sound="kick"][data-step="8"]');
      await cell.first().scrollIntoViewIfNeeded();
      await press(page, cell.first());
      await goDrummer(page);
      await expectBeat(page, c, 'kh . . .  . . . .  ksh . . .  . . . .');
    });

    test('6. duplicating a section gives the copy its own beat', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(page, c, A);
      await press(page, c.getByRole('button', { name: 'Duplicate section' }));
      await expect(cards(page)).toHaveCount(2);
      const copy = cards(page).nth(1);
      await expect(chip(copy)).toHaveAttribute('aria-label', 'Section groove: Song beat');
      await expectBeat(page, copy, A);
      await typeBeat(page, copy, B);
      await expectBeat(page, copy, B);
      await expectBeat(page, c, A);
      await waitSaved(page);
      await expect.poll(async () => (await owned(page)).length).toBe(2);
      // add-section chips copy the last section's local beat too
      await press(page, page.getByRole('button', { name: 'Add Chorus', exact: true }));
      await expect(cards(page)).toHaveCount(3);
      await expectBeat(page, cards(page).nth(2), B);
      await typeBeat(page, cards(page).nth(2), 'k . . .  k . . .  k . . .  k . . .');
      await expectBeat(page, copy, B);
    });

    test('7. song beats persist; deleting the song garbage-collects them; startup GC drops orphans', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(page, c, A);
      await waitSaved(page);
      await expect.poll(async () => (await owned(page)).length).toBe(1);
      await page.waitForTimeout(600);
      await page.reload();
      await expect(play(page)).toBeVisible();
      await expect(cards(page).nth(0).getByTestId('beat-display-text')).toHaveText(A);
      await expectBeat(page, cards(page).nth(0), A);
      await expect(chip(cards(page).nth(0))).toHaveAttribute('aria-label', 'Section groove: Song beat');
      expect((await owned(page)).length).toBe(1);

      // an orphan (its song is gone) is removed on the next start
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const o = indexedDB.open('beatboy');
            o.onsuccess = () => {
              const tx = o.result.transaction('patterns', 'readwrite');
              const st = tx.objectStore('patterns');
              const g = st.getAll();
              g.onsuccess = () => {
                const src = (g.result as Rec[]).find((p) => p.ownerSongId)!;
                st.put({ ...src, id: 'orphan-1', ownerSongId: 'no-such-song' });
              };
              tx.oncomplete = () => {
                o.result.close();
                resolve();
              };
              tx.onerror = () => reject(tx.error);
            };
          }),
      );
      expect((await owned(page)).length).toBe(2);
      await page.reload();
      await expect(play(page)).toBeVisible();
      await expect.poll(async () => (await owned(page)).map((p) => p.id).includes('orphan-1'), { timeout: 5000 }).toBe(false);
      expect((await owned(page)).length).toBe(1);

      // deleting the song removes its beats
      await press(page, page.getByRole('button', { name: 'Delete song' }));
      await press(page, page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }));
      await expect.poll(async () => (await owned(page)).length, { timeout: 5000 }).toBe(0);
      await page.reload();
      await expect(play(page)).toBeVisible();
      expect((await owned(page)).length).toBe(0);
      await goEditor(page);
      await press(page, page.getByRole('button', { name: /^Patterns:/ }));
      await expect(page.getByRole('dialog', { name: 'Patterns' }).getByRole('option').filter({ hasText: /Song 1 · / })).toHaveCount(0);
    });

    test('8. pickers (section, default fill, editor list) never list song beats', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(page, c, A);
      expect(await grooveNames(page, c)).not.toContain('Song 1 · Verse');
      await press(page, page.getByRole('button', { name: 'Drummer settings' }));
      await press(page, page.getByRole('button', { name: /^Default fill:/ }));
      await expect(page.getByRole('dialog', { name: 'Default fill' }).getByRole('option').filter({ hasText: 'Song 1' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await press(page, page.getByRole('dialog', { name: 'Drummer settings' }).getByRole('button', { name: 'Close' }));
      await expect(page.getByRole('dialog', { name: 'Drummer settings' })).toHaveCount(0);
      await goEditor(page);
      await press(page, page.getByRole('button', { name: /^Patterns:/ }));
      const dlg = page.getByRole('dialog', { name: 'Patterns' });
      await expect(dlg.getByRole('option').filter({ hasText: 'Song 1 · Verse' })).toHaveCount(0);
      await page.keyboard.press('Escape');
    });

    test('10. kh h hs h is a one-beat loop of 16ths: notes every 0.125 s at 120 BPM', async ({ page }) => {
      const c = await freshSong(page);
      await setBpm(page, 120);
      await openBeat(page, c);
      await field(c).fill('kh h hs h');
      await expect(info(c)).toHaveText('4 steps · 1 beat');
      await field(c).press('Enter');
      await expect(panelOf(page)).toHaveCount(0);
      await expectBeat(page, c, 'kh h sh h');
      await expect(chip(c)).toHaveAttribute('aria-label', 'Section groove: Song beat');
      await expect(c.getByTestId('beat-length')).toHaveText('1 beat');
      await press(page, c.getByRole('button', { name: 'Loop this section' }));
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => (await log(page)).filter((e) => e.sound === 'hatClosed').length, { timeout: 8000 }).toBeGreaterThanOrEqual(12);
      await press(page, stopBtn(page));
      const hats = (await log(page)).filter((e) => e.sound === 'hatClosed').sort((a, b) => a.tick - b.tick).slice(0, 12);
      hats.forEach((h, i) => {
        expect(Math.round(h.tick)).toBe(i * 120);
        expect(h.time - hats[0]!.time).toBeCloseTo(i * 0.125, 2);
      });
      const snares = (await log(page)).filter((e) => e.sound === 'snare').map((e) => Math.round(e.tick));
      expect(snares.slice(0, 3)).toEqual([240, 720, 1200]);
    });

    test('11. s k s is a 3-step loop; the Beat Editor shows 3 squares and + makes 7', async ({ page }) => {
      const c = await freshSong(page);
      await setBpm(page, 120);
      await openBeat(page, c);
      await field(c).fill('s k s');
      await expect(info(c)).toHaveText('3 steps');
      await field(c).press('Enter');
      await expect(panelOf(page)).toHaveCount(0);
      await expect(c.getByTestId('beat-length')).toHaveText('3 steps');
      await expectBeat(page, c, 's k s');
      await press(page, c.getByRole('button', { name: 'Loop this section' }));
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => (await log(page)).filter((e) => e.sound === 'snare').length, { timeout: 8000 }).toBeGreaterThanOrEqual(8);
      mkdirSync('test-results/screenshots', { recursive: true });
      await page.screenshot({ path: `test-results/screenshots/${name}-song-3step.png`, fullPage: true });
      await press(page, stopBtn(page));
      const es = (await log(page)).filter((e) => !e.sound.startsWith('click')).sort((a, b) => a.tick - b.tick || a.sound.localeCompare(b.sound));
      const snares = es.filter((e) => e.sound === 'snare');
      expect(snares.slice(0, 6).map((e) => Math.round(e.tick))).toEqual([0, 240, 360, 600, 720, 960]);
      expect(es.filter((e) => e.sound === 'kick').slice(0, 3).map((e) => Math.round(e.tick))).toEqual([120, 480, 840]);
      // one pass = 3 steps = 0.375 s at 120 BPM
      expect(snares[2]!.time - snares[0]!.time).toBeCloseTo(0.375, 2);
      expect(snares[4]!.time - snares[2]!.time).toBeCloseTo(0.375, 2);

      await press(page, chip(c));
      await press(page, panelOf(page).getByRole('button', { name: 'Open in Beat Editor' }));
      await expect(page.getByTestId('pattern-name')).toHaveText('Song 1 · Verse');
      const group = page.getByRole('group', { name: 'Beats', exact: true });
      await expect(group.locator('output')).toHaveText('3 steps');
      const snare = page.locator('[data-cell][data-sound="snare"]');
      if (isMobile(page)) await press(page, page.getByRole('button', { name: 'Snare pad' }));
      await expect(snare).toHaveCount(3);
      await page.screenshot({ path: `test-results/screenshots/${name}-editor-3step.png`, fullPage: true });
      await press(page, page.getByRole('button', { name: 'Beats up' }));
      await expect(group.locator('output')).toHaveText('7 steps');
      await expect(snare).toHaveCount(7);
      await page.screenshot({ path: `test-results/screenshots/${name}-editor-7step.png`, fullPage: true });
      await press(page, page.getByRole('button', { name: 'Beats up' }));
      await expect(group.locator('output')).toHaveText('11 steps');
      await goDrummer(page);
      await expectBeat(page, c, 's k s .  . . . .  . . .');
    });

    test('12. empty text is an error for a section', async ({ page }) => {
      const c = await freshSong(page);
      await openBeat(page, c);
      await field(c).fill('   ');
      await expect(c.getByTestId('beat-error')).toHaveText('col 1: Type at least one step');
      await field(c).press('Escape');
      await expect(panelOf(page)).toHaveCount(0);
      await openBeat(page, c);
      await expect(info(c)).toHaveText('16 steps · 4 beats');
      await closeBeat(page, c);
    });

    test('13. the text field grows up to three lines; Shift+Enter adds a line, Enter closes', async ({ page }) => {
      const c = await freshSong(page);
      await openBeat(page, c);
      const h0 = (await field(c).boundingBox())!.height;
      await field(c).fill('k . . .');
      await field(c).press('Shift+Enter');
      await field(c).pressSequentially('s . . .');
      await field(c).press('Shift+Enter');
      await field(c).pressSequentially('k . . .');
      await field(c).press('Shift+Enter');
      await field(c).pressSequentially('s . . .');
      await field(c).press('Shift+Enter');
      await field(c).pressSequentially('k . . .');
      const h3 = (await field(c).boundingBox())!.height;
      expect(h3).toBeGreaterThan(h0 + 20);
      expect(h3).toBeLessThanOrEqual(100); // 3 lines + padding
      await expect(info(c)).toHaveText('20 steps · 5 beats');
      await field(c).press('Enter');
      await expect(panelOf(page)).toHaveCount(0);
    });

    test('14. keyboard: arrow / space on the display opens it, Tab cycles inside, Escape returns focus', async ({ page }) => {
      test.skip(isMobile(page), 'keyboard');
      const c = await freshSong(page);
      await chip(c).focus();
      await page.keyboard.press('Space');
      await expect(field(c)).toBeVisible();
      await expect(stopBtn(page)).toHaveCount(0); // Space did not start the song
      await expect(field(c)).toBeFocused();
      const inPanel = () => panelOf(page).evaluate((el) => el.contains(document.activeElement));
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        expect(await inPanel(), `tab ${i}`).toBe(true);
      }
      await page.keyboard.press('Shift+Tab');
      expect(await inPanel()).toBe(true);
      await page.keyboard.press('Escape');
      await expect(panelOf(page)).toHaveCount(0);
      await expect(chip(c)).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(field(c)).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Tempo in BPM' })).toHaveValue('200'); // arrows did not nudge the tempo
      await page.keyboard.press('Escape');
    });

    test('9. screenshot', async ({ page }) => {
      mkdirSync('test-results/screenshots', { recursive: true });
      await open(page);
      await newSong(page);
      await setBars(page, 0, 4);
      await typeBeat(page, cards(page).nth(0), A);
      for (const k of ['Chorus', 'Bridge']) await press(page, page.getByRole('button', { name: `Add ${k}`, exact: true }));
      await expect(cards(page)).toHaveCount(3);
      await typeBeat(page, cards(page).nth(2), 's k s');
      await typeBeat(page, cards(page).nth(1), 'kh . sh . k');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/screenshots/${name}-song-text.png`, fullPage: true });
    });
  });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

test.describe('row layout across widths', () => {
  for (const w of [360, 375, 414, 480, 580, 768, 900, 1024, 1280, 1440]) {
    test.describe(`${w}px`, () => {
      test.use({ viewport: { width: w, height: 900 }, hasTouch: w < 900 });
      test(`no overlaps or overflow at ${w}px`, async ({ page }) => {
        await open(page);
        await newSong(page);
        await setBars(page, 0, 4);
        await typeBeat(page, cards(page).nth(0), A);
        await press(page, page.getByRole('button', { name: 'Add Chorus', exact: true }));
        await expect(cards(page)).toHaveCount(2);
        await typeBeat(page, cards(page).nth(1), 'kh . sh . k');
        const wide = w >= 900;
        for (const [i, card] of (await cards(page).all()).entries()) {
          const row = (await card.boundingBox())!;
          const parts = {
            display: chip(card),
            stepper: card.locator('.sc-stepper'),
            caption: card.getByTestId('beat-length'),
            main: card.getByTestId('beat-display-text'),
            ...Object.fromEntries((await card.locator('.sc-l1 > *').all()).map((l, j) => [`l1-${j}`, l])),
          } as Record<string, Locator>;
          const boxes: [string, Box][] = [];
          for (const [k, l] of Object.entries(parts)) {
            const b = await l.boundingBox();
            expect(b, `${k} visible (row ${i}, ${w}px)`).toBeTruthy();
            expect(b!.x, `${k} inside row`).toBeGreaterThanOrEqual(row.x - 0.5);
            expect(b!.x + b!.width, `${k} inside row`).toBeLessThanOrEqual(row.x + row.width + 0.5);
            expect(b!.y + b!.height, `${k} inside row (y)`).toBeLessThanOrEqual(row.y + row.height + 0.5);
            boxes.push([k, b!]);
          }
          const get = (k: string) => boxes.find(([n]) => n === k)![1];
          const l1 = boxes.filter(([k]) => k.startsWith('l1-'));
          for (let a = 0; a < l1.length; a++) for (let b = a + 1; b < l1.length; b++) expect(overlaps(l1[a]![1], l1[b]![1]), `${l1[a]![0]} vs ${l1[b]![0]} at ${w}px`).toBe(false);
          for (const [x, y] of [['display', 'stepper'], ['main', 'caption']]) expect(overlaps(get(x!), get(y!)), `${x} vs ${y} at ${w}px`).toBe(false);
          for (const [, b] of l1) expect(b.height).toBeGreaterThanOrEqual(30);
          expect(get('stepper').height).toBeGreaterThanOrEqual(40);
          expect(get('display').width, 'display has room').toBeGreaterThanOrEqual(wide ? 300 : 150);
          if (wide) {
            expect(row.height, `single-line row at ${w}px`).toBeLessThan(72);
            for (const [, b] of l1) expect(Math.abs(b.y + b.height / 2 - (row.y + row.height / 2))).toBeLessThan(4);
            expect(overlaps(get('display'), get('stepper'))).toBe(false);
            for (const [, b] of l1) expect(overlaps(get('display'), b)).toBe(false);
          }
        }
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(over).toBeLessThanOrEqual(0);
        expect(await page.evaluate(() => document.querySelector('.view')!.scrollWidth - document.querySelector('.view')!.clientWidth)).toBeLessThanOrEqual(0);

        // the panel opens inside the viewport: text editor, name and save, then find
        const c1 = cards(page).nth(0);
        await openBeat(page, c1);
        const pb = (await panelOf(page).boundingBox())!;
        expect(pb.x).toBeGreaterThanOrEqual(0);
        expect(pb.x + pb.width).toBeLessThanOrEqual(w + 0.5);
        expect(pb.y).toBeGreaterThanOrEqual(0);
        expect(pb.y + pb.height).toBeLessThanOrEqual(900 + 0.5);
        const tb = (await field(c1).boundingBox())!;
        const nb = (await panelOf(page).getByRole('textbox', { name: 'Groove name' }).boundingBox())!;
        const sb = (await panelOf(page).getByRole('searchbox').boundingBox())!;
        expect(tb.y + tb.height).toBeLessThanOrEqual(nb.y + 0.5);
        expect(nb.y + nb.height).toBeLessThanOrEqual(sb.y + 0.5);
        for (const loc of [panelOf(page).getByRole('button', { name: 'Open in Beat Editor' }), panelOf(page).getByRole('button', { name: 'Save as groove' })]) {
          const b = (await loc.boundingBox())!;
          expect(b.x + b.width).toBeLessThanOrEqual(pb.x + pb.width + 0.5);
          expect(b.x).toBeGreaterThanOrEqual(pb.x - 0.5);
        }
        if ([375, 580, 1440].includes(w)) {
          mkdirSync('test-results/screenshots', { recursive: true });
          const nm = w === 375 ? 'mobile' : w === 580 ? 'tablet' : 'desktop';
          await page.screenshot({ path: `test-results/screenshots/${nm}-song-text-panel.png`, fullPage: true });
        }
        await closeBeat(page, c1);

        if (wide) {
          // player bar: compact, no overlaps, nothing clipped, also with a queued NEXT
          await press(page, play(page));
          await expect(stopBtn(page)).toBeVisible();
          await press(page, nextBtn(page));
          await expect(queuedBadge(page)).toBeVisible();
          const pl = (await page.locator('.sv-player').boundingBox())!;
          expect(pl.height, `player height at ${w}px`).toBeLessThanOrEqual(200);
          for (const sel of ['.sv-p1', '.sv-p2']) {
            const kids = await page.locator(`${sel} > *`).all();
            const kb: Box[] = [];
            for (const k of kids) kb.push((await k.boundingBox())!);
            for (let a = 0; a < kb.length; a++) {
              expect(kb[a]!.x + kb[a]!.width, `${sel} child ${a} inside player`).toBeLessThanOrEqual(w + 0.5);
              for (let b = a + 1; b < kb.length; b++) expect(overlaps(kb[a]!, kb[b]!), `${sel} ${a} vs ${b} at ${w}px`).toBe(false);
            }
          }
          const now = (await page.locator('.now').boundingBox())!;
          for (const sel of ['.now-name-wrap', '.now-pos', '.now-prev', '.now-lamps', '.now-info']) {
            const b = (await page.locator(sel).first().boundingBox())!;
            expect(b.x + b.width, `${sel} inside now at ${w}px`).toBeLessThanOrEqual(now.x + now.width + 0.5);
            expect(b.y + b.height, `${sel} inside now at ${w}px (y)`).toBeLessThanOrEqual(now.y + now.height + 0.5);
          }
          const badge = (await queuedBadge(page).boundingBox())!;
          expect(badge.x + badge.width).toBeLessThanOrEqual(now.x + now.width + 0.5);
          // every transport button fully visible, labels not clipped
          for (const b of await page.locator('.sv-bar .sv-btn').all()) {
            const clipped = await b.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
            expect(clipped, 'transport button not clipped').toBe(false);
          }
          await press(page, stopBtn(page));
        }
      });
    });
  }
});
