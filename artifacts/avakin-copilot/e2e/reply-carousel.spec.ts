import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/gemini/generate-replies', async (route) => {
    const request = route.request().postDataJSON() as { message: string };
    await new Promise((resolve) => setTimeout(resolve, request.message.includes('سالفة مهمة') ? 250 : 20));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggestions: [
          { text: `متوازن: ${request.message}`, style: 'متوازن' },
          { text: `مباشر: ${request.message}`, style: 'مباشر' },
          { text: `خفيف: ${request.message}`, style: 'خفيف' },
        ],
      }),
    });
  });
  await page.goto('/settings');
  await expect(page.getByTestId('toggle-gemini')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('toggle-gemini').click();
  await expect(page.getByTestId('toggle-gemini')).toHaveAttribute('aria-checked', 'true');
  await page.waitForTimeout(100);
  await page.goto('/');
});

async function addMessage(page: import('@playwright/test').Page, text: string) {
  await page.getByTestId('input-manual-speaker').fill('لاعب حقيقي');
  await page.getByTestId('input-manual-message').fill(text);
  await page.getByTestId('button-add-manual-message').click();
  await expect(page.getByTestId('text-carousel-source-message')).toHaveText(text);
}

test('keeps old reply groups visible and does not force a jump while browsing history', async ({ page }) => {
  await addMessage(page, 'وينكم اليوم');
  await addMessage(page, 'خلونا نروح للمكان الثاني');

  await page.getByTestId('button-carousel-previous').click();
  const olderMessage = await page.getByTestId('text-carousel-source-message').innerText();
  await expect(page.getByTestId('reply-carousel')).toHaveAttribute('data-follow-latest', 'false');

  await page.getByTestId('input-manual-speaker').fill('لاعب حقيقي');
  await page.getByTestId('input-manual-message').fill('عندي سالفة مهمة');
  await page.getByTestId('button-add-manual-message').click();

  await expect(page.getByTestId('reply-carousel')).toHaveAttribute('data-follow-latest', 'false');
  await expect(page.getByTestId('text-carousel-source-message')).toHaveText(olderMessage);
  await expect(page.getByTestId('badge-new-replies')).toBeVisible();
  await page.getByTestId('button-carousel-latest').click();
  await expect(page.getByTestId('text-carousel-source-message')).toHaveText('عندي سالفة مهمة');
  await expect(page.getByTestId('text-carousel-counter')).toContainText('من');
});