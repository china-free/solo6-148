import { bpsToRate, msToTime, percentToString, generateId, parseNumber, parseFloatValue } from '../../src/utils';

describe('Utils', () => {
  test('bpsToRate converts correctly', () => {
    expect(bpsToRate(0)).toBe('0bit');
    expect(bpsToRate(512)).toBe('512bit');
    expect(bpsToRate(1024)).toBe('1kbit');
    expect(bpsToRate(1024 * 1024)).toBe('1mbit');
    expect(bpsToRate(1024 * 1024 * 1024)).toBe('1gbit');
  });

  test('msToTime formats correctly', () => {
    expect(msToTime(0)).toBe('0ms');
    expect(msToTime(100)).toBe('100ms');
    expect(msToTime(300)).toBe('300ms');
  });

  test('percentToString formats correctly', () => {
    expect(percentToString(0)).toBe('0%');
    expect(percentToString(5)).toBe('5%');
    expect(percentToString(10.5)).toBe('10.5%');
  });

  test('generateId returns unique strings', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
    expect(generateId().length).toBeGreaterThan(0);
  });

  test('parseNumber handles various inputs', () => {
    expect(parseNumber('123', 0)).toBe(123);
    expect(parseNumber(undefined, 0)).toBe(0);
    expect(parseNumber('invalid', 42)).toBe(42);
    expect(parseNumber('12.34', 0)).toBe(12);
  });

  test('parseFloatValue handles various inputs', () => {
    expect(parseFloatValue('12.34', 0)).toBeCloseTo(12.34);
    expect(parseFloatValue(undefined, 0)).toBe(0);
    expect(parseFloatValue('invalid', 42.5)).toBe(42.5);
  });
});
