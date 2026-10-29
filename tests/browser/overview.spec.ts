import { test, expect } from '@playwright/test';
test('verejný prehľad ponúka týždenné sekcie, úpravu oznamu a stiahnutie TXT', async ({
  page,
}) => {
  const item = {
    id: '6138fe25-f8b8-48c7-8c5e-273f857e5e80',
    title: 'Farská brigáda',
    text: 'Brigáda v sobotu o 9:00 v záhrade.',
    location: 'Farská záhrada',
    date: '2026-11-07',
    time: '09:00',
    status: 'pending',
    revision: 1,
    publishOn: ['2026-11-01'],
    manualDate: false,
    timingIssue: null,
  };
  await page.route('**/api/reports/weekly**', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill(
      url.searchParams.get('format') === 'txt'
        ? {
            contentType: 'text/plain',
            body: 'Oznamy na nedeľu\nFarská brigáda',
          }
        : {
            json: {
              sunday: '2026-11-01',
              weekStart: '2026-11-02',
              weekEnd: '2026-11-08',
              announcements: [item],
              weekEvents: [item],
              futureEvents: [],
              undated: [],
            },
          },
    );
  });
  await page.goto('/prehlad');
  await expect(page.getByLabel('Prístupový kľúč')).toHaveCount(0);
  await page.getByLabel('Nedeľa zverejnenia').fill('2026-11-01');
  await page.getByRole('button', { name: 'Zobraz prehľad' }).click();
  await expect(
    page.getByRole('heading', { name: /Nasledujúci týždeň/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: /Neskoršie udalosti/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Uprav oznam' }).first(),
  ).toHaveAttribute('href', `/#edit=${item.id}`);
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Stiahni TXT' }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('oznamy-2026-11-01.txt');
});
