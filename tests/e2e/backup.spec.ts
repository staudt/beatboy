import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import {
  LAYOUTS,
  at,
  cards,
  clearLog,
  expect,
  log,
  newSong,
  open,
  play,
  press,
  setBpm,
  setCountInOff,
  stopBtn,
  test,
  waitSaved,
  songName,
  type LayoutName,
} from './fixtures';

const A = 'kh . . .  . . . .  sh . . .  . . . .';
const B = 'k . . .  . . . .  k . . .  . . . .';

const chip = (card: Locator) => card.getByRole('button', { name: /^Section groove:/ });
const field = (card: Locator) => card.getByTestId('beat-text');
const panelOf = (page: Page) => page.getByRole('dialog', { name: 'Section groove' });
const settings = (page: Page) => page.getByRole('dialog', { name: 'Drummer settings' });
const importDlg = (page: Page) => page.getByRole('dialog', { name: 'Import' });

async function typeBeat(page: Page, card: Locator, text: string) {
  await press(page, chip(card));
  await field(card).fill(text);
  await field(card).press('Enter');
  await expect(panelOf(page)).toHaveCount(0);
}

/** Song 1: section 1 has a song beat (A), section 2 a saved groove "Kicks" (B). 200 BPM, no count-in. */
async function buildLibrary(page: Page) {
  await open(page);
  await newSong(page);
  await expect(cards(page)).toHaveCount(1);
  await setBpm(page, 200);
  await setCountInOff(page);
  await typeBeat(page, cards(page).nth(0), A);
  await press(page, page.getByRole('button', { name: 'Add Chorus', exact: true }));
  await expect(cards(page)).toHaveCount(2);
  const c = cards(page).nth(1);
  await typeBeat(page, c, B);
  await press(page, chip(c));
  await panelOf(page).getByRole('textbox', { name: 'Groove name' }).fill('Kicks');
  await press(page, panelOf(page).getByRole('button', { name: 'Save as groove' }));
  await expect(chip(c)).toContainText('Kicks');
  await waitSaved(page);
}

async function openSettings(page: Page) {
  await press(page, page.getByRole('button', { name: 'Drummer settings' }));
  await expect(settings(page)).toBeVisible();
}

async function download(page: Page, click: () => Promise<void>, testInfo: TestInfo, name: string) {
  const [dl] = await Promise.all([page.waitForEvent('download'), click()]);
  const file = testInfo.outputPath(name);
  await dl.saveAs(file);
  return { file, name: dl.suggestedFilename(), json: JSON.parse(readFileSync(file, 'utf8')) };
}
const exportEverything = (page: Page, info: TestInfo) =>
  download(page, async () => press(page, page.getByRole('button', { name: 'Export everything' })), info, 'all.json');
const exportSong = (page: Page, info: TestInfo, name = 'song.json') =>
  download(page, async () => press(page, page.getByRole('button', { name: 'Export song' })), info, name);

/** Choose a file in the settings sheet (open it first). */
async function chooseFile(page: Page, path: string | { name: string; mimeType: string; buffer: Buffer }) {
  await openSettings(page);
  await page.getByTestId('import-file').setInputFiles(path);
}

async function idb<T>(page: Page, store: 'songs' | 'patterns'): Promise<T[]> {
  return page.evaluate(
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
}
type Rec = { id: string; name: string; ownerSongId?: string; bpm?: number; builtIn?: boolean };

/** Leaves the app (closing its DB connection), deletes the database, comes back to a fresh install. */
async function wipe(page: Page) {
  await page.route('**/blank-wipe', (r) => r.fulfill({ contentType: 'text/html', body: '<p>wiping</p>' }));
  await page.goto('./blank-wipe');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const q = indexedDB.deleteDatabase('beatboy');
        q.onsuccess = q.onerror = q.onblocked = () => resolve();
      }),
  );
  await open(page);
  await expect.poll(async () => (await idb<Rec>(page, 'songs')).length).toBe(2); // the seeded Practice + Demo
}

