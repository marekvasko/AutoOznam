import 'dotenv/config';
import { createApp } from './app.js';
import { createStorage } from './storage.js';
const storage = createStorage(
  process.env.DATABASE_PATH || './data/announcements.sqlite',
);
const server = createApp(storage).listen(
  Number(process.env.PORT || 3001),
  () => {
    console.log(
      `AutoOznam server: http://localhost:${process.env.PORT || 3001}`,
    );
    if (!process.env.OPENROUTER_API_KEY)
      console.warn('Doplň OPENROUTER_API_KEY do .env pre aktiváciu kontroly.');
  },
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () =>
    server.close(() => {
      storage.close();
      process.exit(0);
    }),
  );
