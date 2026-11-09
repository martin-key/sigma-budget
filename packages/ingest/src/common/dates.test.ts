import { expect, it } from 'vitest';
import { isIsoDay } from './dates.js';

it.each(['2024-02-29', '2000-02-29', '2026-08-31', '0001-01-01', '0099-12-31'])(
  'accepts calendar day %s',
  (day) => expect(isIsoDay(day)).toBe(true),
);
it.each([
  '2026-02-29',
  '1900-02-29',
  '2026-02-31',
  '2026-99-99',
  '2026-04-31',
  '2026-01-00',
  '0000-01-01',
  '2026-2-01',
  '2026-01-01T00:00:00',
  null,
])('rejects invalid calendar day %s', (day) => expect(isIsoDay(day)).toBe(false));
