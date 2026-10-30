import { and, asc, eq, sql } from 'drizzle-orm';
import type {
  Analysis,
  AnnouncementStatus,
  ExtractedEvent,
  StoredAnnouncement,
  WriteAnnouncement,
} from '../shared/contracts.js';
import { ServiceError } from './openrouter.js';
import { applyEventOverride, parseEvent } from './event.js';
import { nextSunday } from '../shared/schedule.js';
import { openDatabase } from './db/connection.js';
import {
  announcements,
  announcementVersions,
  type AnnouncementRow,
} from './db/schema.js';

const jsonNull = sql`'null'`;
const eventFields = (event?: ExtractedEvent | null) => ({
  eventTitle: event?.title ?? null,
  eventLocation: event?.location ?? null,
  eventDate: event?.date ?? null,
  eventTime: event?.time ?? null,
  eventTimeZone: event?.timeZone ?? null,
  eventStartsAtMs: event?.startsAt ? Date.parse(event.startsAt) : null,
});
function stored(row: AnnouncementRow | undefined): StoredAnnouncement {
  if (!row) throw new ServiceError(404, 'Oznam sa nenašiel.');
  return {
    id: row.id,
    text: row.text,
    name: row.name,
    contact: row.contact,
    revision: row.revision,
    status: row.status,
    publishOn: row.publicationDates,
    eventOverride: row.eventOverride,
    analysis: row.review
      ? { ...row.review, extracted: row.review.extracted ?? null }
      : null,
    reviewError: row.reviewError,
  };
}
export function createStorage(path: string) {
  const connection = openDatabase(path);
  const { db } = connection;
  const get = (id: string, _legacyToken?: string) =>
    stored(
      db.select().from(announcements).where(eq(announcements.id, id)).get(),
    );
  return {
    get,
    save(
      value: WriteAnnouncement,
      _legacyToken?: string,
    ): { saved: StoredAnnouncement; duplicate: boolean } {
      return db.transaction(
        (tx) => {
          const row = tx
            .select()
            .from(announcements)
            .where(eq(announcements.id, value.id))
            .get();
          const previous = row ? stored(row) : null;
          const name = value.name ?? previous?.name;
          if (name === undefined)
            throw new ServiceError(400, 'Vyplň svoje meno.');
          const contact = value.contact ?? previous?.contact;
          if (contact === undefined)
            throw new ServiceError(
              400,
              'Zadaj platný e-mail alebo telefónne číslo.',
            );
          const publishOn = value.publishOn ??
            previous?.publishOn ?? [nextSunday()];
          const override =
            value.eventOverride === undefined
              ? (previous?.eventOverride ?? null)
              : value.eventOverride;
          const request = tx
            .select()
            .from(announcementVersions)
            .where(eq(announcementVersions.requestId, value.requestId))
            .get();
          if (request) {
            if (
              !previous ||
              request.announcementId !== value.id ||
              request.revision !== previous.revision ||
              request.text !== value.text ||
              request.name !== name ||
              request.contact !== contact ||
              JSON.stringify(request.publicationDates) !==
                JSON.stringify(publishOn) ||
              JSON.stringify(request.eventOverride) !== JSON.stringify(override)
            )
              throw new ServiceError(
                409,
                'Oznam sa medzičasom zmenil. Načítaj jeho aktuálnu verziu.',
              );
            return { saved: previous, duplicate: true };
          }
          if ((previous?.revision ?? 0) !== value.baseRevision)
            throw new ServiceError(
              409,
              'Oznam sa medzičasom zmenil. Načítaj jeho aktuálnu verziu.',
            );
          const revision = value.baseRevision + 1;
          const manual = override
            ? parseEvent({
                title: null,
                location: null,
                ...override,
                source: null,
                dateInferred: false,
              })
            : null;
          const data = {
            text: value.text,
            name,
            contact,
            review: jsonNull,
            status: 'checking' as const,
            reviewError: null,
            publicationDates: publishOn,
            eventOverride: override ?? jsonNull,
            ...eventFields(manual),
          };
          const now = new Date().toISOString();
          if (previous)
            tx.update(announcements)
              .set({ ...data, revision, updatedAt: now })
              .where(eq(announcements.id, value.id))
              .run();
          else
            tx.insert(announcements)
              .values({
                ...data,
                id: value.id,
                analysisId: value.id,
                originalName: name,
                originalContact: contact,
                updatedAt: now,
              })
              .run();
          tx.insert(announcementVersions)
            .values({
              ...data,
              announcementId: value.id,
              revision,
              requestId: value.requestId,
            })
            .run();
          return {
            saved: stored(
              tx
                .select()
                .from(announcements)
                .where(eq(announcements.id, value.id))
                .get(),
            ),
            duplicate: false,
          };
        },
        { behavior: 'immediate' },
      );
    },
    finish(
      id: string,
      revision: number,
      analysis: Analysis | null,
      error: string | null,
    ) {
      db.transaction(
        (tx) => {
          const version = tx
            .select({ override: announcementVersions.eventOverride })
            .from(announcementVersions)
            .where(
              and(
                eq(announcementVersions.announcementId, id),
                eq(announcementVersions.revision, revision),
              ),
            )
            .get();
          if (!version)
            throw new ServiceError(404, 'Verzia oznamu sa nenašla.');
          const override = version.override;
          const reviewed = applyEventOverride(analysis, override);
          const status: AnnouncementStatus = !reviewed
            ? 'review_failed'
            : reviewed.metrics.tooLong ||
                !reviewed.what.present ||
                !reviewed.where.present ||
                !reviewed.when.present ||
                !!reviewed.extracted?.timingIssue
              ? 'needs_changes'
              : 'pending';
          const event =
            reviewed?.extracted ??
            (override
              ? parseEvent({
                  title: null,
                  location: null,
                  ...override,
                  source: null,
                  dateInferred: false,
                })
              : null);
          const data = {
            review: reviewed ?? jsonNull,
            status,
            reviewError: error,
            ...eventFields(event),
          };
          tx.update(announcementVersions)
            .set(data)
            .where(
              and(
                eq(announcementVersions.announcementId, id),
                eq(announcementVersions.revision, revision),
              ),
            )
            .run();
          tx.update(announcements)
            .set(data)
            .where(
              and(
                eq(announcements.id, id),
                eq(announcements.revision, revision),
              ),
            )
            .run();
        },
        { behavior: 'immediate' },
      );
    },
    reportRows() {
      return db
        .select({
          id: announcements.id,
          text: announcements.text,
          revision: announcements.revision,
          status: announcements.status,
          title: announcements.eventTitle,
          location: announcements.eventLocation,
          date: announcements.eventDate,
          time: announcements.eventTime,
          publishOn: announcements.publicationDates,
          eventOverride: announcements.eventOverride,
          analysis: announcements.review,
        })
        .from(announcements)
        .orderBy(asc(announcements.eventDate), asc(announcements.createdAt))
        .all();
    },
    close: connection.close,
  };
}
export type Storage = ReturnType<typeof createStorage>;
