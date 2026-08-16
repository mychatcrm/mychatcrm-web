/**
 * Quem é agente de Disparos, em um lugar só.
 *
 * Agente de Disparos e agente de atendimento são coisas separadas de propósito:
 * o primeiro resgata base antiga com prompt próprio, o segundo atende lead novo.
 * Eles não podem se misturar — nem na cota do plano, nem nos dropdowns, nem nas
 * regras de distribuição.
 *
 * A marca vive em `tenant_agents.metadata.isBroadcastAgent`, NÃO num prefixo de
 * `agent_id`. O primeiro agente nasce com o id fixo `disparos-default`, mas a
 * partir do segundo os ids são gerados — casar por prefixo de string quebraria
 * silenciosamente e deixaria um agente de disparos passar por normal (ou o
 * contrário), que é exatamente o vazamento que esta separação existe para
 * impedir.
 *
 * Sem migration: `metadata` já é jsonb e `rowToAgent` espalha o conteúdo.
 */
import "server-only";

/** Chave única no metadata. Mudar isto exige migração de dados. */
export const BROADCAST_AGENT_METADATA_KEY = "isBroadcastAgent";

/**
 * Id do primeiro agente de Disparos de cada tenant.
 *
 * Continua fixo por compatibilidade: agentes criados antes desta separação
 * existem com este id e sem a marca no metadata, e precisam continuar sendo
 * reconhecidos.
 */
export const DISPAROS_DEFAULT_AGENT_ID = "disparos-default";

/**
 * `true` quando o metadata marca o agente como de Disparos.
 *
 * Aceita `unknown` porque a origem é jsonb do banco — nunca confiar no formato.
 */
export function isBroadcastAgentMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  return (metadata as Record<string, unknown>)[BROADCAST_AGENT_METADATA_KEY] === true;
}

/**
 * `true` para qualquer agente de Disparos, incluindo os criados antes da marca
 * existir (reconhecidos pelo id fixo herdado).
 */
export function isBroadcastAgentRow(row: {
  agent_id?: unknown;
  metadata?: unknown;
}): boolean {
  if (row.agent_id === DISPAROS_DEFAULT_AGENT_ID) return true;
  return isBroadcastAgentMetadata(row.metadata);
}

/**
 * Projeção enxuta para contagem: `metadata` completo carrega o prompt de cada
 * agente, e puxar isso só para contar seria desperdício num caminho que roda a
 * cada gravação de agente.
 *
 * Use com `.select("agent_id, isBroadcastAgent:metadata->>isBroadcastAgent")` —
 * o PostgREST devolve o valor como texto, daí a comparação com a string.
 */
export const BROADCAST_AGENT_COUNT_SELECT =
  "agent_id, isBroadcastAgent:metadata->>isBroadcastAgent" as const;

export function isBroadcastAgentProjection(row: {
  agent_id?: unknown;
  isBroadcastAgent?: unknown;
}): boolean {
  if (row.agent_id === DISPAROS_DEFAULT_AGENT_ID) return true;
  return row.isBroadcastAgent === "true" || row.isBroadcastAgent === true;
}
