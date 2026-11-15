import { expect, test as base, type Locator, type Page } from '@playwright/test';

export const ORIGIN = 'http://localhost:4173/';

export const LAYOUTS = {
  mobile: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
} as const;
export type LayoutName = keyof typeof LAYOUTS;

/** `test` with the "no console errors" guard on every test. */
export const test = base.extend<{ errors: string[] }>({
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
export { expect };

export interface Entry {
  time: number;
  tick: number;
  sound: string;
  vel: number;
}
type Bb = { __beatboy: { engine: { mode: string; bpm: number }; scheduledLog: Entry[] } };
export const log = (page: Page): Promise<Entry[]> =>
  page.evaluate(() => (window as unknown as Bb).__beatboy.scheduledLog.map((e) => ({ ...e })));
export const clearLog = (page: Page) => page.evaluate(() => (window as unknown as Bb).__beatboy.scheduledLog.splice(0));
export const mode = (page: Page): Promise<string> => page.evaluate(() => (window as unknown as Bb).__beatboy.engine.mode);
export const engineBpm = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as Bb).__beatboy.engine.bpm);

export const isMobile = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 900;
export async function press(page: Page, loc: Locator): Promise<void> {
  if (isMobile(page)) await loc.tap();
  else await loc.click();
}

export const BAR = 1920; // ticks in a 4/4 bar
export const play = (page: Page) => page.getByRole('button', { name: 'Play', exact: true });
export const stopBtn = (page: Page) => page.getByRole('button', { name: 'Stop', exact: true });
export const nextBtn = (page: Page) => page.getByRole('button', { name: 'Next section', exact: true });
export const breakBtn = (page: Page) => page.getByRole('button', { name: 'Break', exact: true });
export const loopBtn = (page: Page) => page.getByRole('button', { name: 'Loop section', exact: true });
export const clickBtn = (page: Page) => page.getByRole('button', { name: 'Click', exact: true });
export const nowName = (page: Page) => page.getByTestId('now-name');
export const queued = (page: Page) => page.getByTestId('queued-badge');
export const cards = (page: Page) => page.getByTestId('section-card');
export const bpmInput = (page: Page) => page.getByRole('textbox', { name: 'Tempo in BPM' });
export const songName = (page: Page) => page.getByTestId('song-name');
export const nav = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name });
export const goEditor = (page: Page) => press(page, nav(page, /^Beat Editor/));
export const goDrummer = (page: Page) => press(page, nav(page, /^Drummer/));

export async function open(page: Page, url = './'): Promise<void> {
  await page.goto(url);
  await expect(play(page)).toBeVisible();
  await expect(songName(page)).toBeVisible();
}

export async function setBpm(page: Page, v: number): Promise<void> {
  await bpmInput(page).fill(String(v));
  await bpmInput(page).press('Enter');
  await expect(bpmInput(page)).toHaveValue(String(v));
}

/** Count-in lives in the settings sheet. */
export async function setCountIn(page: Page, v: 'Off' | '1' | '2'): Promise<void> {
  await press(page, page.getByRole('button', { name: 'Drummer settings' }));
  const b = page.getByRole('group', { name: 'Count-in' }).getByRole('button', { name: v, exact: true });
  await press(page, b);
  await expect(b).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Drummer settings' })).toHaveCount(0);
}
export const setCountInOff = (page: Page) => setCountIn(page, 'Off');

export async function pickGroove(page: Page, card: Locator, name: string): Promise<void> {
  await press(page, card.getByRole('button', { name: /^Section groove:/ }));
  await press(page, page.getByRole('dialog', { name: 'Section groove' }).getByRole('option', { name: new RegExp(`^${name}`) }));
  await expect(card.getByRole('button', { name: /^Section groove:/ })).toContainText(name);
}

export async function waitSaved(page: Page): Promise<void> {
  await expect(page.getByTestId('song-save')).toHaveText('Saved');
}

export const sounds = (es: Entry[], from: number, to: number) =>
  es.filter((e) => Math.round(e.tick) >= from && Math.round(e.tick) < to && !e.sound.startsWith('click'));
export const at = (es: Entry[], tick: number, sound: string) => es.find((e) => Math.round(e.tick) === tick && e.sound === sound);

/** Picker: choose a song by name. */
export async function pickSong(page: Page, name: RegExp): Promise<void> {
  await press(page, page.getByRole('button', { name: /^Song:/ }));
  await press(page, page.getByRole('dialog', { name: 'Song' }).getByRole('option', { name }));
}

/** New song "Song N" (one Verse of 8 bars). */
export async function newSong(page: Page): Promise<void> {
  await press(page, page.getByRole('button', { name: /^Song:/ }));
  await press(page, page.getByRole('dialog', { name: 'Song' }).getByRole('button', { name: /New song/ }));
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Song' })).toHaveCount(0);
}

export async function setBars(page: Page, i: number, bars: number): Promise<void> {
  const input = cards(page).nth(i).getByRole('textbox', { name: 'Bars in section' });
  await input.fill(String(bars));
  await input.press('Enter');
  await expect(input).toHaveValue(String(bars));
}

/** New song with Intro / Verse / Chorus of 2 bars each (Ride Rock / Rock 8ths / Rock 16ths), 200 BPM, count-in off. */
export async function makeShortSong(page: Page): Promise<void> {
  await newSong(page);
  await expect(songName(page)).toHaveText('Song 1');
  await expect(cards(page)).toHaveCount(1);
  await press(page, cards(page).nth(0).getByRole('button', { name: 'Delete section' }));
  await expect(cards(page)).toHaveCount(0);
  for (const k of ['Intro', 'Verse', 'Chorus']) await press(page, page.getByRole('button', { name: `Add ${k}`, exact: true }));
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).nth(0).locator('.sc-label')).toContainText('Intro');
  await expect(cards(page).nth(2).locator('.sc-label')).toContainText('Chorus');
  const grooves = ['Ride Rock', 'Rock 8ths', 'Rock 16ths'];
  for (let i = 0; i < 3; i++) {
    await setBars(page, i, 2);
    await pickGroove(page, cards(page).nth(i), grooves[i]!);
  }
  await setBpm(page, 200);
  await setCountInOff(page);
  await waitSaved(page);
}
