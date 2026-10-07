export * from "./config";
export * from "./errors";
export { createDatabase, migrateDatabase, type Database } from "./db/client";
export * as schema from "./db/schema";
export {
  isParentSetupRequired,
  setupParent,
  loginParent,
  requireParent,
  logoutParent,
  SESSION_TTL_MS,
} from "./modules/auth";
export { listChildren, createChild, deleteChild } from "./modules/profiles";
export {
  createDraft,
  editDraft,
  publishDraft,
} from "./modules/decks";
export { classifyRevisionImpact, buildSkillCriteria } from "./domain/revision-impact";
export { computeTargetKey, normalizeTargetText } from "./domain/target-key";
export { SKILLS, isSkill, type Skill } from "./domain/types";
