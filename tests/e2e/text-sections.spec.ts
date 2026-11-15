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
  log,
  newSong,
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

const field = (card: Locator) => card.getByTestId('beat-text');
const chip = (card: Locator) => card.getByRole('button', { name: /^Section groove:/ });
const info = (card: Locator) => card.getByTestId('beat-info');

/** Commit the text (Enter blurs) and wait for the field to show the canonical text. */
async function typeBeat(card: Locator, text: string) {
  await field(card).fill(text);
  await field(card).press('Enter');
  await expect(field(card)).not.toBeFocused();
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

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} layout: text sections`, () => {
    test.use(LAYOUTS[name]);

    test('1. typing makes a song beat, plays it, and leaves the groove alone', async ({ page }) => {
      const c = await freshSong(page);
      await expect(chip(c)).toContainText('Rock 8ths');
      await expect(info(c)).toHaveText('4 beats · 8ths');
      await expect(field(c)).toHaveAttribute('aria-label', 'Beat for Verse');
      await field(c).click();
      await field(c).press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      await field(c).pressSequentially('kh . sh .'); // Space must type a space, not start the song
      await expect(field(c)).toHaveValue('kh . sh .');
      await expect(stopBtn(page)).toHaveCount(0);
      await expect(info(c)).toHaveText('4 beats · quarters');
      await field(c).press('Enter');
      await expect(chip(c)).toContainText('Song beat');
      await expect(field(c)).toHaveValue('kh . sh .');
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
      await press(page, page.getByRole('dialog', { name: 'Section groove' }).getByRole('option', { name: /^Rock 8ths/ }));
      await expect(chip(c)).toContainText('Rock 8ths');
      await expect(info(c)).toHaveText('4 beats · 8ths');
      await expect(field(c)).not.toHaveValue('kh . sh .');
      // the song beat is kept until the next start (picking a groove never deletes it)
      expect((await owned(page)).length).toBe(1);
    });

    test('2. editing while playing is heard within the look-ahead, bar by bar, with no glitch', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(c, 'kh . sh .');
      await press(page, c.getByRole('button', { name: 'Loop this section' }));
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => at(await log(page), BAR, 'kick'), { timeout: 5000 }).toBeTruthy();
      await typeBeat(c, 'k . k .');
      await expect(chip(c)).toContainText('Song beat'); // in place: still the one beat
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

    test('3. invalid text shows an error, keeps the last beat, saves nothing; Escape reverts', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(c, 'kh . sh .');
      await waitSaved(page);
      await press(page, c.getByRole('button', { name: 'Loop this section' }));
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await field(c).fill('kh . q .');
      await expect(c.getByTestId('beat-error')).toHaveText("col 6: Unknown sound 'q'");
      await expect(field(c)).toHaveAttribute('aria-invalid', 'true');
      await page.waitForTimeout(500);
      expect((await owned(page)).length).toBe(1);
      await expect.poll(async () => at(await log(page), BAR, 'kick'), { timeout: 5000 }).toBeTruthy();
      for (const [, v] of [...byBar(await log(page)).entries()].slice(0, -1)) expect(v).toEqual(['0:hatClosed', '0:kick', '960:hatClosed', '960:snare']);
      await field(c).press('Escape');
      await expect(field(c)).toHaveValue('kh . sh .');
      await expect(c.getByTestId('beat-error')).toHaveCount(0);
      await expect(field(c)).not.toBeFocused();
      // blur with invalid text: dropped with a note
      await field(c).fill('kh . q .');
      await page.getByRole('region', { name: 'Drummer', exact: true }).click({ position: { x: 2, y: 2 } }).catch(() => {});
      await field(c).evaluate((el) => (el as HTMLInputElement).blur());
      await expect(field(c)).toHaveValue('kh . sh .');
      await press(page, stopBtn(page));
    });

    test('4. save as groove: named, listed in pickers and the editor, section keeps it', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(c, 'kh . sh .');
      const other = c; // same card: the chip lists grooves only
      expect(await grooveNames(page, other)).not.toContain('Song 1 · Verse');
      await press(page, chip(c));
      await expect(page.getByRole('dialog', { name: 'Section groove' }).getByRole('button', { name: 'Open in Beat Editor' })).toBeVisible();
      await press(page, page.getByRole('dialog', { name: 'Section groove' }).getByRole('button', { name: 'Save as groove…' }));
      const dlg = page.getByRole('dialog', { name: 'Save as groove' });
      await expect(dlg.getByRole('textbox', { name: 'Groove name' })).toHaveValue('Song 1 · Verse');
      await dlg.getByRole('textbox', { name: 'Groove name' }).fill('Backbeat quarters');
      await press(page, dlg.getByRole('button', { name: 'Save', exact: true }));
      await expect(page.getByRole('status').filter({ hasText: 'Saved as groove Backbeat quarters' })).toBeVisible();
      await expect(chip(c)).toContainText('Backbeat quarters');
      await expect(c.locator('[data-testid=beat-tag]:visible')).toHaveText('Backbeat quarters');
      await press(page, chip(c));
      await expect(page.getByRole('dialog', { name: 'Section groove' }).getByRole('button', { name: 'Save as groove…' })).toHaveCount(0);
      await page.keyboard.press('Escape');
      expect(await grooveNames(page, c)).toContain('Backbeat quarters');
      await expect(field(c)).toHaveValue('kh . sh .');
      await expect.poll(async () => (await owned(page)).length, { timeout: 5000 }).toBe(0);
      expect((await dbPatterns(page)).some((p) => p.name === 'Backbeat quarters')).toBe(true);
      await goEditor(page);
      await press(page, page.getByRole('button', { name: /^Patterns:/ }));
      await expect(page.getByRole('dialog', { name: 'Patterns' }).getByRole('option', { name: /^Backbeat quarters/ })).toBeVisible();
      await page.keyboard.press('Escape');
    });

    test('5. Edit opens the beat in the Beat Editor; changing it there changes the song beat', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(c, 'kh . sh .');
      await expect(c.locator('[data-testid=beat-tag]:visible')).toHaveText('song beat');
      await press(page, chip(c));
      await press(page, page.getByRole('dialog', { name: 'Section groove' }).getByRole('button', { name: 'Open in Beat Editor' }));
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
      await expect(field(c)).toHaveValue('kh . ksh .');
    });

    test('6. duplicating a section gives the copy its own beat', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(c, 'kh . sh .');
      await press(page, c.getByRole('button', { name: 'Duplicate section' }));
      await expect(cards(page)).toHaveCount(2);
      const copy = cards(page).nth(1);
      await expect(chip(copy)).toContainText('Song beat');
      await expect(field(copy)).toHaveValue('kh . sh .');
      await typeBeat(copy, 'k . k .');
      await expect(field(copy)).toHaveValue('k . k .');
      await expect(field(c)).toHaveValue('kh . sh .');
      await waitSaved(page);
      await expect.poll(async () => (await owned(page)).length).toBe(2);
      // add-section chips copy the last section's local beat too
      await press(page, page.getByRole('button', { name: 'Add Chorus', exact: true }));
      await expect(cards(page)).toHaveCount(3);
      await expect(field(cards(page).nth(2))).toHaveValue('k . k .');
      await typeBeat(cards(page).nth(2), 'k k k k');
      await expect(field(copy)).toHaveValue('k . k .');
    });

    test('7. song beats persist; deleting the song garbage-collects them; startup GC drops orphans', async ({ page }) => {
      const c = await freshSong(page);
      await typeBeat(c, 'kh . sh .');
      await waitSaved(page);
      await expect.poll(async () => (await owned(page)).length).toBe(1);
      await page.waitForTimeout(600);
      await page.reload();
      await expect(play(page)).toBeVisible();
      await expect(field(cards(page).nth(0))).toHaveValue('kh . sh .');
      await expect(chip(cards(page).nth(0))).toContainText('Song beat');
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
      await typeBeat(c, 'kh . sh .');
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

    test('9. screenshot', async ({ page }) => {
      mkdirSync('test-results/screenshots', { recursive: true });
      await open(page);
      await newSong(page);
      await setBars(page, 0, 4);
      await typeBeat(cards(page).nth(0), 'kh . sh .');
      for (const k of ['Chorus', 'Bridge']) await press(page, page.getByRole('button', { name: `Add ${k}`, exact: true }));
      await expect(cards(page)).toHaveCount(3);
      await field(cards(page).nth(2)).fill('Kh h  (s) h  kh h  s');
      await field(cards(page).nth(2)).press('Enter');
      await field(cards(page).nth(1)).click();
      await field(cards(page).nth(1)).pressSequentially('kh . sh . k');
      await page.waitForTimeout(400);
      await page.screenshot({ path: `test-results/screenshots/${name}-song-text.png`, fullPage: true });
    });
  });
}

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;

test.describe('row layout across widths', () => {
  for (const w of [360, 375, 414, 480, 580, 768, 900, 1024, 1440]) {
    test.describe(`${w}px`, () => {
    test.use({ viewport: { width: w, height: 900 }, hasTouch: w < 900 });
    test(`no overlaps or overflow at ${w}px`, async ({ page }) => {
      await open(page);
      await newSong(page);
      await setBars(page, 0, 4);
      await typeBeat(cards(page).nth(0), 'kh . sh .');
      await press(page, page.getByRole('button', { name: 'Add Chorus', exact: true }));
      await expect(cards(page)).toHaveCount(2);
      await field(cards(page).nth(1)).fill('kh . q .'); // error caption visible too
      await expect(cards(page).nth(1).getByTestId('beat-error')).toBeVisible();
      for (const [i, card] of (await cards(page).all()).entries()) {
        const row = (await card.boundingBox())!;
        const parts = {
          combo: card.locator('.sc-combo'),
          stepper: card.locator('.sc-stepper'),
          caret: card.locator('.pp-compact'),
          tag: card.locator('[data-testid=beat-tag]:visible'),
          text: field(card),
          caption: card.locator('.sc-cap'),
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
        // siblings that must not overlap: line-1 buttons, combo vs stepper, tag vs text vs caret, combo vs caption
        const l1 = boxes.filter(([k]) => k.startsWith('l1-'));
        for (let a = 0; a < l1.length; a++) for (let b = a + 1; b < l1.length; b++) expect(overlaps(l1[a]![1], l1[b]![1]), `${l1[a]![0]} vs ${l1[b]![0]} at ${w}px`).toBe(false);
        for (const [x, y] of [['combo', 'stepper'], ['tag', 'text'], ['text', 'caret'], ['tag', 'caret'], ['combo', 'caption']]) {
          expect(overlaps(get(x!), get(y!)), `${x} vs ${y} at ${w}px`).toBe(false);
        }
        for (const [, b] of l1) expect(b.height).toBeGreaterThanOrEqual(30);
        expect(get('stepper').height).toBeGreaterThanOrEqual(40);
        expect(get('caret').width).toBeGreaterThanOrEqual(40);
        expect(get('text').width, 'text field has room').toBeGreaterThanOrEqual(60);
      }
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(0);
      if ([375, 580, 1440].includes(w)) {
        await cards(page).nth(1).getByTestId('beat-text').fill('kh . sh . k');
        await page.waitForTimeout(400);
        mkdirSync('test-results/screenshots', { recursive: true });
        const nm = w === 375 ? 'mobile' : w === 580 ? 'tablet' : 'desktop';
        await page.screenshot({ path: `test-results/screenshots/${nm}-song-text.png`, fullPage: true });
      }
    });
  });
  }
});
