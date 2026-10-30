import { parseEvent } from '../server/event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { createStorage, type Storage } from '../server/storage';
import {
  measureText,
  type AIResult,
  type WriteAnnouncement,
} from '../shared/contracts';
const text =
  'Pozývame vás na brigádu v sobotu o 9:00 v záhrade pri farskom kostole. Prineste si rukavice.';
const complete: AIResult = {
  what: { present: true, detail: 'Brigáda' },
  where: { present: true, detail: 'Farská záhrada' },
  when: { present: true, detail: 'V sobotu o 9:00' },
  suggestion: null,
  extracted: {
    title: 'Farská brigáda',
    location: 'Záhrada pri kostole',
    date: '2026-11-07',
    time: '09:00',
    dateInferred: true,
    source: 'v sobotu 7. novembra o 9:00',
  },
};
const token = 'a'.repeat(64);
const stores: Storage[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
function setup(result = complete) {
  const storage = createStorage(':memory:');
  stores.push(storage);
  const analyze = vi
    .fn<(text: string) => Promise<AIResult>>()
    .mockResolvedValue(result);
  return { app: createApp(storage, analyze), analyze, storage };
}
function payload(
  overrides: Partial<WriteAnnouncement> = {},
): WriteAnnouncement {
  return {
    id: randomUUID(),
    requestId: randomUUID(),
    baseRevision: 0,
    text,
    name: 'Mária Nováková',
    contact: 'maria@example.sk',
    ...overrides,
  };
}
function post(
  app: ReturnType<typeof createApp>,
  body: WriteAnnouncement,
  secret = token,
) {
  return request(app)
    .post('/api/announcements')
    .auth(secret, { type: 'bearer' })
    .send(body);
}
describe('Uloženie a kontrola jedným odoslaním', () => {
  it('uloží obsah a kontakt ešte pred dokončením AI', async () => {
    const { app, storage, analyze } = setup();
    const body = payload();
    analyze.mockImplementation(async (submittedText) => {
      expect(storage.get(body.id, token)).toMatchObject({
        text: submittedText,
        name: body.name,
        contact: body.contact,
        status: 'checking',
        revision: 1,
      });
      return complete;
    });
    const response = await post(app, body).expect(201);
    expect(response.body).toMatchObject({
      id: body.id,
      revision: 1,
      status: 'pending',
    });
    expect(response.body.analysis.extracted).toMatchObject({
      title: 'Farská brigáda',
      date: '2026-11-07',
      time: '09:00',
      startsAt: '2026-11-07T08:00:00Z',
      timeZone: 'Europe/Bratislava',
    });
    expect(analyze).toHaveBeenCalledWith(body.text, expect.any(String));
    expect(JSON.stringify(response.body)).not.toContain(token);
  });
  it('uloží aj neúplný a príliš dlhý oznam', async () => {
    const { app, storage } = setup({
      ...complete,
      where: { present: false, detail: 'Doplň miesto.' },
    });
    const body = payload({ text: text + ' Ďakujeme vám. Tešíme sa na vás.' });
    const response = await post(app, body).expect(201);
    expect(response.body.status).toBe('needs_changes');
    expect(storage.get(body.id, token).analysis?.metrics.tooLong).toBe(true);
  });
  it('neplatný kalendárny dátum označí na upresnenie a oznam zachová', async () => {
    const { app } = setup({
      ...complete,
      extracted: { ...complete.extracted, date: '2026-02-30' },
    });
    const response = await post(app, payload()).expect(201);
    expect(response.body.status).toBe('needs_changes');
    expect(response.body.analysis.extracted).toMatchObject({
      date: null,
      startsAt: null,
      timingIssue: expect.any(String),
    });
  });
  it('výpadok OpenRoutera nezruší uložený oznam ani jeho kontakt', async () => {
    const { app, storage, analyze } = setup();
    analyze.mockRejectedValue(new Error('Private upstream error'));
    const body = payload();
    const response = await post(app, body).expect(201);
    expect(response.body).toMatchObject({
      id: body.id,
      status: 'review_failed',
      revision: 1,
      analysis: null,
    });
    expect(response.body.reviewError).toContain('Oznam je uložený');
    expect(storage.get(body.id, token).contact).toBe(body.contact);
    expect(JSON.stringify(response.body)).not.toContain(
      'Private upstream error',
    );
  });
  it('opakované odoslanie tej istej požiadavky nevytvorí novú verziu', async () => {
    const { app, analyze } = setup();
    const body = payload();
    await post(app, body).expect(201);
    const retry = await post(app, body).expect(201);
    expect(retry.body.revision).toBe(1);
    expect(analyze).toHaveBeenCalledTimes(1);
  });
  it('súbežné opakovanie požiadavky zdieľa jednu AI kontrolu', async () => {
    const { app, analyze, storage } = setup();
    const body = payload();
    let release!: (result: AIResult) => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const result = new Promise<AIResult>((resolve) => {
      release = resolve;
    });
    analyze.mockImplementation(() => {
      started();
      return result;
    });
    const saves = vi.spyOn(storage, 'save');
    const first = post(app, body).then((response) => response);
    await ready;
    const second = post(app, body).then((response) => response);
    try {
      await vi.waitFor(() => expect(saves).toHaveBeenCalledTimes(2));
    } finally {
      release(complete);
    }
    const responses = await Promise.all([first, second]);
    expect(responses.map((r) => r.status)).toEqual([201, 201]);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(responses[1].body.revision).toBe(1);
  });
  it('po zlyhaní zopakuje kontrolu bez novej verzie', async () => {
    const { app, analyze } = setup();
    analyze.mockRejectedValueOnce(new Error('offline'));
    const body = payload();
    await post(app, body).expect(201);
    const retry = await post(app, body).expect(201);
    expect(retry.body).toMatchObject({ revision: 1, status: 'pending' });
  });
  it('úprava aktualizuje rovnaký oznam a vráti ho cez súkromný odkaz', async () => {
    const { app } = setup();
    const body = payload();
    await post(app, body).expect(201);
    const next = payload({
      ...body,
      requestId: randomUUID(),
      baseRevision: 1,
      text: 'Pozývame vás na omšu v nedeľu o 10:00 v kostole.',
    });
    const changed = await post(app, next).expect(200);
    expect(changed.body).toMatchObject({
      id: body.id,
      revision: 2,
      text: next.text,
    });
    const restored = await request(app)
      .get(`/api/announcements/${body.id}`)
      .auth(token, { type: 'bearer' })
      .expect(200);
    expect(restored.body).toEqual(changed.body);
  });
  it('umožní verejné načítanie a úpravu bez prístupového kľúča', async () => {
    const { app } = setup();
    const value = payload();
    await request(app).post('/api/announcements').send(value).expect(201);
    const restored = await request(app)
      .get(`/api/announcements/${value.id}`)
      .expect(200);
    expect(restored.body).not.toHaveProperty('name');
    expect(restored.body).not.toHaveProperty('contact');
    const changed = await request(app)
      .post('/api/announcements')
      .send({
        ...value,
        requestId: randomUUID(),
        baseRevision: 1,
        text: 'Nová podoba oznamu.',
      })
      .expect(200);
    expect(changed.body.revision).toBe(2);
  });
  it('stará karta neprepíše novšiu verziu', async () => {
    const { app, storage } = setup();
    const body = payload();
    await post(app, body).expect(201);
    const next = {
      ...body,
      requestId: randomUUID(),
      baseRevision: 1,
      text: text + ' Ďakujeme.',
    };
    await post(app, next).expect(200);
    await post(app, {
      ...next,
      requestId: randomUUID(),
      text: 'Starý text zo starej karty.',
    }).expect(409);
    expect(storage.get(body.id, token).text).toBe(next.text);
  });
  it('oneskorená AI odpoveď neprepíše kontrolu novšej verzie', async () => {
    const { storage } = setup();
    const body = payload();
    storage.save(body, token);
    storage.save(
      {
        ...body,
        requestId: randomUUID(),
        baseRevision: 1,
        text: 'Nový text oznamu.',
      },
      token,
    );
    storage.finish(
      body.id,
      2,
      {
        ...complete,
        extracted: parseEvent(complete.extracted),
        metrics: measureText('Nový text oznamu.'),
      },
      null,
    );
    storage.finish(body.id, 1, null, 'Stará kontrola zlyhala.');
    expect(storage.get(body.id, token)).toMatchObject({
      revision: 2,
      status: 'pending',
      reviewError: null,
    });
  });
  it('rovnaké requestId neakceptuje s iným obsahom', async () => {
    const { app } = setup();
    const body = payload();
    await post(app, body).expect(201);
    await post(app, { ...body, text: 'Úplne iný oznam.' }).expect(409);
  });
  it('validuje meno, kontakt a vstup ešte pred uložením', async () => {
    const { app, analyze } = setup();
    await post(app, payload({ name: '' })).expect(400);
    await post(app, payload({ contact: 'neplatné' })).expect(400);
    await post(app, payload({ text: 'a'.repeat(6001) })).expect(400);
    await post(app, payload({ text: ' ' })).expect(400);
    expect(analyze).not.toHaveBeenCalled();
    await post(app, payload({ contact: '+421 905 123 456' })).expect(201);
  });
});
describe('Dĺžka slovenského textu', () => {
  it('počíta vety vrátane dátumov a času', () => {
    expect(
      measureText(
        'Stretneme sa v sobotu 7. novembra o 9:00 pri kostole. Prineste si rukavice.',
      ).sentences,
    ).toBe(2);
    expect(measureText('Prvá veta. Druhá veta! Tretia veta?').tooLong).toBe(
      false,
    );
    expect(
      measureText('Prvá veta. Druhá veta! Tretia veta? Štvrtá veta.').tooLong,
    ).toBe(true);
  });
  it('odhalí dlhú jedinú vetu a správne spracuje prázdny text', () => {
    expect(measureText('slovo '.repeat(81)).tooLong).toBe(true);
    expect(measureText('slovo '.repeat(80)).tooLong).toBe(false);
    expect(measureText('')).toEqual({ words: 0, sentences: 0, tooLong: false });
  });
});
