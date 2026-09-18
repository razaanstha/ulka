import { expect, test } from 'bun:test';
import { currentTimeContext } from '../apps/extension/src/agent/time-context';

test('local date follows timezone across UTC midnight', () => {
  expect(currentTimeContext(new Date('2026-09-18T23:30:00Z'), 'Europe/Stockholm')).toEqual({
    utc: '2026-09-18T23:30:00.000Z', timeZone: 'Europe/Stockholm', localDate: '2026-09-19', localTime: '01:30:00', weekday: 'Saturday',
  });
  expect(currentTimeContext(new Date('2026-09-18T01:30:00Z'), 'America/Los_Angeles').localDate).toBe('2026-09-17');
});

test('local time accounts for daylight saving transition', () => {
  expect(currentTimeContext(new Date('2026-03-29T00:30:00Z'), 'Europe/Stockholm').localTime).toBe('01:30:00');
  expect(currentTimeContext(new Date('2026-03-29T01:30:00Z'), 'Europe/Stockholm').localTime).toBe('03:30:00');
});
