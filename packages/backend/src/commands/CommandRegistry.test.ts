import { describe, expect, it } from 'vitest';
import { Logger } from '../utils/Logger.js';
import { CommandRegistry } from './CommandRegistry.js';
import type { ICommand } from './interfaces/ICommand.js';

describe('CommandRegistry', () => {
  it('rejects a name with capitals, which a parsed command could never match', () => {
    const registry = new CommandRegistry(new Logger({ level: 'silent' }));

    expect(() => registry.register({ name: 'Lurk' } as ICommand)).toThrow(/lowercase/);
  });
});
