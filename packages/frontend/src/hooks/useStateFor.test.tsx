import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStateFor } from './useStateFor';

function setup(initialKey: unknown) {
  return renderHook(({ stateKey }) => useStateFor(stateKey, 0), {
    initialProps: { stateKey: initialKey },
  });
}

describe('useStateFor', () => {
  it('keeps what was set while the key stays the same', () => {
    const { result, rerender } = setup('a');

    act(() => result.current[1](3));
    rerender({ stateKey: 'a' });

    expect(result.current[0]).toBe(3);
  });

  it('compares the key by value, so an equal new object is the same key', () => {
    const { result, rerender } = setup({ search: 'a' });

    act(() => result.current[1](3));
    rerender({ stateKey: { search: 'a' } });

    expect(result.current[0]).toBe(3);
  });

  it('goes back to its initial value when the key changes', () => {
    const { result, rerender } = setup('a');

    act(() => result.current[1](3));
    rerender({ stateKey: 'b' });

    expect(result.current[0]).toBe(0);
  });

  it("doesn't bring the old value back when the key returns", () => {
    const { result, rerender } = setup('a');

    act(() => result.current[1](3));
    rerender({ stateKey: 'b' });
    rerender({ stateKey: 'a' });

    expect(result.current[0]).toBe(0);
  });

  it('keeps what is set under the new key', () => {
    const { result, rerender } = setup('a');

    rerender({ stateKey: 'b' });
    act(() => result.current[1](5));

    expect(result.current[0]).toBe(5);
  });

  it('keeps the setter the same across keys, so it can be a dependency', () => {
    const { result, rerender } = setup('a');
    const setter = result.current[1];

    rerender({ stateKey: 'b' });

    expect(result.current[1]).toBe(setter);
  });
});
