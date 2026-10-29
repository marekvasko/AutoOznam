import { z } from 'zod';
import { addDays, isSunday, displayDate } from '../shared/schedule.js';
import type { ReportItem, WeeklyReport } from '../shared/report.js';
export function weeklyReport(
  rows: Record<string, unknown>[],
  sunday: string,
): WeeklyReport {
  if (!isSunday(sunday)) throw new Error('Vyber dátum nedele.');
  const weekStart = addDays(sunday, 1),
    weekEnd = addDays(sunday, 7);
  const items: ReportItem[] = rows
    .map((row) => {
      const review = JSON.parse(String(row.review));
      return {
        id: String(row.id),
        title: String(
          row.event_title ||
            review?.extracted?.title ||
            String(row.text).slice(0, 90),
        ),
        text: String(row.text),
        location: row.event_location ? String(row.event_location) : null,
        date: z.iso.date().safeParse(row.event_date).success
          ? String(row.event_date)
          : null,
        time: row.event_time ? String(row.event_time) : null,
        status: String(row.status),
        revision: Number(row.revision),
        publishOn: JSON.parse(String(row.publication_dates)),
        manualDate: row.event_override !== 'null',
        timingIssue: review?.extracted?.timingIssue ?? null,
      };
    })
    .sort(
      (a, b) =>
        (a.date || '9999').localeCompare(b.date || '9999') ||
        (a.time || '').localeCompare(b.time || '') ||
        a.title.localeCompare(b.title, 'sk'),
    );
  return {
    sunday,
    weekStart,
    weekEnd,
    announcements: items.filter((i) => i.publishOn.includes(sunday)),
    weekEvents: items.filter(
      (i) => i.date && i.date >= weekStart && i.date <= weekEnd,
    ),
    futureEvents: items.filter((i) => i.date && i.date > weekEnd),
    undated: items.filter((i) => !i.date),
  };
}
export function reportText(report: WeeklyReport): string {
  const section = (title: string, items: ReportItem[], full: boolean) =>
    [
      title,
      '='.repeat(title.length),
      ...(items.length
        ? items.flatMap((item) => [
            item.title,
            [
              item.date ? displayDate(item.date) : 'Bez presného dátumu',
              item.time,
              item.location,
            ]
              .filter(Boolean)
              .join(' · '),
            ...(full ? [item.text] : []),
            ...(item.status !== 'pending'
              ? [
                  'Na kontrolu: ' +
                    ({
                      checking: 'kontrola prebieha',
                      needs_changes: 'doplň údaje alebo skráť text',
                      review_failed: 'AI kontrola nedostupná',
                    }[item.status] || item.status),
                ]
              : []),
            ...(item.timingIssue ? [item.timingIssue] : []),
            '',
          ])
        : ['Žiadne oznamy.', '']),
    ].join('\n');
  return [
    `Oznamy na nedeľu ${displayDate(report.sunday)}`,
    '',
    section('Na zverejnenie', report.announcements, true),
    section(
      `Nasledujúci týždeň: ${displayDate(report.weekStart)} – ${displayDate(report.weekEnd)}`,
      report.weekEvents,
      false,
    ),
    section('Neskoršie udalosti', report.futureEvents, false),
    section('Bez presného dátumu', report.undated, true),
  ].join('\n');
}
