import { asc, desc, eq } from 'drizzle-orm';
import { announcements, announcementVersions } from './schema.js';
import type { OrmDatabase } from './connection.js';
// Explicit projections keep private identity and legacy token hashes out of exports.
const eventColumns = (
  table: typeof announcements | typeof announcementVersions,
) => ({
  event_title: table.eventTitle,
  event_location: table.eventLocation,
  event_date: table.eventDate,
  event_time: table.eventTime,
  event_time_zone: table.eventTimeZone,
  event_starts_at_ms: table.eventStartsAtMs,
});
export function exportAnnouncements(db: OrmDatabase) {
  return db.transaction((tx) => {
    const rows = tx
      .select({
        id: announcements.id,
        text: announcements.text,
        revision: announcements.revision,
        status: announcements.status,
        created_at: announcements.createdAt,
        updated_at: announcements.updatedAt,
        ...eventColumns(announcements),
        publication_dates: announcements.publicationDates,
        event_override: announcements.eventOverride,
      })
      .from(announcements)
      .orderBy(desc(announcements.createdAt))
      .all();
    return rows.map((row) => ({
      ...row,
      publication_dates: JSON.stringify(row.publication_dates),
      event_override: JSON.stringify(row.event_override),
      versions: tx
        .select({
          revision: announcementVersions.revision,
          text: announcementVersions.text,
          status: announcementVersions.status,
          review: announcementVersions.review,
          review_error: announcementVersions.reviewError,
          created_at: announcementVersions.createdAt,
          ...eventColumns(announcementVersions),
          publication_dates: announcementVersions.publicationDates,
          event_override: announcementVersions.eventOverride,
        })
        .from(announcementVersions)
        .where(eq(announcementVersions.announcementId, row.id))
        .orderBy(asc(announcementVersions.revision))
        .all()
        .map((version) => ({
          ...version,
          review: JSON.stringify(version.review),
          publication_dates: JSON.stringify(version.publication_dates),
          event_override: JSON.stringify(version.event_override),
        })),
    }));
  });
}
