import {
  acceptOrGenerateCorrelationId,
  generateCorrelationId,
  isValidCorrelationId,
} from './correlation-id.js';

describe('isValidCorrelationId', () => {
  it.each([
    'abcdefgh',
    '0b5e9f8e-2a4c-4f7a-9c1e-1f2d3c4b5a69',
    'cor_01jabcdefghjkmnpqrstvwxyz0',
    'req.2026-11-04_1',
    'a'.repeat(128),
  ])('accepts %s', (candidate) => {
    expect(isValidCorrelationId(candidate)).toBe(true);
  });

  it.each([
    ['too short', 'abcdefg'],
    ['too long', 'a'.repeat(129)],
    ['a line break', 'abcdefgh\n{"level":60}'],
    ['spaces', 'abcd efgh'],
    ['a comma joined repeat', 'abcdefgh, ijklmnop'],
    ['quotes', 'abcdefgh"'],
    ['empty', ''],
  ])('rejects one with %s', (_label, candidate) => {
    expect(isValidCorrelationId(candidate)).toBe(false);
  });

  it.each([undefined, null, 42, ['abcdefgh']])('rejects %s', (candidate) => {
    expect(isValidCorrelationId(candidate)).toBe(false);
  });
});

describe('generateCorrelationId', () => {
  it('generates valid, unique ids', () => {
    const ids = Array.from({ length: 100 }, generateCorrelationId);

    expect(ids.every(isValidCorrelationId)).toBe(true);
    expect(new Set(ids).size).toBe(100);
    expect(ids[0]).toMatch(/^cor_/);
  });
});

describe('acceptOrGenerateCorrelationId', () => {
  it('keeps a valid candidate', () => {
    expect(acceptOrGenerateCorrelationId('client-trace-0001')).toBe(
      'client-trace-0001',
    );
  });

  it('replaces an invalid candidate with a generated id', () => {
    const id = acceptOrGenerateCorrelationId('bad id\r\n');

    expect(id).not.toBe('bad id\r\n');
    expect(isValidCorrelationId(id)).toBe(true);
  });
});
