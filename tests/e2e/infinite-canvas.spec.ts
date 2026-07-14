import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Dev-only hook installed by StageCanvas: { engine, viewport }. */
async function viewportState(page: Page) {
  return page.evaluate(() =>
    (window as any).__scratchy.viewport.get() as { x: number; y: number; zoom: number },
  );
}

async function strokes(page: Page) {
  return page.evaluate(
    () =>
      (window as any).__scratchy.engine.getStrokes() as {
        points: { x: number; y: number }[];
      }[],
  );
}

async function stageBox(page: Page) {
  const box = await page.locator('.stage-input').boundingBox();
  if (!box) throw new Error('stage not found');
  return box;
}

async function drawLine(page: Page, fx: number, fy: number, tx: number, ty: number) {
  const box = await stageBox(page);
  await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * tx, box.y + box.height * ty, { steps: 8 });
  await page.mouse.up();
}

// Each test runs in a fresh browser context, so storage starts empty. The
// boards menu only renders once persistence has finished initializing.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');
});

test('wheel zoom anchors the world point under the cursor', async ({ page }) => {
  const box = await stageBox(page);
  // Integer client coords: wheel events round them, and the anchor math must
  // see exactly the same point the app's handler sees.
  const cx = Math.round(box.x + box.width * 0.7);
  const cy = Math.round(box.y + box.height * 0.4);

  // Stage coords of the cursor stay fixed; the world point under them must too.
  const anchorWorldBefore = await page.evaluate(
    ([clientX, clientY]) => {
      const rect = document.querySelector('.stage-input')!.getBoundingClientRect();
      const stage = {
        x: ((clientX - rect.left) * 1280) / rect.width,
        y: ((clientY - rect.top) * 720) / rect.height,
      };
      return (window as any).__scratchy.viewport.stageToWorld(stage);
    },
    [cx, cy],
  );

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);

  const after = await viewportState(page);
  expect(after.zoom).toBeGreaterThan(1);

  const anchorWorldAfter = await page.evaluate(
    ([clientX, clientY]) => {
      const rect = document.querySelector('.stage-input')!.getBoundingClientRect();
      const stage = {
        x: ((clientX - rect.left) * 1280) / rect.width,
        y: ((clientY - rect.top) * 720) / rect.height,
      };
      return (window as any).__scratchy.viewport.stageToWorld(stage);
    },
    [cx, cy],
  );
  expect(anchorWorldAfter.x).toBeCloseTo(anchorWorldBefore.x, 3);
  expect(anchorWorldAfter.y).toBeCloseTo(anchorWorldBefore.y, 3);
});

test('strokes are anchored in world coordinates across pans', async ({ page }) => {
  await drawLine(page, 0.3, 0.5, 0.4, 0.5);
  const [first] = await strokes(page);

  // Drag the world 200 stage px to the left: the same screen spot is now a
  // world point 200 px further right.
  await page.evaluate(() => (window as any).__scratchy.viewport.panBy(-200, 0));

  await drawLine(page, 0.3, 0.5, 0.4, 0.5);
  const all = await strokes(page);
  expect(all).toHaveLength(2);

  const dx = all[1].points[0].x - first.points[0].x;
  const dy = all[1].points[0].y - first.points[0].y;
  expect(dx).toBeCloseTo(200, 0);
  expect(Math.abs(dy)).toBeLessThan(2);
});

test('hand tool pans instead of drawing', async ({ page }) => {
  await page.keyboard.press('v');
  const before = await viewportState(page);
  await drawLine(page, 0.6, 0.6, 0.3, 0.6);
  const after = await viewportState(page);

  expect(await strokes(page)).toHaveLength(0);
  expect(after.x).toBeGreaterThan(before.x); // dragged left → world origin moved right
  expect(after.zoom).toBe(before.zoom);
});

test('space-drag pans with the pen tool active', async ({ page }) => {
  const before = await viewportState(page);
  await page.keyboard.down('Space');
  await drawLine(page, 0.5, 0.5, 0.5, 0.3);
  await page.keyboard.up('Space');

  expect(await strokes(page)).toHaveLength(0);
  const after = await viewportState(page);
  expect(after.y).toBeGreaterThan(before.y);

  // Releasing space returns to drawing.
  await drawLine(page, 0.4, 0.4, 0.5, 0.4);
  expect(await strokes(page)).toHaveLength(1);
});

