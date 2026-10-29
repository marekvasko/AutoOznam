import { z } from 'zod';
import { EVENT_TIME_ZONE } from './contracts.js';
export function parishDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: EVENT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function addDays(date: string, days: number): string {
  z.iso.date().parse(date);
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function isSunday(date: string): boolean {
  return (
    z.iso.date().safeParse(date).success &&
    new Date(`${date}T12:00:00Z`).getUTCDay() === 0
  );
}
export function nextSunday(date = parishDate()): string {
  z.iso.date().parse(date);
  return addDays(date, (7 - new Date(`${date}T12:00:00Z`).getUTCDay()) % 7);
}
export function displayDate(date: string): string {
  return new Intl.DateTimeFormat('sk-SK', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}
