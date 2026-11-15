import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { LAYOUTS, cards, expect, isMobile, nextBtn, open, pickSong, play, press, queued, setCountInOff, stopBtn, test, newSong, type LayoutName } from './fixtures';

const panel = (page: Page) => page.getByRole('dialog', { name: 'Section groove' });
const display = (page: Page, i: number) => cards(page).nth(i).getByTestId('beat-display');
const queuedInfo = (page: Page) =>
  page.evaluate(() => (window as unknown as { __beatboy: { engine: { songInfo(): { queued: unknown } | null } } }).__beatboy.engine.songInfo()?.queued ?? null);
const shot = (page: Page, n: string) => {
  mkdirSync('test-results/screenshots', { recursive: true });
  return page.screenshot({ path: `test-results/screenshots/${n}.png` });
};

for (const name of Object.keys(LAYOUTS) as LayoutName[]) {
  test.describe(`${name} layout: section beat panel`, () => {
    test.use(LAYOUTS[name]);

    test('the row shows the groove NAME for saved grooves and the PATTERN TEXT for song beats', async ({ page }) => {
      await open(page);
      await newSong(page);
      const c = cards(page).nth(0);
      await expect(c.getByTestId('beat-display-text')).toHaveText('Rock 8ths');
      await expect(c.getByTestId('beat-length')).toHaveText('4 beats');
      await press(page, display(page, 0));
      await page.getByTestId('beat-text').fill('s k s');
      await page.getByTestId('beat-text').press('Enter');
      await expect(panel(page)).toHaveCount(0);
      await expect(c.getByTestId('beat-display-text')).toHaveText('s k s');
      await expect(c.getByTestId('beat-length')).toHaveText('3 steps');
      // a long pattern is cut with an ellipsis on one line
      await press(page, display(page, 0));
      await page.getByTestId('beat-text').fill('kh . . .  . . . .  sh . . .  . . . .  kh . . .  . . . .  sh . . .  . . . .');
      await page.getByTestId('beat-text').press('Enter');
      const main = c.getByTestId('beat-display-text');
      const h = await main.evaluate((el) => ({ over: el.scrollWidth > el.clientWidth, h: el.getBoundingClientRect().height, ws: getComputedStyle(el).whiteSpace, to: getComputedStyle(el).textOverflow }));
      expect(h.ws).toBe('pre');
      expect(h.to).toBe('ellipsis');
      expect(h.h).toBeLessThan(30);
      if (isMobile(page)) expect(h.over).toBe(true);
    });

    test('clicking the display while playing opens the panel and queues no jump', async ({ page }) => {
      await open(page);
      await pickSong(page, /^Demo song/);
      await setCountInOff(page);
      await press(page, play(page));
      await expect(stopBtn(page)).toBeVisible();
      await press(page, display(page, 2));
      await expect(panel(page)).toBeVisible();
      await page.waitForTimeout(80);
      await expect(queued(page)).toHaveCount(0);
      expect(await queuedInfo(page)).toBeNull();
      // closing by clicking outside, on another row, is not a tap on that row either
      const other = (await cards(page).nth(0).boundingBox())!;
      await page.mouse.click(other.x + 3, Math.max(other.y + 4, 2));
      await expect(panel(page)).toHaveCount(0);
      await page.waitForTimeout(80);
      await expect(queued(page)).toHaveCount(0);
      expect(await queuedInfo(page)).toBeNull();
      await press(page, stopBtn(page));
    });

    test('panel order: text editor, then name and save, then find and the groove list', async ({ page }) => {
      await open(page);
      await newSong(page);
      await press(page, display(page, 0));
      await page.getByTestId('beat-text').fill('kh . sh .');
      await page.getByTestId('beat-text').press('Enter');
      await press(page, display(page, 0));
      const p = panel(page);
      const ys = async (loc: ReturnType<Page['locator']>) => (await loc.first().boundingBox())!;
      const text = await ys(page.getByTestId('beat-text'));
      const editor = await ys(p.getByRole('button', { name: 'Open in Beat Editor' }));
      const nameF = await ys(p.getByRole('textbox', { name: 'Groove name' }));
      const save = await ys(p.getByRole('button', { name: 'Save as groove' }));
      const find = await ys(p.getByRole('searchbox'));
      const first = await ys(p.getByRole('option'));
      expect(text.y).toBeLessThan(editor.y + 1);
      expect(editor.y + editor.height).toBeLessThanOrEqual(nameF.y + 0.5);
      expect(Math.abs(save.y + save.height / 2 - (nameF.y + nameF.height / 2))).toBeLessThan(30);
      expect(Math.max(nameF.y + nameF.height, save.y + save.height)).toBeLessThanOrEqual(find.y + 0.5);
      expect(find.y + find.height).toBeLessThanOrEqual(first.y + 0.5);
      // the DOM order agrees (focus order)
      const order = await p.evaluate((el) => {
        const idx = (sel: string) => [...el.querySelectorAll('textarea, input, button, [role=option]')].findIndex((n) => n.matches(sel));
        return [idx('textarea'), idx('input[aria-label="Groove name"]'), idx('input[type=search]'), idx('[role=option]')];
      });
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order[0]).toBe(0);
      // panel anchored under the display, inside the viewport
      const d = (await display(page, 0).boundingBox())!;
      const pb = (await p.boundingBox())!;
      expect(Math.abs(pb.y - (d.y + d.height + 4))).toBeLessThan(6);
      expect(pb.x).toBeGreaterThanOrEqual(0);
      expect(pb.x + pb.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5);
      if (isMobile(page)) expect(pb.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 33);
      // a saved groove: the same order with the name label instead of the field
      await page.keyboard.press('Escape');
      await press(page, display(page, 0));
      await press(page, p.getByRole('option', { name: /^Punk/ }));
      await press(page, display(page, 0));
      const t2 = await ys(page.getByTestId('beat-text'));
      const lab = await ys(p.getByTestId('beat-groove-name'));
      const find2 = await ys(p.getByRole('searchbox'));
      expect(t2.y + t2.height).toBeLessThanOrEqual(lab.y + 0.5);
      expect(lab.y + lab.height).toBeLessThanOrEqual(find2.y + 0.5);
      await page.keyboard.press('Escape');
    });

    test('screenshots: beat panel open on the demo song', async ({ page }) => {
      await open(page);
      await pickSong(page, /^Demo song/);
      await setCountInOff(page);
      await press(page, display(page, 1));
      await page.getByTestId('beat-text').fill('kh . sh .  kh . sh k');
      await page.waitForTimeout(350);
      await shot(page, `${name}-song-beat-panel`);
      await page.getByTestId('beat-text').press('Enter');
      await press(page, display(page, 1));
      await shot(page, `${name}-song-beat-panel-saved`);
      await page.keyboard.press('Escape');
    });
  });
}

