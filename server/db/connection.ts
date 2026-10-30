import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { upgradeLegacyDatabase } from './legacy.js';
import * as schema from './schema.js';
export function openDatabase(
  path: string,
  options: { readOnly?: boolean } = {},
) {
  if (!options.readOnly && path !== ':memory:')
    mkdirSync(dirname(path), { recursive: true });
  const client = new Database(path, {
    readonly: !!options.readOnly,
    fileMustExist: !!options.readOnly,
  });
  try {
    const db = drizzle(client, { schema });
    if (!options.readOnly) {
      client.pragma('journal_mode = WAL');
      const hasTable = (name: string) =>
        !!client
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(name);
      if (hasTable('announcements') && !hasTable('__drizzle_migrations'))
        upgradeLegacyDatabase(client);
      migrate(db, { migrationsFolder: resolve('drizzle') });
    }
    return { db, close: () => client.close() };
  } catch (error) {
    client.close();
    throw error;
  }
}
export type OrmDatabase = ReturnType<typeof openDatabase>['db'];
