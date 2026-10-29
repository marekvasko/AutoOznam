import { z } from 'zod';
export const MAX_WORDS = 80;
export const MAX_SENTENCES = 3;
export const textSchema = z
  .string()
  .trim()
  .min(10, 'Oznam musí mať aspoň 10 znakov.')
  .max(6000, 'Oznam môže mať najviac 6 000 znakov.');
export const checkSchema = z
  .object({ present: z.boolean(), detail: z.string().trim().min(1).max(500) })
  .strict();
export const EVENT_TIME_ZONE = 'Europe/Bratislava';
export const extractedSchema = z
  .object({
    title: z.string().trim().max(160).nullable(),
    location: z.string().trim().max(300).nullable(),
    date: z.string().max(30).nullable(),
    time: z.string().max(20).nullable(),
    dateInferred: z.boolean(),
    source: z.string().trim().max(500).nullable(),
  })
  .strict();
export type ExtractedInput = z.infer<typeof extractedSchema>;
export const extractedEventSchema = extractedSchema.extend({
  date: z.iso.date().nullable(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  timeZone: z.literal(EVENT_TIME_ZONE),
  startsAt: z.iso.datetime({ offset: true }).nullable(),
  timingIssue: z.string().nullable(),
});
export type ExtractedEvent = z.infer<typeof extractedEventSchema>;
export const aiSchema = z
  .object({
    what: checkSchema,
    where: checkSchema,
    when: checkSchema,
    suggestion: z.string().trim().max(2000).nullable(),
    extracted: extractedSchema,
  })
  .strict();
export const publicationDatesSchema = z
  .array(
    z.iso
      .date()
      .refine(
        (date) => new Date(date + 'T12:00:00Z').getUTCDay() === 0,
        'Vyber nedeľu.',
      ),
  )
  .min(1, 'Vyber aspoň jednu nedeľu.')
  .max(52)
  .transform((dates) => [...new Set(dates)].sort());
export const eventOverrideSchema = z
  .object({
    date: z.iso.date().nullable(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Zadaj platný čas.')
      .nullable(),
  })
  .strict();
export type EventOverride = z.infer<typeof eventOverrideSchema>;
export const submissionSchema = z.object({
  publishOn: publicationDatesSchema.optional(),
  eventOverride: eventOverrideSchema.nullable().optional(),
  text: textSchema,
  name: z.string().trim().min(2, 'Vyplň svoje meno.').max(100),
  contact: z
    .string()
    .trim()
    .max(150)
    .refine(
      (v) =>
        z.email().safeParse(v).success ||
        (/^\+?[\d\s()-]+$/.test(v) &&
          v.replace(/\D/g, '').length >= 9 &&
          v.replace(/\D/g, '').length <= 15),
      'Zadaj platný e-mail alebo telefónne číslo.',
    ),
});
export const writeSchema = submissionSchema.extend({
  id: z.uuid(),
  requestId: z.uuid(),
  baseRevision: z.number().int().nonnegative(),
});
export const eventPatchSchema = z
  .object({
    requestId: z.uuid(),
    baseRevision: z.number().int().positive(),
    eventOverride: eventOverrideSchema,
  })
  .strict();
export function measureText(text: string) {
  const words = [
    ...new Intl.Segmenter('sk', { granularity: 'word' }).segment(text),
  ].filter((s) => s.isWordLike).length;
  const sentences = [
    ...new Intl.Segmenter('sk', { granularity: 'sentence' }).segment(text),
  ].filter((s) => /[\p{L}\p{N}]/u.test(s.segment)).length;
  return {
    words,
    sentences,
    tooLong: words > MAX_WORDS || sentences > MAX_SENTENCES,
  };
}
export type AIResult = z.infer<typeof aiSchema>;
export type Analysis = Omit<AIResult, 'extracted'> & {
  extracted: ExtractedEvent | null;
  metrics: ReturnType<typeof measureText>;
};
export type AnnouncementStatus =
  'checking' | 'pending' | 'needs_changes' | 'review_failed';
export const savedAnnouncementSchema = submissionSchema.extend({
  publishOn: z.array(z.iso.date()).default([]),
  eventOverride: eventOverrideSchema.nullable().default(null),
  id: z.uuid(),
  revision: z.number().int().positive(),
  status: z.enum(['checking', 'pending', 'needs_changes', 'review_failed']),
  analysis: aiSchema
    .omit({ extracted: true })
    .extend({
      extracted: extractedEventSchema.nullable(),
      metrics: z.object({
        words: z.number().int().nonnegative(),
        sentences: z.number().int().nonnegative(),
        tooLong: z.boolean(),
      }),
    })
    .strip()
    .nullable(),
  reviewError: z.string().nullable(),
});
export type SavedAnnouncement = z.infer<typeof savedAnnouncementSchema>;
export type WriteAnnouncement = z.infer<typeof writeSchema>;

export function formatEventDate(event: ExtractedEvent): string | null {
  if (event.startsAt)
    return new Intl.DateTimeFormat('sk-SK', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: event.timeZone,
    }).format(new Date(event.startsAt));
  const date = event.date
    ? new Intl.DateTimeFormat('sk-SK', {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(new Date(event.date + 'T12:00:00Z'))
    : null;
  return [date, event.time].filter(Boolean).join(' · ') || event.source;
}