test.describe('desktop layout: player on top, sections full width', () => {
  test.use(LAYOUTS.desktop);

  test('the player stays put while a long song scrolls under it; rows are single-line and wide', async ({ page }) => {
    await open(page);
    await pickSong(page, /^Demo song/);
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: i % 2 ? 'Add Chorus' : 'Add Verse', exact: true }).click();
    await expect.poll(() => cards(page).count()).toBeGreaterThan(14);
    const player = page.locator('.sv-player');
    const top = (await player.boundingBox())!;
    const tabs = (await page.locator('.topbar').boundingBox())!;
    expect(Math.abs(top.y - (tabs.y + tabs.height))).toBeLessThan(2);
    expect(top.width).toBeGreaterThanOrEqual(1400); // full width
    expect(top.height).toBeLessThanOrEqual(200);
    for (const y of [300, 900, 99999]) {
      await page.evaluate((v) => document.querySelector('.view')!.scrollTo(0, v), y);
      await page.waitForTimeout(100);
      const b = (await player.boundingBox())!;
      expect(Math.abs(b.y - top.y), `player top after scrolling to ${y}`).toBeLessThan(1);
      expect(Math.abs(b.height - top.height)).toBeLessThan(1);
    }
    expect(await page.evaluate(() => document.querySelector('.view')!.scrollTop)).toBeGreaterThan(200);
    // rows: one line (< 72 px), beat display >= 300 px, content centred and wide
    const rows = await cards(page).all();
    for (const r of rows) {
      const b = (await r.boundingBox())!;
      expect(b.height).toBeLessThan(72);
      expect((await r.getByTestId('beat-display').boundingBox())!.width).toBeGreaterThanOrEqual(300);
      expect(b.width).toBeGreaterThanOrEqual(1000);
    }
    // keyboard focus scrolls clear of the sticky player (scroll-margin)
    await page.evaluate(() => document.querySelector('.view')!.scrollTo(0, 99999));
    await page.evaluate(() => document.querySelector('.view')!.scrollTo(0, 0));
    const last = cards(page).nth((await cards(page).count()) - 1);
    await last.getByRole('button', { name: 'Delete section' }).focus();
    await page.waitForTimeout(150);
    const pb = (await player.boundingBox())!;
    const lb = (await last.boundingBox())!;
    expect(lb.y).toBeGreaterThanOrEqual(pb.y + pb.height - 1);
    await page.evaluate(() => document.querySelector('.view')!.scrollTo(0, 0));
    const first = (await cards(page).nth(0).boundingBox())!;
    expect(first.y).toBeGreaterThanOrEqual(pb.y + pb.height);
  });

  test('screenshots: desktop song, playing with a queued NEXT', async ({ page }) => {
    await open(page);
    await pickSong(page, /^Demo song/);
    await setCountInOff(page);
    await shot(page, 'desktop-song');
    await press(page, play(page));
    await expect(stopBtn(page)).toBeVisible();
    await press(page, nextBtn(page));
    await expect(queued(page)).toBeVisible();
    await shot(page, 'desktop-song-playing');
    await press(page, stopBtn(page));
  });
});

test.describe('mobile layout is unchanged', () => {
  test.use(LAYOUTS.mobile);
  test('no sticky player: the dock sits above the tab bar', async ({ page }) => {
    await open(page);
    await expect(page.locator('.sv-player')).toHaveCount(0);
    const dock = (await page.locator('.sv-dock').boundingBox())!;
    const tabs = (await page.locator('.tabs-bottom').boundingBox())!;
    expect(Math.abs(dock.y + dock.height - tabs.y)).toBeLessThanOrEqual(2);
  });
});
