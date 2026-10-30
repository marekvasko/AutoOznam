import type Database from 'better-sqlite3';
import { nextSunday, parishDate } from '../../shared/schedule.js';

// One-time adoption of databases created before versioned ORM migrations.
// Historical SQL stays isolated here; regular repositories use Drizzle.
export function upgradeLegacyDatabase(db: Database.Database) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE, text TEXT NOT NULL,
    name TEXT NOT NULL, contact TEXT NOT NULL, review TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
    const columns = new Set(
      (
        db.prepare('PRAGMA table_info(announcements)').all() as {
          name: string;
        }[]
      ).map((c) => c.name),
    );
    const scheduleColumns = {
      publication_dates: "TEXT NOT NULL DEFAULT '[]'",
      event_override: "TEXT NOT NULL DEFAULT 'null'",
    };
    const eventColumns = {
      event_title: 'TEXT',
      event_location: 'TEXT',
      event_date: 'TEXT',
      event_time: 'TEXT',
      event_time_zone: 'TEXT',
      event_starts_at_ms: 'INTEGER',
    };
    const additions = {
      ...eventColumns,
      ...scheduleColumns,
      edit_token_hash: 'TEXT',
      revision: 'INTEGER NOT NULL DEFAULT 1',
      updated_at: 'TEXT',
      original_name: 'TEXT',
      original_contact: 'TEXT',
      review_error: 'TEXT',
    };
    for (const [column, type] of Object.entries(additions))
      if (!columns.has(column))
        db.exec(`ALTER TABLE announcements ADD COLUMN ${column} ${type}`);
    db.exec(`UPDATE announcements SET original_name = name, original_contact = contact WHERE original_name IS NULL;
    CREATE TABLE IF NOT EXISTS announcement_versions (
      announcement_id TEXT NOT NULL, revision INTEGER NOT NULL, request_id TEXT NOT NULL UNIQUE,
      text TEXT NOT NULL, name TEXT NOT NULL, contact TEXT NOT NULL,
      review TEXT NOT NULL DEFAULT 'null', status TEXT NOT NULL, review_error TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      PRIMARY KEY (announcement_id, revision)
    );`);
    const versionColumns = new Set(
      (
        db.prepare('PRAGMA table_info(announcement_versions)').all() as {
          name: string;
        }[]
      ).map((c) => c.name),
    );
    for (const [column, type] of Object.entries({
      ...eventColumns,
      ...scheduleColumns,
    }))
      if (!versionColumns.has(column))
        db.exec(
          `ALTER TABLE announcement_versions ADD COLUMN ${column} ${type}`,
        );
    if (!columns.has('publication_dates')) {
      for (const row of db
        .prepare('SELECT id, created_at FROM announcements')
        .all() as { id: string; created_at: string }[]) {
        const date = nextSunday(parishDate(new Date(row.created_at as string)));
        db.prepare(
          'UPDATE announcements SET publication_dates=? WHERE id=?',
        ).run(JSON.stringify([date]), row.id as string);
      }
    }
    if (!versionColumns.has('publication_dates'))
      db.exec(
        'UPDATE announcement_versions SET publication_dates=(SELECT publication_dates FROM announcements WHERE id=announcement_id)',
      );
    // Preserve the pre-migration version of existing announcements, too.
    db.exec(`INSERT OR IGNORE INTO announcement_versions (announcement_id, revision, request_id, text, name, contact, review, status, publication_dates, event_override)
    SELECT id, revision, 'legacy-' || id, text, name, contact, review, status, publication_dates, event_override FROM announcements`);
  }).immediate();
}
