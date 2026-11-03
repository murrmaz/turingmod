import { initialSchema } from './001_initial_schema.js';
import type { Migration } from './MigrationRunner.js';

/** Every migration, applied in version order on startup. */
export const ALL_MIGRATIONS: readonly Migration[] = [initialSchema];
