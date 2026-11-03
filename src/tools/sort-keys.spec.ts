import { sortKeys } from './sort-keys.js';

describe('sortKeys', () => {
  it('sorts object keys recursively and keeps array order', () => {
    const sorted = sortKeys({ b: [{ z: 1, a: 2 }, 'x'], a: { d: 1, c: null } });

    expect(JSON.stringify(sorted)).toBe(
      '{"a":{"c":null,"d":1},"b":[{"a":2,"z":1},"x"]}',
    );
  });

  it('returns primitives untouched', () => {
    expect(sortKeys(3)).toBe(3);
  });
});
