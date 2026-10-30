import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
const destination = process.argv[2];
if (!destination) {
  console.error('Použitie: npm run export -- ./oznamy.json');
  process.exit(1);
}
const db = new DatabaseSync(
  process.env.DATABASE_PATH || './data/announcements.sqlite',
  { readOnly: true },
);
try {
  const rows = db
    .prepare(
      'SELECT id, text, name, original_name, revision, status, created_at, updated_at, event_title, event_location, event_date, event_time, event_time_zone, event_starts_at_ms, publication_dates, event_override FROM announcements ORDER BY created_at DESC',
    )
    .all();
  writeFileSync(
    destination,
    JSON.stringify(
      rows.map((row) => ({
        ...row,
        versions: db
          .prepare(
            'SELECT revision, text, name, status, review, review_error, created_at, event_title, event_location, event_date, event_time, event_time_zone, event_starts_at_ms, publication_dates, event_override FROM announcement_versions WHERE announcement_id = ? ORDER BY revision',
          )
          .all(row.id as string),
      })),
      null,
      2,
    ) + '\n',
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  console.log(`Exportovaných oznamov: ${rows.length}`);
} finally {
  db.close();
}
