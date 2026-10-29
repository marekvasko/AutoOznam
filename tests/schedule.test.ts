import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app';
import { createStorage, type Storage } from '../server/storage';
import { nextSunday, addDays, parishDate } from '../shared/schedule';
import { parseEvent } from '../server/event';
import { weeklyReport, reportText } from '../server/report';
import {
  measureText,
  type AIResult,
  type WriteAnnouncement,
} from '../shared/contracts';
const token = 'a'.repeat(64);
const result: AIResult = {
  what: { present: true, detail: 'Stretnutie' },
  where: { present: true, detail: 'Kostol' },
  when: { present: true, detail: 'Termín' },
  suggestion: null,
  extracted: {
    title: 'Stretnutie',
    location: 'Kostol',
    date: '2026-11-03',
    time: '18:00',
    dateInferred: true,
    source: 'v utorok o 18:00',
  },
};
const stores: Storage[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  vi.unstubAllEnvs();
});
function setup() {
  const storage = createStorage(':memory:');
  stores.push(storage);
  const analyze = vi.fn().mockResolvedValue(result);
  return { storage, analyze, app: createApp(storage, analyze) };
}
const body = (extra: Partial<WriteAnnouncement> = {}): WriteAnnouncement => ({
  id: randomUUID(),
  requestId: randomUUID(),
  baseRevision: 0,
  text: 'Stretneme sa v utorok o 18:00 pri kostole.',
  name: 'Mária',
  contact: 'maria@example.sk',
  publishOn: ['2026-11-01'],
  eventOverride: null,
  ...extra,
});
const post = (
  app: ReturnType<typeof createApp>,
  value: ReturnType<typeof body>,
) =>
  request(app)
    .post('/api/announcements')
    .auth(token, { type: 'bearer' })
    .send(value);
