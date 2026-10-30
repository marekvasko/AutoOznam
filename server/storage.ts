import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  Analysis,
  AnnouncementStatus,
  StoredAnnouncement,
  WriteAnnouncement,
} from '../shared/contracts.js';
import { ServiceError } from './openrouter.js';
import { applyEventOverride, parseEvent } from './event.js';
import { nextSunday, parishDate } from '../shared/schedule.js';
export function createStorage(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE, text TEXT NOT NULL,
    name TEXT NOT NULL, contact TEXT NOT NULL, review TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );`);
  const columns = new Set(
    db
      .prepare('PRAGMA table_info(announcements)')
      .all()
      .map((c) => c.name),
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
    db
      .prepare('PRAGMA table_info(announcement_versions)')
      .all()
      .map((c) => c.name),
  );
  for (const [column, type] of Object.entries({
    ...eventColumns,
    ...scheduleColumns,
  }))
    if (!versionColumns.has(column))
      db.exec(`ALTER TABLE announcement_versions ADD COLUMN ${column} ${type}`);
  if (!columns.has('publication_dates')) {
    for (const row of db
      .prepare('SELECT id, created_at FROM announcements')
      .all()) {
      const date = nextSunday(parishDate(new Date(row.created_at as string)));
      db.prepare('UPDATE announcements SET publication_dates=? WHERE id=?').run(
        JSON.stringify([date]),
        row.id as string,
      );
    }
  }
  if (!versionColumns.has('publication_dates'))
    db.exec(
      'UPDATE announcement_versions SET publication_dates=(SELECT publication_dates FROM announcements WHERE id=announcement_id)',
    );
  // Preserve the pre-migration version of existing announcements, too.
  db.exec(`INSERT OR IGNORE INTO announcement_versions (announcement_id, revision, request_id, text, name, contact, review, status, publication_dates, event_override)
    SELECT id, revision, 'legacy-' || id, text, name, contact, review, status, publication_dates, event_override FROM announcements`);
  const get = (id: string, _legacyToken?: string): StoredAnnouncement => {
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
    if (!row) throw new ServiceError(404, 'Oznam sa nenašiel.');
    const review = JSON.parse(row.review as string);
    return {
      publishOn: JSON.parse(row.publication_dates as string),
      eventOverride: JSON.parse(row.event_override as string),
      id: row.id as string,
      text: row.text as string,
      name: row.name as string,
      contact: row.contact as string,
      revision: row.revision as number,
      status: row.status as AnnouncementStatus,
      analysis: review
        ? { ...review, extracted: review.extracted ?? null }
        : null,
      reviewError: row.review_error as string | null,
    };
  };
  return {
    get,
    save(
      value: WriteAnnouncement,
      _legacyToken?: string,
    ): { saved: StoredAnnouncement; duplicate: boolean } {
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db
          .prepare('SELECT id FROM announcements WHERE id = ?')
          .get(value.id);
        const previous = existing ? get(value.id) : null;
        const contact = value.contact ?? previous?.contact;
        if (contact === undefined)
          throw new ServiceError(
            400,
            'Zadaj platný e-mail alebo telefónne číslo.',
          );
        const publishOn = value.publishOn ??
          previous?.publishOn ?? [nextSunday()];
        const eventOverride =
          value.eventOverride === undefined
            ? (previous?.eventOverride ?? null)
            : value.eventOverride;
        const publicationJson = JSON.stringify(publishOn);
        const overrideJson = JSON.stringify(eventOverride);
        const request = db
          .prepare('SELECT * FROM announcement_versions WHERE request_id = ?')
          .get(value.requestId);
        if (request) {
          if (
            !previous ||
            request.announcement_id !== value.id ||
            request.revision !== previous.revision ||
            request.text !== value.text ||
            request.name !== value.name ||
            request.contact !== contact ||
            request.publication_dates !== publicationJson ||
            request.event_override !== overrideJson
          )
            throw new ServiceError(
              409,
              'Oznam sa medzičasom zmenil. Načítaj jeho aktuálnu verziu.',
            );
          db.exec('COMMIT');
          return { saved: previous, duplicate: true };
        }
        if ((previous?.revision ?? 0) !== value.baseRevision)
          throw new ServiceError(
            409,
            'Oznam sa medzičasom zmenil. Načítaj jeho aktuálnu verziu.',
          );
        const revision = value.baseRevision + 1;
        if (previous) {
          db.prepare(
            `UPDATE announcements SET text=?, name=?, contact=?, review='null', status='checking', review_error=NULL, event_title=NULL, event_location=NULL, event_date=NULL, event_time=NULL, event_time_zone=NULL, event_starts_at_ms=NULL, revision=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
          ).run(value.text, value.name, contact, revision, value.id);
        } else {
          db.prepare(
            `INSERT INTO announcements (id, analysis_id, text, name, contact, review, status, original_name, original_contact, updated_at) VALUES (?, ?, ?, ?, ?, 'null', 'checking', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
          ).run(
            value.id,
            value.id,
            value.text,
            value.name,
            contact,
            value.name,
            contact,
          );
        }
        db.prepare(
          `INSERT INTO announcement_versions (announcement_id, revision, request_id, text, name, contact, status) VALUES (?, ?, ?, ?, ?, ?, 'checking')`,
        ).run(
          value.id,
          revision,
          value.requestId,
          value.text,
          value.name,
          contact,
        );
        db.prepare(
          'UPDATE announcements SET publication_dates=?, event_override=? WHERE id=?',
        ).run(publicationJson, overrideJson, value.id);
        db.prepare(
          'UPDATE announcement_versions SET publication_dates=?, event_override=? WHERE announcement_id=? AND revision=?',
        ).run(publicationJson, overrideJson, value.id, revision);
        if (eventOverride) {
          const manual = parseEvent({
            title: null,
            location: null,
            ...eventOverride,
            source: null,
            dateInferred: false,
          });
          const fields = [
            manual.date,
            manual.time,
            manual.timeZone,
            manual.startsAt ? Date.parse(manual.startsAt) : null,
          ];
          db.prepare(
            'UPDATE announcements SET event_date=?, event_time=?, event_time_zone=?, event_starts_at_ms=? WHERE id=?',
          ).run(...fields, value.id);
          db.prepare(
            'UPDATE announcement_versions SET event_date=?, event_time=?, event_time_zone=?, event_starts_at_ms=? WHERE announcement_id=? AND revision=?',
          ).run(...fields, value.id, revision);
        }
        db.exec('COMMIT');
        return { saved: get(value.id), duplicate: false };
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    finish(
      id: string,
      revision: number,
      analysis: Analysis | null,
      error: string | null,
    ) {
      const version = db
        .prepare(
          'SELECT event_override FROM announcement_versions WHERE announcement_id=? AND revision=?',
        )
        .get(id, revision);
      if (!version) throw new ServiceError(404, 'Verzia oznamu sa nenašla.');
      const override = JSON.parse(version.event_override as string);
      analysis = applyEventOverride(analysis, override);
      const status: AnnouncementStatus = !analysis
        ? 'review_failed'
        : analysis.metrics.tooLong ||
            !analysis.what.present ||
            !analysis.where.present ||
            !analysis.when.present ||
            !!analysis.extracted?.timingIssue
          ? 'needs_changes'
          : 'pending';
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          'UPDATE announcement_versions SET review=?, status=?, review_error=? WHERE announcement_id=? AND revision=?',
        ).run(JSON.stringify(analysis), status, error, id, revision);
        db.prepare(
          'UPDATE announcements SET review=?, status=?, review_error=? WHERE id=? AND revision=?',
        ).run(JSON.stringify(analysis), status, error, id, revision);
        const event =
          analysis?.extracted ??
          (override
            ? parseEvent({
                title: null,
                location: null,
                ...override,
                source: null,
                dateInferred: false,
              })
            : null);
        const fields = [
          event?.title ?? null,
          event?.location ?? null,
          event?.date ?? null,
          event?.time ?? null,
          event?.timeZone ?? null,
          event?.startsAt ? new Date(event.startsAt).getTime() : null,
        ];
        db.prepare(
          'UPDATE announcement_versions SET event_title=?, event_location=?, event_date=?, event_time=?, event_time_zone=?, event_starts_at_ms=? WHERE announcement_id=? AND revision=?',
        ).run(...fields, id, revision);
        db.prepare(
          'UPDATE announcements SET event_title=?, event_location=?, event_date=?, event_time=?, event_time_zone=?, event_starts_at_ms=? WHERE id=? AND revision=?',
        ).run(...fields, id, revision);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    reportRows() {
      return db
        .prepare(
          'SELECT id, text, revision, status, event_title, event_location, event_date, event_time, event_time_zone, event_starts_at_ms, publication_dates, event_override, review FROM announcements ORDER BY event_date, created_at',
        )
        .all();
    },
    close: () => db.close(),
  };
}
export type Storage = ReturnType<typeof createStorage>;
