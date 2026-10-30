import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { openDatabase } from './db/connection.js';
import { exportAnnouncements } from './db/export.js';
const destination = process.argv[2];
if (!destination) {
  console.error('Použitie: npm run export -- ./oznamy.json');
  process.exit(1);
}
const connection = openDatabase(
  process.env.DATABASE_PATH || './data/announcements.sqlite',
  { readOnly: true },
);
try {
  const rows = exportAnnouncements(connection.db);
  writeFileSync(destination, JSON.stringify(rows, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(`Exportovaných oznamov: ${rows.length}`);
} finally {
  connection.close();
}