describe('Výber nedele a ručný termín', () => {
  it('počítanie nedele zahŕňa dnešnú nedeľu, prechod roka aj slovenské pásmo', () => {
    expect(nextSunday('2026-11-01')).toBe('2026-11-01');
    expect(nextSunday('2026-12-31')).toBe('2027-01-03');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(parishDate(new Date('2026-10-29T23:30:00Z'))).toBe('2026-10-30');
  });
  it('uloží obe nedele, bez duplicít a odovzdá modelu prvú ako referenciu', async () => {
    const { app, analyze } = setup();
    const value = body({
      publishOn: ['2026-11-08', '2026-11-01', '2026-11-01'],
    });
    const response = await post(app, value).expect(201);
    expect(response.body.publishOn).toEqual(['2026-11-01', '2026-11-08']);
    expect(analyze).toHaveBeenCalledWith(value.text, '2026-11-01');
  });
  it('odmietne prázdny výber alebo dátum mimo nedele', async () => {
    const { app, analyze } = setup();
    await post(app, body({ publishOn: [] })).expect(400);
    await post(app, body({ publishOn: ['2026-11-02'] })).expect(400);
    expect(analyze).not.toHaveBeenCalled();
  });
  it('ručný termín má prednosť pred AI a zostane zachovaný pri ďalšej úprave', async () => {
    const { app, storage } = setup();
    const value = body({
      eventOverride: { date: '2026-12-24', time: '22:00' },
    });
    const response = await post(app, value).expect(201);
    expect(response.body.analysis.extracted).toMatchObject({
      date: '2026-12-24',
      time: '22:00',
      startsAt: '2026-12-24T21:00:00Z',
      dateInferred: false,
    });
    const next = {
      ...value,
      requestId: randomUUID(),
      baseRevision: 1,
      text: value.text + ' Príď.',
    };
    const { eventOverride: _unusedOverride, ...withoutOverride } = next;
    await post(app, withoutOverride).expect(200);
    expect(storage.get(value.id, token).eventOverride).toEqual({
      date: '2026-12-24',
      time: '22:00',
    });
  });
  it('zrušenie ručného termínu opäť použije extrakciu a nezmení ID', async () => {
    const { app } = setup();
    const value = body({
      eventOverride: { date: '2026-12-24', time: '22:00' },
    });
    await post(app, value).expect(201);
    const response = await post(app, {
      ...value,
      eventOverride: null,
      baseRevision: 1,
      requestId: randomUUID(),
    }).expect(200);
    expect(response.body.id).toBe(value.id);
    expect(response.body.analysis.extracted.date).toBe('2026-11-03');
  });
  it('rovnaké requestId nedovolí podsunúť iný rozvrh', async () => {
    const { app } = setup();
    const value = body();
    await post(app, value).expect(201);
    await post(app, { ...value, publishOn: ['2026-11-08'] }).expect(409);
  });
  it('ručný termín sa uloží aj pri výpadku AI', async () => {
    const { app, storage, analyze } = setup();
    analyze.mockRejectedValue(new Error('offline'));
    const value = body({ eventOverride: { date: '2026-12-24', time: null } });
    await post(app, value).expect(201);
    const report = weeklyReport(storage.reportRows(), '2026-11-01');
    expect(report.futureEvents[0]).toMatchObject({
      id: value.id,
      date: '2026-12-24',
      manualDate: true,
      status: 'review_failed',
    });
  });
  it('neplatný ručný dátum odmietne a nejednoznačný DST čas označí', async () => {
    const { app } = setup();
    await post(
      app,
      body({ eventOverride: { date: '2026-02-30', time: '10:00' } }),
    ).expect(400);
    const response = await post(
      app,
      body({ eventOverride: { date: '2027-10-31', time: '02:30' } }),
    ).expect(201);
    expect(response.body.status).toBe('needs_changes');
    expect(response.body.analysis.extracted.startsAt).toBeNull();
  });
});
describe('Týždenný prehľad', () => {
  it('rozdelí vybranú nedeľu, pondelok až nedeľu, neskoršie a neurčené udalosti bez minulých', () => {
    const { storage } = setup();
    const dates = [
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-08',
      '2026-11-09',
      null,
    ];
    const ids = dates.map((date, i) => {
      const value = body({
        publishOn: i === 0 ? ['2026-11-08'] : ['2026-11-01'],
      });
      storage.save(value, token);
      storage.finish(
        value.id,
        1,
        {
          ...result,
          extracted: parseEvent({ ...result.extracted, date }),
          metrics: measureText(value.text),
        },
        null,
      );
      return value.id;
    });
    const report = weeklyReport(storage.reportRows(), '2026-11-01');
    expect(report.weekStart).toBe('2026-11-02');
    expect(report.weekEnd).toBe('2026-11-08');
    expect(report.announcements.map((i) => i.id)).not.toContain(ids[0]);
    expect(report.weekEvents.map((i) => i.id)).toEqual([ids[2], ids[3]]);
    expect(report.futureEvents.map((i) => i.id)).toEqual([ids[4]]);
    expect(report.undated.map((i) => i.id)).toEqual([ids[5]]);
    expect(reportText(report)).not.toContain('maria@example.sk');
  });
  it('verejne poskytne TXT aj JSON a odmietne nenedeľu', async () => {
    const { app } = setup();
    await post(app, body()).expect(201);
    await request(app).get('/api/reports/weekly?sunday=2026-11-02').expect(400);
    const response = await request(app)
      .get('/api/reports/weekly?sunday=2026-11-01')
      .expect(200);
    expect(response.body.announcements).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain('maria@example.sk');
    const txt = await request(app)
      .get('/api/reports/weekly?sunday=2026-11-01&format=txt')
      .expect(200);
    expect(txt.headers['content-type']).toContain('text/plain');
    expect(txt.text).toContain('Nasledujúci týždeň');
    expect(txt.headers['content-disposition']).toContain(
      'oznamy-2026-11-01.txt',
    );
  });
});
