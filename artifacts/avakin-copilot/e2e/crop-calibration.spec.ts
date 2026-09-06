import { expect, test } from '@playwright/test';

type DrawCall = [CanvasImageSource, number, number, number, number, number, number, number, number];

const cropLabelPattern = /(\d+)%, (\d+)% · (\d+)% × (\d+)%/;

function readCropLabel(label: string) {
  const match = cropLabelPattern.exec(label);
  if (!match) throw new Error(`Unexpected crop label: ${label}`);
  return {
    x: Number(match[1]) / 100,
    y: Number(match[2]) / 100,
    width: Number(match[3]) / 100,
    height: Number(match[4]) / 100,
  };
}

function expectNormalizedCrop(crop: ReturnType<typeof readCropLabel>) {
  expect(crop.x).toBeGreaterThanOrEqual(0);
  expect(crop.y).toBeGreaterThanOrEqual(0);
  expect(crop.width).toBeGreaterThanOrEqual(0.1);
  expect(crop.height).toBeGreaterThanOrEqual(0.1);
  expect(crop.x + crop.width).toBeLessThanOrEqual(1);
  expect(crop.y + crop.height).toBeLessThanOrEqual(1);
}

async function drag(page: import('@playwright/test').Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
}

async function dragSelection(page: import('@playwright/test').Page, dx: number, dy: number) {
  const selection = page.getByTestId('crop-selection');
  const bounds = await selection.boundingBox();
  if (!bounds) throw new Error('Crop selection is not laid out');
  await drag(
    page,
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    { x: bounds.x + bounds.width / 2 + dx, y: bounds.y + bounds.height / 2 + dy },
  );
}

async function dragHandle(page: import('@playwright/test').Page, handle: string, dx: number, dy: number) {
  const locator = page.locator(`.crop-handle-${handle}`);
  const bounds = await locator.boundingBox();
  const selectorBounds = await page.getByTestId('crop-selection').boundingBox();
  if (!bounds || !selectorBounds) throw new Error(`Crop handle ${handle} is not laid out`);
  await drag(
    page,
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    { x: bounds.x + bounds.width / 2 + dx, y: bounds.y + bounds.height / 2 + dy },
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const source = document.createElement('canvas');
    source.width = 640;
    source.height = 360;
    const context = source.getContext('2d');
    context?.fillRect(0, 0, source.width, source.height);
    HTMLMediaElement.prototype.play = async () => undefined;
    Object.defineProperties(HTMLVideoElement.prototype, {
      readyState: { configurable: true, get: () => 4 },
      videoWidth: { configurable: true, get: () => 640 },
      videoHeight: { configurable: true, get: () => 360 },
    });

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getDisplayMedia: async () => source.captureStream(30),
      },
    });

    const drawCalls: unknown[] = [];
    Object.defineProperty(window, '__cropDrawCalls', {
      configurable: true,
      value: drawCalls,
    });
    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: Parameters<typeof originalDrawImage>) {
      if (args.length === 9) drawCalls.push(args);
      return originalDrawImage.apply(this, args);
    };
  });
  await page.route('**/api/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: [] }) });
  });
  await page.goto('/');
});

test('keeps calibration bounds clamped across moves and multiple resize handles', async ({ page }) => {
  await page.getByTestId('button-start-capture').click();
  await expect(page.getByTestId('button-stop-capture')).toBeVisible();

  await page.getByTestId('button-calibrate-chat').click();
  await expect(page.getByTestId('capture-preview-video')).toBeVisible();
  await expect(page.getByTestId('crop-selection')).toBeVisible();

  const selector = page.locator('.relative.aspect-video');
  const selectorBounds = await selector.boundingBox();
  if (!selectorBounds) throw new Error('Calibration preview is not laid out');

  await dragSelection(page, -selectorBounds.width * 2, -selectorBounds.height * 2);
  expectNormalizedCrop(readCropLabel(await page.getByTestId('text-crop-coordinates').innerText()));
  expect(await page.getByTestId('text-crop-coordinates').innerText()).toMatch(/^0%, 0%/);

  await dragHandle(page, 'se', selectorBounds.width * 2, selectorBounds.height * 2);
  expectNormalizedCrop(readCropLabel(await page.getByTestId('text-crop-coordinates').innerText()));

  await dragHandle(page, 'nw', -selectorBounds.width * 2, -selectorBounds.height * 2);
  expectNormalizedCrop(readCropLabel(await page.getByTestId('text-crop-coordinates').innerText()));

  await dragHandle(page, 'e', -selectorBounds.width * 2, 0);
  const finalCrop = readCropLabel(await page.getByTestId('text-crop-coordinates').innerText());
  expectNormalizedCrop(finalCrop);
  expect(finalCrop.width).toBeGreaterThanOrEqual(0.1);
  expect(finalCrop.x + finalCrop.width).toBeLessThanOrEqual(1);
});

test('uses a recalibrated crop for the next canvas extraction without stopping capture', async ({ page }) => {
  await page.getByTestId('button-start-capture').click();
  await expect(page.getByTestId('button-stop-capture')).toBeVisible();
  await page.getByTestId('button-calibrate-chat').click();

  await dragSelection(page, -2000, -2000);
  await page.getByTestId('button-save-calibration').click();
  await expect(page.getByTestId('button-stop-capture')).toBeVisible();
  await expect(page.getByTestId('button-calibrate-chat')).toContainText('إعادة تحديد المنطقة');

  await page.getByTestId('button-calibrate-chat').click();
  const selector = page.locator('.relative.aspect-video');
  const selectorBounds = await selector.boundingBox();
  if (!selectorBounds) throw new Error('Calibration preview is not laid out');
  await dragSelection(page, selectorBounds.width * 0.25, selectorBounds.height * 0.2);

  const savedCrop = readCropLabel(await page.getByTestId('text-crop-coordinates').innerText());
  expectNormalizedCrop(savedCrop);
  await page.getByTestId('button-save-calibration').click();

  await expect.poll(async () => page.evaluate(() => (window.__cropDrawCalls as DrawCall[] | undefined)?.length ?? 0), { timeout: 5_000 }).toBeGreaterThan(0);
  const drawCalls = await page.evaluate(() => window.__cropDrawCalls as DrawCall[]);
  const latestCall = drawCalls.at(-1);
  if (!latestCall) throw new Error('No canvas extraction was recorded');

  expect(latestCall[1]).toBe(Math.round(640 * savedCrop.x));
  expect(latestCall[2]).toBe(Math.round(360 * savedCrop.y));
  expect(latestCall[3]).toBe(Math.min(640 - latestCall[1], Math.max(1, Math.round(640 * savedCrop.width))));
  expect(latestCall[4]).toBe(Math.min(360 - latestCall[2], Math.max(1, Math.round(360 * savedCrop.height))));
});