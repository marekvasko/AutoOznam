import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createStorage } from '../server/storage';
import { parseEvent } from '../server/event';
import { measureText } from '../shared/contracts';
it('migruje pôvodnú databázu bez straty dát, zachová históriu a reláciu po reštarte', () => {
  const directory = mkdtempSync(join(tmpdir(), 'autooznam-test-'));
  const file = join(directory, 'db.sqlite');
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(
      `CREATE TABLE announcements (id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE, text TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL, review TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT '2026-10-29'); INSERT INTO announcements VALUES ('old', 'old-review', 'Pôvodný oznam.', 'Pôvodný autor', 'old@example.sk', 'null', 'pending', '2026-10-29');`,
    );
    legacy.close();
    let storage = createStorage(file);
    const value = {
      id: randomUUID(),
      requestId: randomUUID(),
      baseRevision: 0,
      text: 'Nový oznam pri kostole.',
      name: 'Mária',
      contact: 'maria@example.sk',
    };
    const token = 'a'.repeat(64);
    storage.save(value, token);
    storage.close();
    storage = createStorage(file);
    expect(storage.get(value.id, token)).toMatchObject({
      text: value.text,
      revision: 1,
    });
    storage.save(
      {
        ...value,
        baseRevision: 1,
        requestId: randomUUID(),
        name: 'Upravené meno',
        contact: 'new@example.sk',
      },
      token,
    );
    const extracted = parseEvent({
      title: 'Brigáda',
      location: 'Kostol',
      date: '2026-11-07',
      time: '09:00',
      source: '7. novembra o 9:00',
      dateInferred: true,
    });
    storage.finish(
      value.id,
      2,
      {
        what: { present: true, detail: 'Brigáda' },
        where: { present: true, detail: 'Kostol' },
        when: { present: true, detail: '7. novembra o 9:00' },
        suggestion: null,
        extracted,
        metrics: measureText(value.text),
      },
      null,
    );
    storage.close();
    storage = createStorage(file);
    expect(storage.get(value.id, token).analysis?.extracted).toMatchObject({
      title: 'Brigáda',
      startsAt: '2026-11-07T08:00:00Z',
    });
    storage.close();
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      expect(
        db.prepare('SELECT text FROM announcements WHERE id = ?').get('old')
          ?.text,
      ).toBe('Pôvodný oznam.');
      const author = db
        .prepare(
          'SELECT original_name, original_contact FROM announcements WHERE id = ?',
        )
        .get(value.id);
      expect(author).toMatchObject({
        original_name: 'Mária',
        original_contact: 'maria@example.sk',
      });
      expect(
        db
          .prepare(
            'SELECT event_title, event_date, event_time, event_starts_at_ms, typeof(event_starts_at_ms) as storage_type FROM announcements WHERE id = ?',
          )
          .get(value.id),
      ).toMatchObject({
        event_title: 'Brigáda',
        event_date: '2026-11-07',
        event_time: '09:00',
        event_starts_at_ms: Date.parse('2026-11-07T08:00:00Z'),
        storage_type: 'integer',
      });
      expect(
        db
          .prepare(
            'SELECT event_starts_at_ms FROM announcement_versions WHERE announcement_id = ? AND revision = 2',
          )
          .get(value.id)?.event_starts_at_ms,
      ).toBe(Date.parse('2026-11-07T08:00:00Z'));
      const history = db
        .prepare(
          'SELECT revision, name FROM announcement_versions WHERE announcement_id = ? ORDER BY revision',
        )
        .all(value.id);
      expect(history).toMatchObject([
        { revision: 1, name: 'Mária' },
        { revision: 2, name: 'Upravené meno' },
      ]);
      expect(
        db.prepare('SELECT COUNT(*) as count FROM announcements').get()?.count,
      ).toBe(2);
      expect(
        db
          .prepare(
            'SELECT COUNT(*) as count FROM announcement_versions WHERE announcement_id = ?',
          )
          .get('old')?.count,
      ).toBe(1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
