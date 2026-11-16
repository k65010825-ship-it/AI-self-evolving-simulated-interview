export * from './tables/index.ts';

import type { users } from './tables/identity.ts';
import type { jobRoles, knowledgeItems, rubrics } from './tables/catalog.ts';
import type { policyVersions } from './tables/policies.ts';
import type { contentReleases } from './tables/releases.ts';

/** Row shapes for repositories; public API DTOs stay in packages/contracts. */
export type UserRow = typeof users.$inferSelect;
export type JobRoleRow = typeof jobRoles.$inferSelect;
export type KnowledgeItemRow = typeof knowledgeItems.$inferSelect;
export type RubricRow = typeof rubrics.$inferSelect;
export type PolicyVersionRow = typeof policyVersions.$inferSelect;
export type ContentReleaseRow = typeof contentReleases.$inferSelect;