/**
 * Compatibilidade: a primitiva de move deixou de ser exclusiva da agenda
 * (passou a atender também a primeira resposta do lead) e mudou de casa para
 * `lib/server/agent-crm-move.ts`.
 *
 * Este arquivo reexporta os nomes antigos para os chamadores já existentes em
 * `agent-cta-scheduler.ts` continuarem funcionando sem alteração.
 */
export {
  applyAgentCrmMove as applyAgendaCrmMove,
  resolveAgentCrmMoveTarget as resolveAgendaCrmMoveTarget,
  type AgentCrmMoveAction as AgendaCrmMoveAction,
  type AgentCrmMoveTarget as AgendaCrmMoveTarget,
} from "@/lib/server/agent-crm-move";
