import { initialSchema } from './001_initial_schema.js';
import { featureData } from './002_feature_data.js';
import { suggestions } from './003_suggestions.js';
import type { Migration } from './MigrationRunner.js';

/** Every migration, applied in version order on startup (and by the import tool). */
export const ALL_MIGRATIONS: readonly Migration[] = [initialSchema, featureData, suggestions];
