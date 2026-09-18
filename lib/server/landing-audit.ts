import "server-only";

import { appendOperationalAuditEvent } from "@/lib/server/operational-audit";

/**
 * Trilha operacional das Páginas de Captura.
 *
 * Quatro coisas aqui merecem registo e nenhuma é o CRUD: **dinheiro** (crédito
 * gasto, domínio comprado), **exposição pública** (publicar, despublicar,
 * ligar domínio) e **captação** (o lead que entrou por uma página). Quando algo
 * der errado, a pergunta vai ser "quem pôs isto no ar e quando", não "quem
 * renomeou a página".
 *
 * Nada de PII: o sanitizador do módulo de auditoria já corta telefone, e-mail e
 * conteúdo, e aqui só entram identificadores e contagens de propósito.
 */

type LandingAuditAction =
  | "page_created"
  | "page_published"
  | "page_unpublished"
  | "page_archived"
  | "version_generated"
  | "credits_spent"
  | "credits_refunded"
  | "domain_attached"
  | "domain_verified"
  | "domain_purchased"
  | "domain_removed"
  | "submission_received";

export function recordLandingAudit(params: {
  tenantId: string;
  actorType?: "customer" | "system" | "administrator";
  actorId?: string | null;
  action: LandingAuditAction;
  resourceId?: string | null;
  status?: "completed" | "blocked" | "error";
  severity?: "info" | "warning" | "error";
  resultCode?: string | null;
  idempotencyKey?: string | null;
  /** Marca o evento como crítico na auditoria — compra de domínio, por exemplo. */
  critical?: boolean;
  metadata?: Record<string, unknown>;
}): void {
  /**
   * Sem `await` de propósito: a trilha não pode atrasar a resposta ao cliente
   * nem derrubar a operação se o banco de auditoria estiver indisponível. O
   * módulo já engole os próprios erros; aqui só se garante que a promessa
   * rejeitada não vira `unhandledRejection`.
   */
  void appendOperationalAuditEvent({
    tenantId: params.tenantId,
    actorType: params.actorType ?? "customer",
    actorId: params.actorId ?? null,
    module: "landing_pages",
    action: params.action,
    resourceType: "landing_page",
    resourceId: params.resourceId ?? null,
    status: params.status ?? "completed",
    severity: params.severity ?? "info",
    critical: params.critical ?? false,
    resultCode: params.resultCode ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    metadata: params.metadata ?? {},
  }).catch(() => undefined);
}
