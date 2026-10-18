import { initialSchema } from './001_initial_schema.js';
import { featureData } from './002_feature_data.js';
import { suggestions } from './003_suggestions.js';
import { dropIntegrationStatus } from './004_drop_integration_status.js';
import { obsBreakRestore } from './005_obs_break_restore.js';
import { goLivePost } from './006_go_live_post.js';
import type { Migration } from './MigrationRunner.js';

/** Every migration, applied in version order on startup. */
export const ALL_MIGRATIONS: readonly Migration[] = [
  initialSchema,
  featureData,
  suggestions,
  dropIntegrationStatus,
  obsBreakRestore,
  goLivePost,
];
