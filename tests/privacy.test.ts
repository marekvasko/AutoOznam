import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createApp } from '../server/app';
import { createStorage, type Storage } from '../server/storage';
import type { AIResult } from '../shared/contracts';
const review: AIResult = {
  what: { present: true, detail: 'Brigáda' },
  where: { present: true, detail: 'Kostol' },
  when: { present: true, detail: '7. novembra o 9:00' },
  suggestion: null,
  extracted: {
    title: 'Brigáda',
    location: 'Kostol',
    date: '2026-11-07',
    time: '09:00',
    dateInferred: false,
    source: '7. novembra o 9:00',
  },
};
const stores: Storage[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));
const input = (contact: string) => ({
  id: randomUUID(),
  requestId: randomUUID(),
  baseRevision: 0,
  text: 'Brigáda 7. novembra o 9:00 v záhrade pri kostole.',
  name: 'Mária',
  contact,
  publishOn: ['2026-11-01'],
});
function assertPrivate(body: unknown, ...secrets: string[]) {
  const encoded = typeof body === 'string' ? body : JSON.stringify(body);
  for (const secret of secrets) expect(encoded).not.toContain(secret);
  if (typeof body === 'object' && body !== null) {
    for (const [key, value] of Object.entries(body)) {
      expect(key).not.toMatch(/^(?:original_)?contact$/i);
      if (value && typeof value === 'object') assertPrivate(value, ...secrets);
    }
  }
}
describe('Kontakt dostupný iba z databázy', () => {
  it.each(['private.person+hidden@example.sk', '+421 905 987 654'])(
    'nevráti kontakt %s cez vytvorenie, načítanie, úpravy ani export',
    async (secret) => {
      const storage = createStorage(':memory:');
      stores.push(storage);
      const app = createApp(storage, async () => review);
      const body = input(secret);
      const created = await request(app)
        .post('/api/announcements')
        .send(body)
        .expect(201);
      assertPrivate(created.body, secret);
      expect(storage.get(body.id).contact).toBe(secret);
      const loaded = await request(app)
        .get(`/api/announcements/${body.id}`)
        .expect(200);
      assertPrivate(loaded.body, secret);
      const { contact: _privateContact, ...withoutContact } = body;
      const edit = {
        ...withoutContact,
        baseRevision: 1,
        requestId: randomUUID(),
        text: body.text + ' Príď.',
      };
      const changed = await request(app)
        .post('/api/announcements')
        .send(edit)
        .expect(200);
      assertPrivate(changed.body, secret);
      expect(storage.get(body.id).contact).toBe(secret);
      const retry = await request(app)
        .post('/api/announcements')
        .send(edit)
        .expect(200);
      assertPrivate(retry.body, secret);
      expect(retry.body.revision).toBe(2);
      const date = await request(app)
        .patch(`/api/announcements/${body.id}/event`)
        .send({
          requestId: randomUUID(),
          baseRevision: 2,
          eventOverride: { date: '2026-12-24', time: '22:00' },
        })
        .expect(200);
      assertPrivate(date.body, secret);
      expect(storage.get(body.id).contact).toBe(secret);
      for (const format of ['json', 'txt']) {
        const response = await request(app)
          .get(`/api/reports/weekly?sunday=2026-11-01&format=${format}`)
          .expect(200);
        assertPrivate(format === 'txt' ? response.text : response.body, secret);
      }
      const updatedContact = 'new.private.person@example.sk';
      const updated = await request(app)
        .post('/api/announcements')
        .send({
          ...withoutContact,
          contact: updatedContact,
          baseRevision: 3,
          requestId: randomUUID(),
        })
        .expect(200);
      assertPrivate(updated.body, secret, updatedContact);
      expect(storage.get(body.id).contact).toBe(updatedContact);
      const final = await request(app)
        .get(`/api/announcements/${body.id}`)
        .expect(200);
      assertPrivate(final.body, secret, updatedContact);
    },
  );
  it('kontakt je povinný pri novom ozname, neprítomnosť pri úprave ho nevymaže', async () => {
    const storage = createStorage(':memory:');
    stores.push(storage);
    const app = createApp(storage, async () => review);
    const { contact: _unused, ...body } = input('private@example.sk');
    await request(app).post('/api/announcements').send(body).expect(400);
    expect(() => storage.get(body.id)).toThrow();
  });
  it('lokálny export neobsahuje aktuálny ani pôvodný kontakt z histórie', () => {
    const directory = mkdtempSync(join(tmpdir(), 'autooznam-private-'));
    try {
      const path = join(directory, 'db.sqlite');
      const storage = createStorage(path);
      const body = input('private.original@example.sk');
      try {
        storage.save(body);
        storage.save({
          ...body,
          contact: 'private.updated@example.sk',
          requestId: randomUUID(),
          baseRevision: 1,
        });
      } finally {
        storage.close();
      }
      const destination = join(directory, 'export.json');
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'server/export.ts', destination],
        { env: { ...process.env, DATABASE_PATH: path }, stdio: 'pipe' },
      );
      const output = JSON.parse(readFileSync(destination, 'utf8'));
      assertPrivate(
        output,
        'private.original@example.sk',
        'private.updated@example.sk',
      );
      expect(output[0].versions).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
