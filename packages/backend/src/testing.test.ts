import { describe, expect, it, vi } from 'vitest';
import { fake, silentLogger } from './testing.js';

class Greeter {
  private greeted = 0;

  greet(name: string): string {
    this.greeted += 1;
    return `Hello, ${name}`;
  }

  count(): number {
    return this.greeted;
  }
}

describe('fake', () => {
  it('stands in for the class with only the members given, which keep their mocks', () => {
    const greeter = fake<Greeter>()({ greet: vi.fn((name: string) => `Hi, ${name}`) });

    const use = (real: Greeter) => real.greet('Ada');

    expect(use(greeter)).toBe('Hi, Ada');
    expect(greeter.greet.mock.calls).toEqual([['Ada']]);
  });

  it("refuses at compile time a member the class doesn't have, or one that doesn't match", () => {
    // @ts-expect-error: Greeter has no wave().
    fake<Greeter>()({ wave: vi.fn() });
    // @ts-expect-error: greet() returns a string.
    fake<Greeter>()({ greet: (_name: string) => 42 });
    // @ts-expect-error: greet() is given a string, not a number.
    fake<Greeter>()({ greet: (name: number) => `${name}` });
  });

  it('checks a bare vi.fn() by name only, and a typed one by its signature too', () => {
    const greeter = fake<Greeter>()({ greet: vi.fn() });
    greeter.greet.mockReturnValue('Hey');

    expect(greeter.greet('Ada')).toBe('Hey');
    // @ts-expect-error: count() isn't given a name.
    fake<Greeter>()({ count: vi.fn((_name: string) => 1) });
    // @ts-expect-error: greet() returns a string.
    fake<Greeter>()({ greet: vi.fn<(name: string) => number>() });
  });

  it("keeps the test's own state beside the members, but no method the class lacks", () => {
    const greeter = fake<Greeter>()({ said: [] as string[], greet: (name: string) => name });
    greeter.said.push('kept');

    expect(greeter.said).toEqual(['kept']);
    // @ts-expect-error: a function the class doesn't have is a renamed or removed method.
    fake<Greeter>()({ greeted: () => 1 });
  });
});

describe('silentLogger', () => {
  it('spies on what is logged, including through a child logger', () => {
    const logger = silentLogger();

    logger.child({ component: 'Test' }).warn('careful');

    expect(logger.warn).toHaveBeenCalledWith('careful');
  });
});
