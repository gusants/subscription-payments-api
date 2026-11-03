import { generateId } from './generate-id.js';
import { ID_PREFIXES } from './id-prefix.js';

describe('generateId', () => {
  it.each(Object.values(ID_PREFIXES))('starts with %s', (prefix) => {
    expect(generateId(prefix)).toMatch(new RegExp(`^${prefix}[0-9a-z]{26}$`));
  });

  it('generates unique ids', () => {
    const ids = new Set(
      Array.from({ length: 1000 }, () => generateId(ID_PREFIXES.plan)),
    );

    expect(ids.size).toBe(1000);
  });
});

describe('generateId ordering', () => {
  it('keeps creation order for ids generated in the same millisecond', () => {
    const ids = Array.from({ length: 1000 }, () =>
      generateId(ID_PREFIXES.plan),
    );

    expect(ids).toEqual([...ids].sort());
  });
});
