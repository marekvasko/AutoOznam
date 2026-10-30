import 'dotenv/config';
import { openDatabase } from './connection.js';
const connection = openDatabase(
  process.env.DATABASE_PATH || './data/announcements.sqlite',
);
connection.close();
console.log('Databázové migrácie sú aktuálne.');
