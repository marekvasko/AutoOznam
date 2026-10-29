import { Temporal } from '@js-temporal/polyfill';
import {
  EVENT_TIME_ZONE,
  type ExtractedInput,
  type ExtractedEvent,
} from '../shared/contracts.js';

// Dates without a time stay calendar dates; never silently fill in midnight.
export function parseEvent(input: ExtractedInput): ExtractedEvent {
  const event: ExtractedEvent = {
    ...input,
    date: input.date || null,
    time: input.time || null,
    title: input.title || null,
    location: input.location || null,
    source: input.source || null,
    timeZone: EVENT_TIME_ZONE,
    startsAt: null,
    timingIssue: null,
  };
  if (event.date) {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(event.date)) throw new RangeError();
      event.date = Temporal.PlainDate.from(event.date, {
        overflow: 'reject',
      }).toString();
    } catch {
      event.date = null;
      event.timingIssue = 'Dátum sa nepodarilo rozpoznať. Upresni ho v texte.';
    }
  }
  if (event.time) {
    try {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(event.time)) throw new RangeError();
      event.time = Temporal.PlainTime.from(event.time).toString({
        smallestUnit: 'minute',
      });
    } catch {
      event.time = null;
      event.timingIssue = 'Čas sa nepodarilo rozpoznať. Upresni ho v texte.';
    }
  }
  if (event.date && event.time) {
    try {
      const local = Temporal.PlainDateTime.from(`${event.date}T${event.time}`);
      const zoned = local.toZonedDateTime(EVENT_TIME_ZONE, {
        disambiguation: 'reject',
      });
      event.startsAt = zoned.toInstant().toString();
    } catch {
      event.timingIssue =
        'Čas je pri zmene letného času nejednoznačný alebo neexistuje. Upresni termín.';
    }
  }
  if (!event.date) event.dateInferred = false;
  return event;
}
export function extractionReference(now = Temporal.Now.instant()) {
  const local = now.toZonedDateTimeISO(EVENT_TIME_ZONE);
  return {
    currentDate: local.toPlainDate().toString(),
    currentTime: local.toPlainTime().toString({ smallestUnit: 'minute' }),
    timeZone: EVENT_TIME_ZONE,
  };
}

export function applyEventOverride(
  analysis: import('../shared/contracts.js').Analysis | null,
  override: import('../shared/contracts.js').EventOverride | null,
): import('../shared/contracts.js').Analysis | null {
  if (!override || !analysis) return analysis;
  const extracted = parseEvent({
    title: analysis.extracted?.title ?? null,
    location: analysis.extracted?.location ?? null,
    ...override,
    source: analysis.extracted?.source ?? null,
    dateInferred: false,
  });
  const present = !!override.date && (!!override.time || analysis.when.present);
  const when = extracted.timingIssue
    ? { present: false, detail: extracted.timingIssue }
    : {
        present,
        detail: !override.date
          ? 'Doplň dátum udalosti.'
          : !present
            ? 'Doplň čas udalosti.'
            : 'Termín si zadal ručne.',
      };
  return { ...analysis, extracted, when };
}
