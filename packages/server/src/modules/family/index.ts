/**
 * Publiczne API obszaru family. Rodzina i dostęp: profile dzieci, uwierzytelnianie rodzica i tokeny integracyjne.
 * Inne obszary importują wyłącznie stąd; wewnątrz obszaru obowiązują
 * bezpośrednie importy plików. Kolejność i zakres pilnuje test granic modułów.
 */
export { SESSION_TTL_MS, isParentSetupRequired, loginParent, logoutParent, requireParent, setupParent, setupParentWithToken } from "./auth";
export {
  authenticateIntegrationToken,
  INTEGRATION_SCOPES,
  isIntegrationScope,
  issueIntegrationToken,
  LESSONS_WRITE_SCOPE,
  MATERIALS_PUBLISH_SCOPE,
  MATERIALS_WRITE_SCOPE,
  listIntegrationTokens,
  requireIntegrationScope,
  requireLearningReadToken,
  revokeIntegrationToken,
} from "./integration-tokens";
export type { IntegrationPrincipal, IntegrationScope, IntegrationTokenMetadata } from "./integration-tokens";
export { createChild, deleteChild, listChildren, updateChild } from "./profiles";