test('viewport survives a reload via autosave', async ({ page }) => {
  await drawLine(page, 0.3, 0.3, 0.5, 0.3);
  await page.evaluate(() => {
    const vp = (window as any).__scratchy.viewport;
    vp.set({ x: 640, y: -320, zoom: 2 });
  });
  // Wait for the debounced autosave to actually land in the board store.
  // (expect.poll, not waitForFunction: an async predicate's Promise object
  // would count as immediately truthy there.)
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const api = (window as any).__scratchyBoards;
        const boards = await api.listBoards();
        if (boards.length !== 1) return false;
        const board = await api.loadBoard(boards[0].id);
        return board !== null && board.viewport.x === 640 && board.strokes.length === 1;
      }),
    )
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');

  const restored = await viewportState(page);
  expect(restored.x).toBeCloseTo(640, 1);
  expect(restored.y).toBeCloseTo(-320, 1);
  expect(restored.zoom).toBeCloseTo(2, 3);
  expect(await strokes(page)).toHaveLength(1);
});

test('v1 lessons migrate to v2 with an identity viewport', async ({ page }) => {
  await page.addInitScript(() => {
    // The beforeEach visit already initialized the board store; drop it so
    // this navigation is a true first run with only the legacy lesson.
    indexedDB.deleteDatabase('scratchy');
    localStorage.clear();
    localStorage.setItem(
      'scratchy.lesson.v1',
      JSON.stringify({
        version: 1,
        title: 'Legacy lesson',
        background: 'grid',
        tool: 'pen',
        color: '#1d1f24',
        width: 4,
        cameraLayout: {
          x: 956,
          y: 527,
          width: 300,
          height: 169,
          shape: 'rounded',
          mirrored: true,
        },
        strokes: [
          {
            id: 's-legacy-1',
            tool: 'pen',
            color: '#1d1f24',
            baseWidth: 4,
            opacity: 1,
            simulatePressure: true,
            points: [
              { x: 100, y: 100, pressure: 0.5 },
              { x: 300, y: 200, pressure: 0.5 },
            ],
          },
        ],
        updatedAt: 1700000000000,
      }),
    );
  });
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');

  expect(await strokes(page)).toHaveLength(1);
  const vp = await viewportState(page);
  expect(vp).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(await page.locator('.title-input').inputValue()).toBe('Legacy lesson');

  // The legacy lesson was imported into the IndexedDB board store and the
  // localStorage copies were dropped after the import write succeeded.
  const state = await page.evaluate(async () => ({
    boards: await (window as any).__scratchyBoards.listBoards(),
    v1: localStorage.getItem('scratchy.lesson.v1'),
    v2: localStorage.getItem('scratchy.lesson.v2'),
  }));
  expect(state.boards).toHaveLength(1);
  expect(state.boards[0].title).toBe('Legacy lesson');
  expect(state.v1).toBeNull();
  expect(state.v2).toBeNull();
});

test('pinch pan-zoom with two touch pointers', async ({ page }) => {
  const box = await stageBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const before = await viewportState(page);
  // Synthesize a two-finger pinch-out on the input canvas.
  await page.evaluate(
    ([x, y]) => {
      const el = document.querySelector('.stage-input')!;
      const fire = (type: string, id: number, px: number, py: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: px,
            clientY: py,
            isPrimary: id === 1,
            bubbles: true,
            cancelable: true,
          }),
        );
      fire('pointerdown', 1, x - 40, y);
      fire('pointerdown', 2, x + 40, y); // lands immediately → pan takeover
      fire('pointermove', 1, x - 120, y);
      fire('pointermove', 2, x + 120, y);
      fire('pointerup', 1, x - 120, y);
      fire('pointerup', 2, x + 120, y);
    },
    [cx, cy],
  );

  const after = await viewportState(page);
  expect(after.zoom).toBeGreaterThan(before.zoom);
  expect(await strokes(page)).toHaveLength(0);
});
