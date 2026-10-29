import { z } from 'zod';
export const reportItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  location: z.string().nullable(),
  date: z.iso.date().nullable(),
  time: z.string().nullable(),
  status: z.string(),
  revision: z.number(),
  publishOn: z.array(z.iso.date()),
  manualDate: z.boolean(),
  timingIssue: z.string().nullable(),
});
export const weeklyReportSchema = z.object({
  sunday: z.iso.date(),
  weekStart: z.iso.date(),
  weekEnd: z.iso.date(),
  announcements: z.array(reportItemSchema),
  weekEvents: z.array(reportItemSchema),
  futureEvents: z.array(reportItemSchema),
  undated: z.array(reportItemSchema),
});
export type ReportItem = z.infer<typeof reportItemSchema>;
export type WeeklyReport = z.infer<typeof weeklyReportSchema>;
