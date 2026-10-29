import { describe, expect, it } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import { extractionReference, parseEvent } from '../server/event';
import { formatEventDate, type ExtractedInput } from '../shared/contracts';
const event: ExtractedInput = {
  title: 'Farská brigáda',
  location: 'Záhrada pri kostole',
  date: '2026-11-07',
  time: '09:00',
  dateInferred: false,
  source: '7. novembra 2026 o 9:00',
};
describe('Štruktúrovaný termín', () => {
  it('prevedie slovenský zimný a letný čas na jednoznačné UTC', () => {
    expect(parseEvent(event).startsAt).toBe('2026-11-07T08:00:00Z');
    expect(parseEvent({ ...event, date: '2026-07-07' }).startsAt).toBe(
      '2026-07-07T07:00:00Z',
    );
  });
  it('bez času nedopĺňa polnoc a bez dátumu nevytvorí timestamp', () => {
    expect(parseEvent({ ...event, time: null })).toMatchObject({
      date: '2026-11-07',
      time: null,
      startsAt: null,
      timingIssue: null,
    });
    expect(
      parseEvent({ ...event, date: null, dateInferred: true }),
    ).toMatchObject({
      date: null,
      time: '09:00',
      startsAt: null,
      dateInferred: false,
    });
  });
  it('zachová neurčitý alebo opakovaný termín ako pôvodný text', () => {
    const input = {
      ...event,
      date: null,
      time: null,
      source: 'po nedeľnej svätej omši',
    };
    expect(parseEvent(input)).toMatchObject({
      startsAt: null,
      source: input.source,
    });
    expect(formatEventDate(parseEvent(input))).toBe(input.source);
  });
  it('odmietne neexistujúci dátum bez straty ostatných údajov', () => {
    const result = parseEvent({ ...event, date: '2026-02-30' });
    expect(result).toMatchObject({
      date: null,
      time: '09:00',
      title: event.title,
      location: event.location,
      startsAt: null,
    });
    expect(result.timingIssue).toContain('Dátum');
    expect(parseEvent({ ...event, date: '2028-02-29' }).startsAt).toBe(
      '2028-02-29T08:00:00Z',
    );
  });
  it('neakceptuje nemožný čas ani voľný text namiesto dátumu', () => {
    expect(parseEvent({ ...event, time: '25:00' })).toMatchObject({
      time: null,
      startsAt: null,
    });
    expect(parseEvent({ ...event, date: 'zajtra' })).toMatchObject({
      date: null,
      startsAt: null,
    });
  });
  it('pri oboch zmenách letného času odmietne nejednoznačný okamih', () => {
    expect(
      parseEvent({ ...event, date: '2027-03-28', time: '02:30' }),
    ).toMatchObject({ startsAt: null, timingIssue: expect.any(String) });
    expect(
      parseEvent({ ...event, date: '2027-10-31', time: '02:30' }),
    ).toMatchObject({ startsAt: null, timingIssue: expect.any(String) });
  });
  it('poskytne modelu referenčný slovenský dátum aj pri hranici UTC dňa', () => {
    expect(
      extractionReference(Temporal.Instant.from('2026-10-29T23:30:00Z')),
    ).toEqual({
      currentDate: '2026-10-30',
      currentTime: '00:30',
      timeZone: 'Europe/Bratislava',
    });
  });
  it('formátuje API dátum na frontende nezávisle od pásma prehliadača', () => {
    expect(formatEventDate(parseEvent(event))).toMatch(
      /7\.\s*11\.\s*2026.*9:00/,
    );
    expect(formatEventDate(parseEvent({ ...event, time: null }))).toMatch(
      /7\.\s*11\.\s*2026/,
    );
    expect(formatEventDate(parseEvent({ ...event, date: null }))).toBe('09:00');
  });
});
