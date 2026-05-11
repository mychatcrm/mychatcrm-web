/**
 * Camada de agentes (IA por tenant): contratos estáveis para runtime, sem dependência de UI.
 * Dashboard/admin importam daqui; workers futuros podem reutilizar os mesmos módulos.
 */

export { AGENT_RUNTIME_CONTRACT_VERSION } from "./version";
export {
  listAgentsForTenant,
  getAgentByIdForTenant,
  /** @deprecated preferir `listAgentsForTenant` */
  getMockAgentsForClient,
} from "./registry";
export { buildTemplateAgentsForTenant } from "./template-agents";
export { agentFromWizardDraft, agentFromWizardDraftUpdate } from "./from-wizard";
export { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from "./default-system-prompt-template";
export {
  AGENT_OBJECTIVE_OPTIONS,
  agentObjectiveLabel,
  createPromptFromBusiness,
  defaultWizardDraft,
  draftFromAgent,
  getWizardOrigin,
  normalizeOrigensForWizard,
  validateCompactAgentDraft,
  type AgentWizardDraft,
} from "./wizard-model";
export {
  normalizeAgentResponseMode,
  normalizeAgentVoiceId,
  sanitizeAgentResponseSettings,
  validateAgentResponseSettings,
  type AgentResponseMode,
} from "./response-settings";
