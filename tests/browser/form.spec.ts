import { test, expect, type Page } from '@playwright/test';
import { parseEvent } from '../../server/event';
import {
  measureText,
  type WriteAnnouncement,
  type SavedAnnouncement,
} from '../../shared/contracts';
const analysis = {
  what: { present: true, detail: 'Brigáda' },
  where: { present: true, detail: 'Záhrada pri kostole' },
  when: { present: true, detail: 'V sobotu o 9:00' },
  suggestion: null,
  extracted: {
    title: 'Farská brigáda',
    location: 'Záhrada pri kostole',
    date: '2026-11-07',
    time: '09:00',
    dateInferred: true,
    source: 'v sobotu 7. novembra o 9:00',
    timeZone: 'Europe/Bratislava' as const,
    startsAt: '2026-11-07T08:00:00Z',
    timingIssue: null,
  },
};
async function mockApi(
  page: Page,
  options: {
    missing?: boolean;
    missingDate?: boolean;
    failed?: boolean;
    long?: boolean;
    loseFirstResponse?: boolean;
    loseFirstDateResponse?: boolean;
  } = {},
) {
  const requests: WriteAnnouncement[] = [];
  const datePatches: Array<{
    requestId: string;
    baseRevision: number;
    eventOverride: { date: string | null; time: string | null };
  }> = [];
  const dateResults = new Map<string, SavedAnnouncement>();
  const records = new Map<string, SavedAnnouncement>();
  const results = new Map<string, SavedAnnouncement>();
  await page.route('**/api/announcements**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      const row = records.get(req.url().split('/').pop()!);
      await route.fulfill({
        status: row ? 200 : 404,
        json: row || { error: 'Oznam sa nenašiel.' },
      });
      return;
    }
    if (req.method() === 'PATCH') {
      const patch = req.postDataJSON() as (typeof datePatches)[number];
      datePatches.push(patch);
      const id = req.url().split('/').at(-2)!;
      const previous = records.get(id)!;
      const result: SavedAnnouncement = dateResults.get(patch.requestId) || {
        ...previous,
        revision: previous.revision + 1,
        eventOverride: patch.eventOverride,
        analysis: previous.analysis
          ? {
              ...previous.analysis,
              extracted: parseEvent({
                ...previous.analysis.extracted!,
                ...patch.eventOverride,
                dateInferred: false,
              }),
            }
          : null,
      };
      records.set(id, result);
      dateResults.set(patch.requestId, result);
      if (options.loseFirstDateResponse && datePatches.length === 1) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({ json: result });
      return;
    }
    const body = req.postDataJSON() as WriteAnnouncement;
    requests.push(body);
    const result: SavedAnnouncement = results.get(body.requestId) || {
      publishOn: body.publishOn || [],
      eventOverride: body.eventOverride ?? null,
      id: body.id,
      text: body.text,
      revision: body.baseRevision + 1,
      status: options.failed
        ? 'review_failed'
        : options.missing || options.missingDate || options.long
          ? 'needs_changes'
          : 'pending',
      reviewError: options.failed
        ? 'Kontrola je nedostupná. Oznam je uložený.'
        : null,
      analysis: options.failed
        ? null
        : {
            ...analysis,
            when: options.missingDate
              ? { present: false, detail: 'Doplň dátum udalosti.' }
              : analysis.when,
            extracted: options.missingDate
              ? {
                  ...analysis.extracted,
                  date: null,
                  startsAt: null,
                  dateInferred: false,
                  source: 'o 9:00',
                }
              : analysis.extracted,
            where: options.missing
              ? { present: false, detail: 'Doplň konkrétne miesto.' }
              : analysis.where,
            suggestion: options.long
              ? 'Pozývame vás na brigádu pri kostole v sobotu o 9:00. Prineste si rukavice.'
              : null,
            metrics: measureText(body.text),
          },
    };
    records.set(body.id, result);
    results.set(body.requestId, result);
    if (options.loseFirstResponse && requests.length === 1) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      status: body.baseRevision ? 200 : 201,
      json: result,
    });
  });
  return { requests, records, datePatches };
}
async function fill(page: Page) {
  await page.getByRole('button', { name: 'Vyskúšaj príklad' }).click();
  await page.getByLabel('Tvoje meno').fill('Mária Nováková');
  await page.getByLabel('E-mail alebo telefón').fill('maria@example.sk');
}
test('jedno tlačidlo uloží oznam s kontaktom a zobrazí kontrolu', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto('/');
  await fill(page);
  await expect(
    page.getByRole('button', { name: 'Skontrolovať oznam' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  await expect(page.getByText('Oznam je kompletný.')).toBeVisible();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0]).toMatchObject({
    name: 'Mária Nováková',
    contact: 'maria@example.sk',
    baseRevision: 0,
  });
  expect(page.url()).toContain('#edit=');
  await expect(page.getByText('Farská brigáda', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Záhrada pri kostole', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute(
    'datetime',
    '2026-11-07T08:00:00Z',
  );
  await expect(page.getByText('odvodený dátum')).toBeVisible();
});
test('neúplný oznam je uložený a ďalšie odoslanie upraví rovnaký záznam', async ({
  page,
}) => {
  const state = await mockApi(page, { missing: true });
  await page.goto('/');
  await fill(page);
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(page.getByText('Doplň konkrétne miesto.')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  await page
    .getByLabel('Oznam', { exact: true })
    .fill('Brigáda v záhrade pri kostole v sobotu o 9:00.');
  await page.getByRole('button', { name: 'Ulož zmeny' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  expect(state.requests).toHaveLength(2);
  expect(state.requests[1].id).toBe(state.requests[0].id);
  expect(state.requests[1].baseRevision).toBe(1);
  expect(state.records.size).toBe(1);
});
test('obnovenie stránky načíta oznam bez kontaktu a umožní ďalšiu úpravu', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto('/');
  await fill(page);
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  const link = page.url();
  await page.reload();
  await expect(page.getByRole('form', { name: 'Farský oznam' })).toBeVisible();
  await expect(page.getByLabel('Tvoje meno')).toHaveValue('Anonymné');
  await expect(page.getByLabel('E-mail alebo telefón')).toHaveValue('Anonymné');
  await expect(page.getByLabel('Tvoje meno')).toBeDisabled();
  await expect(page.getByLabel('E-mail alebo telefón')).toBeDisabled();
  await expect(page.getByText('Oznam je kompletný.')).toBeVisible();
  expect(page.url()).toBe(link);
  await page
    .getByLabel('Oznam', { exact: true })
    .fill('Brigáda pri kostole v sobotu o 9:00.');
  await page.getByRole('button', { name: 'Ulož zmeny' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  expect(state.requests[1]).not.toHaveProperty('contact');
  expect(state.requests[1]).not.toHaveProperty('name');
});
test('odkaz na oznam funguje aj v inom prehliadači bez pôvodnej relácie', async ({
  page,
  browser,
}) => {
  const state = await mockApi(page);
  await page.goto('/');
  await fill(page);
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  const editLink = page.locator('.edit-link');
  await expect(editLink).toBeVisible();
  const editUrl = await editLink.getAttribute('href');
  const context = await browser.newContext();
  try {
    const other = await context.newPage();
    await other.route('**/api/announcements/*', (route) =>
      route.fulfill({ json: [...state.records.values()][0] }),
    );
    await other.goto(editUrl!);
    await expect(other.getByLabel('Tvoje meno')).toHaveValue('Anonymné');
    await expect(
      other.getByRole('button', { name: 'Ulož zmeny' }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
test('výpadok AI nebráni uloženiu ani ďalšej úprave', async ({ page }) => {
  const state = await mockApi(page, { failed: true });
  await page.goto('/');
  await fill(page);
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  await expect(
    page.getByText('Kontrola je nedostupná. Oznam je uložený.'),
  ).toBeVisible();
  expect(state.records.size).toBe(1);
  await expect(page.getByRole('button', { name: 'Ulož zmeny' })).toBeEnabled();
});
test('po strate odpovede opakuje rovnakú požiadavku bez duplicity', async ({
  page,
}) => {
  const state = await mockApi(page, { loseFirstResponse: true });
  await page.goto('/');
  await fill(page);
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  expect(state.requests[0].requestId).toBe(state.requests[1].requestId);
  expect(state.records.size).toBe(1);
});
test('skrátený návrh uloží ako ďalšiu verziu a nový oznam dostane nové ID', async ({
  page,
}) => {
  const state = await mockApi(page, { long: true });
  await page.goto('/');
  await fill(page);
  await page.getByRole('button', { name: 'Dlhý príklad' }).click();
  expect(
    measureText(await page.getByLabel('Oznam', { exact: true }).inputValue())
      .words,
  ).toBeGreaterThan(80);
  await expect(
    page.getByText('Oznam je príliš dlhý.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(
    page.getByRole('heading', { name: 'Návrh skrátenia' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Použi tento návrh' }).click();
  await page.getByRole('button', { name: 'Ulož zmeny' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  expect(state.requests[1].id).toBe(state.requests[0].id);
  await page.getByRole('button', { name: 'Pridaj ďalší oznam' }).click();
  await fill(page);
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(page.getByRole('status')).toHaveText('Oznam je uložený.');
  expect(state.requests[2].id).not.toBe(state.requests[0].id);
});
test('bez rozpoznaného dátumu ponúkne doplnenie textu a skryje úpravu termínu', async ({
  page,
}) => {
  const state = await mockApi(page, { missingDate: true });
  await page.goto('/');
  await fill(page);
  await page
    .getByLabel('Oznam', { exact: true })
    .fill('Pozývame vás na farskú brigádu o 9:00 v záhrade pri kostole.');
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await expect(
    page.getByText('Doplň dátum udalosti.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Uprav', exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('input[type=date], input[type=time]')).toHaveCount(
    0,
  );
  expect(state.records.size).toBe(1);
});
test('termín sa upraví priamo pri Kedy a automaticky uloží bez druhého odoslania', async ({
  page,
}) => {
  const state = await mockApi(page);
  await page.goto('/');
  await fill(page);
  await expect(page.locator('input[type=date], input[type=time]')).toHaveCount(
    0,
  );
  await page.getByRole('checkbox', { name: /Budúcu nedeľu/ }).check();
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await page.getByRole('button', { name: 'Uprav', exact: true }).click();
  await expect(page.getByLabel('Dátum', { exact: true })).toHaveValue(
    '2026-11-07',
  );
  await page.getByLabel('Dátum', { exact: true }).fill('2026-12-24');
  await page.getByLabel('Čas', { exact: true }).fill('22:00');
  await expect(page.locator('.date-save-status')).toHaveText('Uložené');
  expect(state.requests).toHaveLength(1);
  expect(state.datePatches).toHaveLength(1);
  expect(state.datePatches[0].eventOverride).toEqual({
    date: '2026-12-24',
    time: '22:00',
  });
  const record = [...state.records.values()][0];
  expect(record.revision).toBe(2);
  expect(record.publishOn).toHaveLength(2);
  await expect(page.locator('time')).toHaveAttribute(
    'datetime',
    '2026-12-24T21:00:00Z',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Uprav', exact: true }).click();
  await expect(page.getByLabel('Dátum', { exact: true })).toHaveValue(
    '2026-12-24',
  );
  await expect(page.getByLabel('Čas', { exact: true })).toHaveValue('22:00');
});
test('pri strate odpovede termín neoznačí za uložený a opakuje rovnakú požiadavku', async ({
  page,
}) => {
  const state = await mockApi(page, { loseFirstDateResponse: true });
  await page.goto('/');
  await fill(page);
  await page.getByRole('button', { name: 'Odošli oznam' }).click();
  await page.getByRole('button', { name: 'Uprav', exact: true }).click();
  await page.getByLabel('Dátum', { exact: true }).fill('2026-12-24');
  await expect(page.locator('.date-save-status')).toHaveText('Neuložené');
  await page.getByRole('button', { name: 'Skús uložiť znova' }).click();
  await expect(page.locator('.date-save-status')).toHaveText('Uložené');
  expect(state.datePatches[0].requestId).toBe(state.datePatches[1].requestId);
  expect([...state.records.values()][0].revision).toBe(2);
  expect(state.requests).toHaveLength(1);
});
test('mobilný formulár nemá pretekanie ani chyby v konzole', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Odošli oznam' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});
