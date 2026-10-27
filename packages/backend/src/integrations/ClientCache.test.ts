import { describe, expect, it, vi } from 'vitest';
import { ClientCache } from './ClientCache.js';

function setup() {
  const build = vi.fn((auth: object) => ({ auth }));
  const onRebuild = vi.fn();
  return { cache: new ClientCache(build, onRebuild), build, onRebuild };
}

describe('ClientCache', () => {
  it('hands out the same client while the auth object is the same', () => {
    const { cache, build } = setup();
    const auth = {};

    expect(cache.get(auth)).toBe(cache.get(auth));
    expect(build).toHaveBeenCalledOnce();
  });

  it('rebuilds on a replaced auth object, and says so', () => {
    const { cache, onRebuild } = setup();
    const first = cache.get({});

    const second = cache.get({});

    expect(second).not.toBe(first);
    expect(onRebuild).toHaveBeenCalledOnce();
  });

  it('builds afresh after clear(), without calling it a rebuild', () => {
    const { cache, build, onRebuild } = setup();
    const auth = {};
    cache.get(auth);

    cache.clear();
    cache.get(auth);

    expect(build).toHaveBeenCalledTimes(2);
    expect(onRebuild).not.toHaveBeenCalled();
  });
});
