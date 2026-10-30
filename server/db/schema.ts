import { sql } from 'drizzle-orm';
import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';
import type {
  Analysis,
  AnnouncementStatus,
  EventOverride,
} from '../../shared/contracts.js';
const createdAt = () =>
  text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`);
const eventFields = () => ({
  eventTitle: text('event_title'),
  eventLocation: text('event_location'),
  eventDate: text('event_date'),
  eventTime: text('event_time'),
  eventTimeZone: text('event_time_zone'),
  eventStartsAtMs: integer('event_starts_at_ms'),
});
const reviewFields = (history = false) => ({
  review: history
    ? text('review', { mode: 'json' })
        .$type<Analysis | null>()
        .notNull()
        .default(sql`'null'`)
    : text('review', { mode: 'json' }).$type<Analysis | null>().notNull(),
  status: history
    ? text('status').$type<AnnouncementStatus>().notNull()
    : text('status').$type<AnnouncementStatus>().notNull().default('pending'),
  reviewError: text('review_error'),
  publicationDates: text('publication_dates', { mode: 'json' })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  eventOverride: text('event_override', { mode: 'json' })
    .$type<EventOverride | null>()
    .notNull()
    .default(sql`'null'`),
});
export const announcements = sqliteTable('announcements', {
  id: text('id').primaryKey(),
  analysisId: text('analysis_id').notNull().unique(),
  text: text('text').notNull(),
  name: text('name').notNull(),
  contact: text('contact').notNull(),
  originalName: text('original_name'),
  originalContact: text('original_contact'),
  editTokenHash: text('edit_token_hash'),
  revision: integer('revision').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: text('updated_at'),
  ...reviewFields(),
  ...eventFields(),
});
export const announcementVersions = sqliteTable(
  'announcement_versions',
  {
    announcementId: text('announcement_id').notNull(),
    revision: integer('revision').notNull(),
    requestId: text('request_id').notNull().unique(),
    text: text('text').notNull(),
    name: text('name').notNull(),
    contact: text('contact').notNull(),
    createdAt: createdAt(),
    ...reviewFields(true),
    ...eventFields(),
  },
  (table) => [primaryKey({ columns: [table.announcementId, table.revision] })],
);
export type AnnouncementRow = typeof announcements.$inferSelect;
