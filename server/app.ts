import express from 'express';
import rateLimit from 'express-rate-limit';
import { resolve } from 'node:path';
import { z } from 'zod';
import { weeklyReport, reportText } from './report.js';
import { isSunday, nextSunday } from '../shared/schedule.js';
import {
  measureText,
  eventPatchSchema,
  writeSchema,
  type AIResult,
} from '../shared/contracts.js';
import { analyzeWithOpenRouter, ServiceError } from './openrouter.js';
import type { Storage } from './storage.js';
import { parseEvent } from './event.js';
export function createApp(
  storage: Storage,
  analyze: (
    text: string,
    publicationDate?: string,
  ) => Promise<AIResult> = analyzeWithOpenRouter,
) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
    });
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 30,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: 'Príliš veľa požiadaviek. Skús to o 15 minút.' },
    }),
  );
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/reports/weekly', (req, res) => {
    const sunday = z
      .string()
      .refine(isSunday, 'Vyber dátum nedele.')
      .parse(req.query.sunday ?? nextSunday());
    const format = z.enum(['json', 'txt']).parse(req.query.format ?? 'json');
    const report = weeklyReport(storage.reportRows(), sunday);
    if (format === 'txt') {
      res
        .type('text/plain')
        .attachment(`oznamy-${sunday}.txt`)
        .send(reportText(report));
      return;
    }
    res.json(report);
  });
  app.get('/api/announcements/:id', (req, res) => {
    res.json(storage.get(z.uuid().parse(req.params.id)));
  });
  app.patch('/api/announcements/:id/event', (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const patch = eventPatchSchema.parse(req.body);
    const current = storage.get(id);
    const { saved, duplicate } = storage.save({
      id,
      ...patch,
      text: current.text,
      name: current.name,
      contact: current.contact,
      publishOn: current.publishOn,
    });
    if (!duplicate)
      storage.finish(id, saved.revision, current.analysis, current.reviewError);
    res.json(storage.get(id));
  });
  const activeReviews = new Map<string, Promise<void>>();
  app.post('/api/announcements', async (req, res) => {
    const value = writeSchema.parse(req.body);
    // Commit content and identity before any external call, including a failed AI call.
    const { saved, duplicate } = storage.save(value);
    if (
      !duplicate ||
      saved.status === 'review_failed' ||
      saved.status === 'checking'
    ) {
      const key = `${saved.id}:${saved.revision}`;
      let review = activeReviews.get(key);
      if (!review) {
        review = (async () => {
          let analysis = null;
          let reviewError = null;
          try {
            const result = await analyze(saved.text, saved.publishOn[0]);
            analysis = {
              ...result,
              extracted: parseEvent(result.extracted),
              metrics: measureText(saved.text),
            };
          } catch {
            reviewError = 'Kontrola je nedostupná. Oznam je uložený.';
          }
          storage.finish(saved.id, saved.revision, analysis, reviewError);
        })();
        activeReviews.set(key, review);
      }
      try {
        await review;
      } finally {
        if (activeReviews.get(key) === review) activeReviews.delete(key);
      }
    }
    res
      .status(value.baseRevision === 0 ? 201 : 200)
      .json(storage.get(value.id));
  });
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Táto adresa neexistuje.' });
  });
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: error.issues[0]?.message || 'Skontroluj zadané údaje.',
        });
        return;
      }
      if (error instanceof ServiceError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      const status = (error as { status?: number })?.status;
      if (status === 413 || status === 400) {
        res.status(status).json({
          error:
            status === 413
              ? 'Odoslaný text je príliš veľký.'
              : 'Neplatná požiadavka.',
        });
        return;
      }
      console.error(
        'Request failed:',
        error instanceof Error ? error.name : 'Unknown error',
      );
      res.status(500).json({
        error: 'Oznam sa nepodarilo spracovať. Skús to, prosím, znova.',
      });
    },
  );
  return app;
}
