import type { Locator, Page } from '@playwright/test';
import {
  LAYOUTS,
  cards,
  expect,
  goDrummer,
  goEditor,
  nowName,
  open,
  pickSong,
  play,
  press,
  setCountInOff,
  stopBtn,
  test,
  type LayoutName,
} from './fixtures';

const patternName = (page: Page) => page.getByTestId('pattern-name');
const pickerBtn = (page: Page) => page.getByRole('button', { name: /^Patterns:/ });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Patterns' });
const chip = (card: Locator) => card.getByRole('button', { name: /^Section groove:/ });

async function pickInEditor(page: Page, name: string): Promise<void> {
  await press(page, pickerBtn(page));
  await press(page, panel(page).getByRole('option', { name: new RegExp(`^${name}`) }).first());
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(patternName(page)).toHaveText(name);
}

async function openDemo(page: Page): Promise<void> {
  await open(page);
  await setCountInOff(page);
  await pickSong(page, /Demo song/);
  await expect(cards(page)).toHaveCount(8);
}

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} editor focus`, () => {
    test.use(LAYOUTS[name]);

    test('stopped after playing section 2: the editor opens its beat', async ({ page }) => {
      await openDemo(page);
      // park the editor on something unrelated first
      await goEditor(page);
      await pickInEditor(page, 'Punk');
      await goDrummer(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, cards(page).nth(1).locator('.sc-l1 .sc-go'));
      await expect(nowName(page)).toHaveText('Verse 1', { timeout: 6000 });
      await press(page, stopBtn(page));
      await expect(play(page)).toBeVisible();
      await goEditor(page);
      await expect(patternName(page)).toHaveText('Rock 8ths');
    });

    test('stopped, tapping row 3 makes the editor open its beat', async ({ page }) => {
      await openDemo(page);
      await press(page, cards(page).nth(2).locator('.sc-l1 .sc-go'));
      await goEditor(page);
      await expect(patternName(page)).toHaveText('Rock 16ths');
    });

    test('opening a row\'s beat dropdown focuses that row', async ({ page }) => {
      await openDemo(page);
      await press(page, cards(page).nth(5).locator('.sc-l1 .sc-go'));
      await press(page, chip(cards(page).nth(0)));
      await expect(page.getByRole('dialog', { name: 'Section groove' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Section groove' })).toHaveCount(0);
      await goEditor(page);
      await expect(patternName(page)).toHaveText('Ride Rock');
    });

    test('the editor picker lists the song\'s grooves first, song beats included', async ({ page }) => {
      await open(page);
      await setCountInOff(page);
      // a song beat typed into the Practice song must not show up for the Demo song
      const practiceCard = cards(page).nth(0);
      await press(page, chip(practiceCard));
      await practiceCard.getByTestId('beat-text').fill('k . . .');
      await practiceCard.getByTestId('beat-text').press('Enter');
      await expect(page.getByRole('dialog', { name: 'Section groove' })).toHaveCount(0);
      await pickSong(page, /Demo song/);
      await expect(cards(page)).toHaveCount(8);
      // a song beat of the Demo song (section 1)
      const first = cards(page).nth(0);
      await press(page, chip(first));
      await first.getByTestId('beat-text').fill('k . s .');
      await first.getByTestId('beat-text').press('Enter');
      await expect(page.getByRole('dialog', { name: 'Section groove' })).toHaveCount(0);

      await goEditor(page);
      await press(page, pickerBtn(page));
      const p = panel(page);
      await expect(p.locator('.pp-cat').first()).toHaveText('In Demo song');
      const group = p.getByRole('group', { name: 'In Demo song' });
      const names = await group.locator('.bi-name').allTextContents();
      expect(names).toEqual(['Demo song · Intro', 'Rock 8ths', 'Rock 16ths', 'Half-time Rock']);
      await expect(group.locator('.bi-meta').nth(1)).toContainText('Verse 1, Verse 2, Outro · 4 beats');
      await expect(group.locator('.bi-meta').nth(2)).toContainText('Chorus 1, Chorus 2, Chorus 3');
      // not repeated in the later groups; the other song's beat is nowhere
      for (const n of ['Rock 8ths', 'Rock 16ths', 'Half-time Rock']) await expect(p.getByRole('option', { name: new RegExp(`^${n}`) })).toHaveCount(1);
      await expect(p.getByRole('option', { name: /Practice/ })).toHaveCount(0);
      expect(await p.getByRole('option').count()).toBeGreaterThan(8);
      // find matches section names
      await p.getByRole('searchbox').fill('bridge');
      await expect(p.getByRole('option')).toHaveCount(1);
      await expect(p.getByRole('option').first()).toContainText('Half-time Rock');
    });

    test('tapping an instrument name auditions it like its pad', async ({ page }) => {
      await page.goto('./#/editor');
      await expect(patternName(page)).toBeVisible();
      const auditions = () =>
        page.evaluate(() => (window as unknown as { __beatboy: { auditionLog: { sound: string }[] } }).__beatboy.auditionLog.map((a) => a.sound));
      const clear = () => page.evaluate(() => (window as unknown as { __beatboy: { auditionLog: unknown[] } }).__beatboy.auditionLog.splice(0));
      await clear();
      if (name === 'desktop') {
        await page.getByRole('button', { name: 'Select Snare' }).first().click();
        await expect.poll(auditions).toEqual(['snare']);
        await expect(page.getByRole('button', { name: 'Select Snare' }).first()).toHaveAttribute('aria-pressed', 'true');
        await clear();
        await page.getByRole('button', { name: 'Select Kick' }).first().focus();
        expect(await auditions()).toEqual([]);
        await page.keyboard.press('Enter');
        await expect.poll(auditions).toEqual(['kick']);
      } else {
        await press(page, page.getByRole('button', { name: 'Snare pad' }));
        await clear();
        await press(page, page.getByTestId('lane-title'));
        await expect.poll(auditions).toEqual(['snare']);
        await clear();
        await press(page, page.getByRole('button', { name: 'Select Hi-hat' }).first());
        await expect.poll(auditions).toEqual(['hatClosed']);
      }
    });
  });
}
