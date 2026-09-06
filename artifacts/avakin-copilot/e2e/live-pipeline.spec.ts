import { expect, test, type Page } from '@playwright/test';

type InjectedOcr = { rawText: string; text: string; confidence: number; variant?: string };

async function prepareLiveCapture(page: Page) {
  await page.addInitScript(() => {
    const source = document.createElement('canvas');
    source.width = 1280;
    source.height = 720;
    const sourceContext = source.getContext('2d');
    sourceContext?.fillRect(0, 0, source.width, source.height);

    Object.assign(window, {
      __avakinTestOcrQueue: [] as InjectedOcr[],
      __changeCaptureFrame() {
        const context = source.getContext('2d');
        if (!context) return;
        const version = Number(source.dataset.version ?? '0') + 1;
        source.dataset.version = String(version);
        context.fillStyle = version % 2 ? '#f4f4f4' : '#202020';
        context.fillRect(0, 0, source.width, source.height);
        context.fillStyle = version % 2 ? '#111111' : '#ffffff';
        context.fillRect(80 + version * 15, 80, 800, 120);
      },
    });

    HTMLMediaElement.prototype.play = async () => undefined;
    Object.defineProperties(HTMLVideoElement.prototype, {
      readyState: { configurable: true, get: () => 4 },
      videoWidth: { configurable: true, get: () => 1280 },
      videoHeight: { configurable: true, get: () => 720 },
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: async () => source.captureStream(30) },
    });

    const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (...args: Parameters<typeof originalDrawImage>) {
      if (args[0] instanceof HTMLVideoElement) {
        return originalDrawImage.apply(this, [source, ...args.slice(1)] as Parameters<typeof originalDrawImage>);
      }
      return originalDrawImage.apply(this, args);
    };
  });

  await page.goto('/settings');
  await page.getByTestId('toggle-gemini').click();
  await expect(page.getByTestId('toggle-gemini')).toHaveAttribute('aria-checked', 'true');
  await page.goto('/');
  await page.getByTestId('button-start-capture').click();
  await page.getByTestId('button-calibrate-chat').click();
  await page.getByTestId('button-save-calibration').click();
}

async function queueOcr(page: Page, result: InjectedOcr) {
  await page.evaluate((next) => {
    (window as Window & { __avakinTestOcrQueue?: InjectedOcr[] }).__avakinTestOcrQueue?.push(next);
    (window as Window & { __changeCaptureFrame?: () => void }).__changeCaptureFrame?.();
  }, result);
}

const suggestionsFor = (message: string) => ({
  suggestions: [
    { text: `متوازن ${message}`, style: 'متوازن' },
    { text: `مباشر ${message}`, style: 'مباشر' },
    { text: `خفيف ${message}`, style: 'خفيف' },
  ],
});

test('saves every new message in one scan and requests one latest-context reply group', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/gemini/generate-replies', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(suggestionsFor('ابي اقولج شي')),
    });
  });
  await prepareLiveCapture(page);
  await queueOcr(page, {
    rawText: 'Ahmed: وينج\nAhmed: تعالي عندي\nAhmed: ابي اقولج شي',
    text: 'Ahmed: وينج Ahmed: تعالي عندي Ahmed: ابي اقولج شي',
    confidence: 91,
    variant: 'test-high-confidence',
  });

  await expect(page.getByTestId('text-carousel-source-message')).toHaveText('ابي اقولج شي');
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].newMessages).toHaveLength(3);
  expect(JSON.stringify(requests[0].newMessages)).toContain('وينج');
  expect(JSON.stringify(requests[0].newMessages)).toContain('ابي اقولج شي');
  expect(requests[0].message).toBe('ابي اقولج شي');

  await page.waitForTimeout(2_200);
  expect(requests).toHaveLength(1);
});

test('a newer changed frame aborts stale generation and the latest reply wins', async ({ page }) => {
  let requestCount = 0;
  await page.route('**/api/gemini/generate-replies', async (route) => {
    requestCount += 1;
    const body = route.request().postDataJSON() as { message: string };
    if (requestCount === 1) await new Promise((resolve) => setTimeout(resolve, 4_000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(suggestionsFor(body.message)),
    }).catch(() => undefined);
  });
  await prepareLiveCapture(page);
  await queueOcr(page, { rawText: 'Ahmed: وينج', text: 'Ahmed: وينج', confidence: 90 });
  await expect.poll(() => requestCount, { timeout: 6_000 }).toBe(1);

  await queueOcr(page, {
    rawText: 'Ahmed: وينج\nAhmed: لقيتج خلاص',
    text: 'Ahmed: وينج Ahmed: لقيتج خلاص',
    confidence: 92,
  });
  await expect.poll(() => requestCount, { timeout: 7_000 }).toBe(2);
  await expect(page.getByTestId('text-carousel-source-message')).toHaveText('لقيتج خلاص', { timeout: 6_000 });
  await expect(page.getByText(/لقيتج خلاص/).first()).toBeVisible();
});

test('low-confidence Arabic uses only the cropped image and consumes Vision transcription plus replies', async ({ page }) => {
  let requestBody: Record<string, unknown> | undefined;
  await page.route('**/api/gemini/generate-replies', async (route) => {
    requestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...suggestionsFor('وينج'),
        targetPlayer: 'Ahmed',
        detectedMessages: [{ speaker: 'Ahmed', text: 'وينج', isNew: true, confidence: 0.96 }],
      }),
    });
  });
  await prepareLiveCapture(page);
  await queueOcr(page, { rawText: 'Ahrned: و ى ن ح', text: 'Ahrned و ى ن ح', confidence: 22, variant: 'test-low-confidence' });

  await expect(page.getByTestId('text-carousel-source-message')).toHaveText('وينج');
  expect(String(requestBody?.cropImageDataUrl)).toMatch(/^data:image\/jpeg;base64,/);
  expect(requestBody?.localOcrConfidence).toBe(22);
  expect(requestBody?.newMessages).toEqual([]);
});