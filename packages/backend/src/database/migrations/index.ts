import { initialSchema } from './001_initial_schema.js';
import { featureData } from './002_feature_data.js';
import { suggestions } from './003_suggestions.js';
import { dropIntegrationStatus } from './004_drop_integration_status.js';
import type { Migration } from './MigrationRunner.js';

/** Every migration, applied in version order on startup. */
export const ALL_MIGRATIONS: readonly Migration[] = [
  initialSchema,
  featureData,
  suggestions,
  dropIntegrationStatus,
];
