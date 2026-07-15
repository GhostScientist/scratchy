import { test, expect } from '@playwright/test';

/** Build a minimal valid multi-page PDF (612×792 pages) with a correct xref. */
function buildPdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(' ');
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>\nendobj\n`);
  const contentObj = 3 + pageCount;
  for (let i = 0; i < pageCount; i++) {
    objects.push(
      `${3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << >> /Contents ${contentObj} 0 R >>\nendobj\n`,
    );
  }
  const streamBody = '1 0 0 RG 8 w 100 100 m 400 500 l S\n';
  objects.push(
    `${contentObj} 0 obj\n<< /Length ${streamBody.length} >>\nstream\n${streamBody}endstream\nendobj\n`,
  );

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xrefStart = pdf.length;
  const pad = (n: number) => String(n).padStart(10, '0');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${pad(off)} 00000 n \n`;
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => (window as any).__scratchy !== undefined);
  await page.waitForSelector('.boards-menu');
});

test('a 2-page PDF becomes two slides with locked backdrops', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'deck.pdf',
    mimeType: 'application/pdf',
    buffer: buildPdf(2),
  });

  // Rendering runs through pdf.js in a worker — give it time.
  await page.waitForFunction(
    () => (window as any).__scratchyPages.info().count === 3,
    undefined,
    { timeout: 20_000 },
  );

  // The first imported slide opened, framed to fit.
  const info = await page.evaluate(() => (window as any).__scratchyPages.info());
  expect(info.activeIndex).toBe(1);
  const elements = await page.evaluate(() =>
    (window as any).__scratchy.engine.getElements().map((el: any) => ({ ...el })),
  );
  expect(elements).toHaveLength(1);
  expect(elements[0].kind).toBe('image');
  expect(elements[0].locked).toBe(true);
  // Portrait page: aspect preserved from 612×792.
  expect(Math.abs(elements[0].w / elements[0].h - 612 / 792)).toBeLessThan(0.01);
  // The page viewport shows the whole slide (zoomed out, not default 1).
  const viewport = await page.evaluate(() => (window as any).__scratchy.viewport.get());
  expect(viewport.zoom).toBeLessThan(1);

  // The second slide has its own locked backdrop with a distinct asset.
  await page.keyboard.press('PageDown');
  const second = await page.evaluate(() =>
    (window as any).__scratchy.engine.getElements().map((el: any) => ({ ...el })),
  );
  expect(second).toHaveLength(1);
  expect(second[0].locked).toBe(true);
  expect(second[0].assetId).not.toBe(elements[0].assetId);

  // Slides + assets survive a reload.
  await page.waitForTimeout(900);
  await page.reload();
  await page.waitForFunction(() => (window as any).__scratchyPages !== undefined);
  await page.waitForSelector('.page-strip');
  expect(await page.evaluate(() => (window as any).__scratchyPages.info().count)).toBe(3);
  const asset = await page.evaluate(
    (id) => (window as any).__scratchyAssets.getAsset(id),
    second[0].assetId,
  );
  expect(asset).not.toBeNull();
});
