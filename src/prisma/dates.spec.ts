import { toDate } from './dates';

describe('toDate', () => {
  it('should read a timestamptz with an hour offset', () => {
    expect(toDate('2026-10-10 10:37:30.714423+07').toISOString()).toBe(
      '2026-10-10T03:37:30.714Z',
    );
  });

  it('should read a timestamptz with a half-hour offset', () => {
    expect(toDate('2026-10-10 10:37:30+05:30').toISOString()).toBe(
      '2026-10-10T05:07:30.000Z',
    );
  });

  it('should read a negative offset', () => {
    expect(toDate('2026-01-01 00:00:00-03').toISOString()).toBe(
      '2026-01-01T03:00:00.000Z',
    );
  });

  it('should read a timestamp without a zone as local time', () => {
    expect(toDate('2026-10-10 10:43:37.990478').getTime()).toBe(
      new Date(2026, 9, 10, 10, 43, 37, 990).getTime(),
    );
  });

  it('should pass null through', () => {
    expect(toDate(null)).toBeNull();
  });

  it('should throw on garbage instead of returning an invalid date', () => {
    expect(() => toDate('not a date')).toThrow('Unparseable timestamp');
  });
});
