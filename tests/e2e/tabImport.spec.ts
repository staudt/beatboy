import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import {
  BAR,
  LAYOUTS,
  at,
  cards,
  clearLog,
  engineBpm,
  expect,
  log,
  open,
  play,
  press,
  setCountInOff,
  songName,
  stopBtn,
  test,
  waitSaved,
  type Entry,
  type LayoutName,
} from './fixtures';

const tabText = (file: string): string => readFileSync(join(process.cwd(), 'tests/fixtures/tabs', file), 'utf8');

const dlg = (page: Page) => page.getByRole('dialog', { name: 'Import drum tab' });
const area = (page: Page) => dlg(page).getByRole('textbox', { name: 'Drum tab text' });
const badge = (page: Page) => dlg(page).getByTestId('tab-confidence');
const createBtn = (page: Page) => dlg(page).getByRole('button', { name: 'Create song' });

async function openImport(page: Page): Promise<void> {
  await press(page, page.getByRole('button', { name: /^Song:/ }));
  await press(page, page.getByRole('dialog', { name: 'Song' }).getByRole('button', { name: 'Import drum tab…' }));
  await expect(dlg(page)).toBeVisible();
}

async function paste(page: Page, text: string): Promise<void> {
  await area(page).fill(text);
}

/** What each bar of the log plays: bar index -> sorted "tick:sound" (clicks excluded). */
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

/** Fixture 01 (rock beat in 16ths): kick on steps 0 and 8, snare on 4 and 12, hat on every even step. One 16th = 120 ticks. */
const ROCK_BAR = [
  ...[0, 8].map((s) => `${s * 120}:kick`),
  ...[4, 12].map((s) => `${s * 120}:snare`),
  ...Array.from({ length: 8 }, (_, i) => `${i * 240}:hatClosed`),
].sort();

interface Rec {
  id: string;
  name: string;
  ownerSongId?: string;
  sections?: { name: string; bars: number; kind: string; patternId: string }[];
}
const idb = <T,>(page: Page, store: 'songs' | 'patterns'): Promise<T[]> =>
  page.evaluate(
    (s) =>
      new Promise<T[]>((resolve, reject) => {
        const o = indexedDB.open('beatboy');
        o.onerror = () => reject(o.error);
        o.onsuccess = () => {
          const r = o.result.transaction(s).objectStore(s).getAll();
          r.onsuccess = () => {
            o.result.close();
            resolve(r.result as T[]);
          };
        };
      }),
    store,
  );