async function songNames(page: Page): Promise<string[]> {
  await press(page, page.getByRole('button', { name: /^Song:/ }));
  const names = await page.getByRole('dialog', { name: 'Song' }).getByRole('option').locator('.bi-name').allTextContents();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Song' })).toHaveCount(0);
  return names;
}

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} layout: backup`, () => {
    test.use(LAYOUTS[name]);

    test('1. export everything, wipe, import: songs and beats are back and play', async ({ page }, info) => {
      await buildLibrary(page);
      await openSettings(page);
      await expect(page.getByTestId('last-backup')).toHaveText('Last backup: never');
      await expect(page.getByText('stored only in this browser', { exact: false })).toBeVisible();
      if (name === 'mobile') {
        mkdirSync('test-results/screenshots', { recursive: true });
        await expect(page.getByRole('status').filter({ hasText: 'Saved as groove' })).toHaveCount(0, { timeout: 6000 });
        await page.getByTestId('last-backup').scrollIntoViewIfNeeded();
        await page.screenshot({ path: 'test-results/screenshots/mobile-backup.png' });
      }
      const out = await exportEverything(page, info);
      expect(out.name).toMatch(/^beatboy-backup-\d{4}-\d{2}-\d{2}\.beatboy\.json$/);
      expect(out.json).toMatchObject({ format: 'beatboy', version: 1, kind: 'library' });
      expect(out.json.songs.map((s: Rec) => s.name).sort()).toEqual(['Demo song', 'Practice', 'Song 1']);
      expect(out.json.patterns).toHaveLength(2); // the song beat and the saved groove; no built-ins
      expect(out.json.patterns.some((p: Rec) => p.builtIn)).toBe(false);
      expect(out.json.settings.drummer.bpm).toBe(200);
      await expect(page.getByTestId('last-backup')).toHaveText('Last backup: just now');
      await page.keyboard.press('Escape');

      // the label survives a reload
      await page.reload();
      await open(page);
      await openSettings(page);
      await expect(page.getByTestId('last-backup')).toHaveText('Last backup: just now');
      await page.keyboard.press('Escape');

      await wipe(page);
      await chooseFile(page, out.file);
      await expect(importDlg(page)).toBeVisible();
      await expect(page.getByTestId('import-summary')).toHaveText('Importing: 3 songs, 2 beats');
      await expect(importDlg(page).getByRole('list', { name: 'Songs in this file' })).toContainText('Song 1');
      if (name === 'desktop') await page.waitForTimeout(500);
      if (name === 'desktop') await page.screenshot({ path: 'test-results/screenshots/desktop-import-preview.png' });
      await press(page, importDlg(page).getByRole('button', { name: 'Import', exact: true }));
      await expect(page.getByRole('status').filter({ hasText: 'Imported 3 songs, 2 beats' })).toBeVisible();
      await expect(songName(page)).toHaveText('Song 1');
      await expect(cards(page)).toHaveCount(2);
      await expect(chip(cards(page).nth(1))).toContainText('Kicks');
      await expect(page.getByTestId('beat-display-text').first()).toHaveText(A);
      await waitSaved(page);
      // The fresh device's untouched starter songs give way to the backup's songs: no "(imported)" twins.
      expect([...(await songNames(page))].sort()).toEqual(['Demo song', 'Practice', 'Song 1']);

      // persisted: survives a reload, and the song beat plays
      await page.reload();
      await open(page);
      await expect(songName(page)).toHaveText('Song 1');
      await expect(cards(page)).toHaveCount(2);
      await setCountInOff(page);
      await clearLog(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await expect.poll(async () => (await log(page)).length).toBeGreaterThan(8);
      const es = await log(page);
      expect(at(es, 0, 'kick')).toBeTruthy();
      expect(at(es, 0, 'hatClosed')).toBeTruthy();
      expect(at(es, 960, 'snare')).toBeTruthy();
      await press(page, stopBtn(page));
    });

    test('2. export song; keep both makes an independent copy; replace does not duplicate', async ({ page }, info) => {
      await buildLibrary(page);
      const out = await exportSong(page, info);
      expect(out.name).toBe('Song 1.beatboy.json');
      expect(out.json).toMatchObject({ format: 'beatboy', kind: 'song' });
      expect(out.json.songs).toHaveLength(1);
      expect(out.json.patterns.map((p: Rec) => p.name).sort()).toEqual(['Kicks', 'Song 1 · Verse']);
      expect(out.json.settings).toBeUndefined();

      // an unchanged song is already here
      await chooseFile(page, out.file);
      await expect(page.getByTestId('import-conflicts')).toHaveText('Everything in this file is already here.');
      await expect(importDlg(page).getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
      await press(page, importDlg(page).getByRole('button', { name: 'Cancel' }));
      await expect(importDlg(page)).toHaveCount(0);

      await setBpm(page, 150);
      await waitSaved(page);
      await chooseFile(page, out.file);
      await expect(page.getByTestId('import-summary')).toHaveText('Importing: 1 song, 2 beats');
      await expect(page.getByTestId('import-conflicts')).toContainText('1 item exists');
      await expect(importDlg(page).getByRole('radio', { name: 'Keep both (recommended)' })).toBeChecked();
      await press(page, importDlg(page).getByRole('button', { name: 'Import', exact: true }));
      await expect(page.getByRole('status').filter({ hasText: 'Imported 1 song, 1 beat' })).toBeVisible();
      await expect(songName(page)).toHaveText('Song 1 (imported)');
      await waitSaved(page);
      const songs = await idb<Rec>(page, 'songs');
      expect(songs.filter((s) => s.name.startsWith('Song 1'))).toHaveLength(2);
      const orig = songs.find((s) => s.name === 'Song 1')!;
      const copy = songs.find((s) => s.name === 'Song 1 (imported)')!;
      expect(orig.id).not.toBe(copy.id);
      expect(orig.bpm).toBe(150);
      const pats = (await idb<Rec>(page, 'patterns')).filter((p) => p.name !== 'Kicks');
      expect(pats.map((p) => p.ownerSongId).sort()).toEqual([orig.id, copy.id].sort());
      expect((await idb<Rec>(page, 'patterns')).filter((p) => p.name === 'Kicks')).toHaveLength(1);

      // the copy's beat is its own: typing in the copy leaves the original alone
      await typeBeat(page, cards(page).nth(0), B);
      await expect(page.getByTestId('beat-display-text').first()).toHaveText(B);

      // replace: back to the exported version, no duplicate
      await chooseFile(page, out.file);
      await expect(page.getByTestId('import-conflicts')).toContainText('exist');
      await importDlg(page).getByRole('radio', { name: 'Replace existing' }).check();
      await press(page, importDlg(page).getByRole('button', { name: 'Import', exact: true }));
      await expect(page.getByRole('status').filter({ hasText: 'Imported 1 song' })).toBeVisible();
      await expect(songName(page)).toHaveText('Song 1');
      await waitSaved(page);
      const after = await idb<Rec>(page, 'songs');
      expect(after.filter((s) => s.name.startsWith('Song 1'))).toHaveLength(2);
      expect(after.find((s) => s.name === 'Song 1')!.bpm).toBe(200);
      await expect(page.getByTestId('beat-display-text').first()).toHaveText(A);
      expect(await songNames(page)).toEqual(expect.arrayContaining(['Song 1', 'Song 1 (imported)']));
    });

    test('3. a bad file shows an error and changes nothing', async ({ page }) => {
      await open(page);
      const before = (await idb<Rec>(page, 'songs')).length;
      const bad: [string, string, RegExp][] = [
        ['notes.txt', 'hello world', /could not be read as JSON/],
        ['other.json', JSON.stringify({ format: 'something', version: 1 }), /isn't a Beatboy file/],
        ['future.json', JSON.stringify({ format: 'beatboy', version: 99, songs: [], patterns: [] }), /newer version of Beatboy/],
      ];
      for (const [fileName, text, re] of bad) {
        await chooseFile(page, { name: fileName, mimeType: 'application/json', buffer: Buffer.from(text) });
        const dlg = page.getByRole('dialog', { name: "Can't import this file" });
        await expect(dlg).toBeVisible();
        await expect(dlg).toContainText(re);
        await press(page, dlg.getByRole('button', { name: 'OK' }));
        await expect(dlg).toHaveCount(0);
      }
      await expect(importDlg(page)).toHaveCount(0);
      expect((await idb<Rec>(page, 'songs')).length).toBe(before);
    });

    test('4. partly invalid files import what is valid and warn', async ({ page }, info) => {
      await buildLibrary(page);
      const out = await exportSong(page, info);
      out.json.patterns.push({ id: 'broken' });
      out.json.songs.push({ nope: true });
      const file = info.outputPath('partial.json');
      writeFileSync(file, JSON.stringify(out.json));
      await setBpm(page, 120);
      await chooseFile(page, file);
      await expect(importDlg(page).getByRole('note').filter({ hasText: '1 song could not be read and was skipped' })).toBeVisible();
      await expect(importDlg(page).getByRole('note').filter({ hasText: '1 pattern could not be read and was skipped' })).toBeVisible();
      await press(page, importDlg(page).getByRole('button', { name: 'Import', exact: true }));
      await expect(songName(page)).toHaveText('Song 1 (imported)');
    });

    if (name === 'desktop') {
      test('5. dropping a file on the page opens the import preview', async ({ page }, info) => {
        await buildLibrary(page);
        const out = await exportSong(page, info);
        await setBpm(page, 90);
        await page.evaluate((text) => {
          const dt = new DataTransfer();
          dt.items.add(new File([text], 'dropped.beatboy.json', { type: 'application/json' }));
          const target = document.querySelector('.app')!;
          target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
          target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
        }, JSON.stringify(out.json));
        await expect(importDlg(page)).toBeVisible();
        await expect(page.getByTestId('import-summary')).toHaveText('Importing: 1 song, 2 beats');
      });
    }
  });
}