/** Import fixture 01 at 200 BPM and wait until the song is saved. */
async function importRock(page: Page): Promise<void> {
  await open(page);
  await setCountInOff(page);
  await openImport(page);
  await paste(page, tabText('01-basic-rock-16th.txt'));
  await expect(dlg(page).getByTestId('tab-section')).toHaveCount(1);
  await dlg(page).getByTestId('tab-bpm').fill('200');
  await press(page, createBtn(page));
  await expect(dlg(page)).toHaveCount(0);
  await waitSaved(page);
}

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} layout: import drum tab`, () => {
    test.use(LAYOUTS[name]);

    test('1. fixture 01: preview says Good, Create makes a song that plays the groove', async ({ page }) => {
      await open(page);
      await setCountInOff(page);
      await openImport(page);
      await expect(createBtn(page)).toBeDisabled();
      await expect(area(page)).toHaveAttribute('placeholder', /Paste a drum tab here/);
      await paste(page, tabText('01-basic-rock-16th.txt'));
      await expect(dlg(page).getByTestId('tab-section')).toHaveCount(1);
      await expect(badge(page)).toHaveText('Good');
      const sec = dlg(page).getByTestId('tab-section').first();
      await expect(sec).toContainText('Part 1');
      await expect(sec).toContainText('× 2');
      await expect(sec.getByLabel('Beat of Part 1')).toHaveText('kh . h .  sh . h .  kh . h .  sh . h .');
      await expect(createBtn(page)).toBeEnabled();
      await dlg(page).getByTestId('tab-bpm').fill('200');
      await press(page, createBtn(page));

      await expect(dlg(page)).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: 'Imported tab: 1 section' })).toBeVisible();
      await expect(songName(page)).toHaveText('Imported tab');
      await expect(cards(page)).toHaveCount(1);
      await expect(cards(page).first().locator('.sc-label')).toContainText('Part 1');
      await expect.poll(() => engineBpm(page)).toBe(200);

      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => at(await log(page), BAR + 1680, 'hatClosed'), { timeout: 5000 }).toBeTruthy();
      const bars = byBar(await log(page));
      expect(bars.get(0)).toEqual(ROCK_BAR);
      expect(bars.get(1)).toEqual(ROCK_BAR);
      await press(page, stopBtn(page));
    });

    test('2. fixture 31: six named sections, tempo from the tab, screenshot', async ({ page }) => {
      await open(page);
      await openImport(page);
      await paste(page, tabText('31-sections-timestamps.txt'));
      const secs = dlg(page).getByTestId('tab-section');
      await expect(secs).toHaveCount(6);
      await expect(dlg(page).locator('.tab-sec-name')).toHaveText(['Intro', 'Verse 1', 'Pre-Chorus', 'Chorus', 'Solo', 'Outro']);
      await expect(dlg(page).getByTestId('tab-bpm')).toHaveValue('96');
      await expect(dlg(page).getByTestId('tab-summary')).toHaveText('6 sections');
      await expect(badge(page)).toHaveText('Good');
      mkdirSync('test-results/screenshots', { recursive: true });
      await page.screenshot({ path: `test-results/screenshots/${name}-tab-import.png` });

      // the name is editable
      await dlg(page).getByTestId('tab-song-name').fill('My imported song');
      await press(page, createBtn(page));
      await expect(dlg(page)).toHaveCount(0);
      await expect(songName(page)).toHaveText('My imported song');
      await expect(cards(page)).toHaveCount(6);
      await expect(cards(page).locator('.sc-label')).toContainText(['Intro', 'Verse 1', 'Pre-Chorus', 'Chorus', 'Solo', 'Outro']);
      await expect.poll(() => engineBpm(page)).toBe(96);
      await waitSaved(page);
      const songs = await idb<Rec>(page, 'songs');
      const mine = songs.find((s) => s.name === 'My imported song')!;
      expect(mine.sections!.map((s) => s.kind)).toEqual(['intro', 'verse', 'verse', 'chorus', 'solo', 'outro']);
      expect(mine.sections!.map((s) => s.bars)).toEqual([1, 2, 1, 2, 1, 1]);
      // song-local beats: Verse 1 (2 identical systems of one bar) and the Chorus differ, all 6 beats distinct => 6 beats
      const beats = (await idb<Rec>(page, 'patterns')).filter((p) => p.ownerSongId === mine.id);
      expect(beats.length).toBe(6);
    });

    test('3. a guitar tab (fixture 39) is rejected and cannot be created; the settings link opens the same sheet', async ({ page }) => {
      await open(page);
      await openImport(page);
      await paste(page, tabText('39-guitar-tab-pasted.txt'));
      await expect(badge(page)).toHaveText('Not a drum tab');
      await expect(dlg(page).getByTestId('tab-section')).toHaveCount(0);
      await expect(createBtn(page)).toBeDisabled();
      await press(page, dlg(page).getByRole('button', { name: 'Cancel' }));
      await expect(dlg(page)).toHaveCount(0);

      await press(page, page.getByRole('button', { name: 'Drummer settings' }));
      await press(page, page.getByRole('dialog', { name: 'Drummer settings' }).getByRole('button', { name: 'Import drum tab…' }));
      await expect(dlg(page)).toBeVisible();
      await expect(page.getByRole('dialog', { name: 'Drummer settings' })).toHaveCount(0);
      await press(page, dlg(page).getByRole('button', { name: 'Paste example' }));
      await expect(dlg(page).getByTestId('tab-section')).toHaveCount(2);
      await expect(dlg(page).getByTestId('tab-song-name')).toHaveValue('Example Groove');
      await expect(dlg(page).getByTestId('tab-bpm')).toHaveValue('96');
      await page.keyboard.press('Escape');
      await expect(dlg(page)).toHaveCount(0);
    });

    test('4. the imported song and its beats survive a reload and still play', async ({ page }) => {
      await importRock(page);
      const songs = await idb<Rec>(page, 'songs');
      const mine = songs.find((s) => s.name === 'Imported tab')!;
      expect(mine.sections).toHaveLength(1);
      expect((await idb<Rec>(page, 'patterns')).filter((p) => p.ownerSongId === mine.id)).toHaveLength(1);

      await page.reload();
      await expect(play(page)).toBeVisible();
      await expect(songName(page)).toHaveText('Imported tab');
      await expect(cards(page)).toHaveCount(1);
      await expect.poll(() => engineBpm(page)).toBe(200);
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => at(await log(page), BAR, 'kick'), { timeout: 5000 }).toBeTruthy();
      expect(byBar(await log(page)).get(0)).toEqual(ROCK_BAR);
      await press(page, stopBtn(page));
    });
  });
}
