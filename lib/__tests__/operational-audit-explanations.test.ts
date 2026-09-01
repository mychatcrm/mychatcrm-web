import { describe, expect, it } from "vitest";
import {
  auditActorLabel,
  auditSeverityLabel,
  auditStatusLabel,
  explainOperationalAuditEvent,
  type ExplainableAuditEvent,
} from "@/lib/operational-audit-explanations";

function event(overrides: Partial<ExplainableAuditEvent> = {}): ExplainableAuditEvent {
  return {
    module: "runtime.watchdog",
    action: "check.completed",
    status: "completed",
    severity: "info",
    is_critical: false,
    actor_type: "system",
    result_code: "runtime_healthy",
    ...overrides,
  };
}

describe("operational audit explanations", () => {
  it("explains a healthy watchdog check in plain Portuguese", () => {
    const explanation = explainOperationalAuditEvent(event());
    expect(explanation.title).toBe("Verificação concluída sem problemas");
    expect(explanation.summary).toContain("não encontrou falhas críticas");
    expect(explanation.resultLabel).toBe("Sistema dos agentes funcionando normalmente");
    expect(explanation.recommendedAction).toContain("Nenhuma ação");
  });

  it("clearly explains a critical failure and recommends investigation", () => {
    const explanation = explainOperationalAuditEvent(event({
      status: "error",
      severity: "critical",
      is_critical: true,
      result_code: "operational_audit_unhealthy",
    }));
    expect(explanation.title).toBe("Monitor encontrou um problema");
    expect(explanation.impact).toContain("classificada como crítica");
    expect(explanation.recommendedAction).toContain("Trace ID");
  });

  it("explains database lifecycle events with module-specific meaning", () => {
    const explanation = explainOperationalAuditEvent(event({
      module: "agent.outbound.outbox",
      action: "update",
      status: "completed",
      result_code: "sent",
    }));
    expect(explanation.title).toBe("Atualização registrada: Envio automático");
    expect(explanation.summary).toContain("um envio automático");
    expect(explanation.moduleDescription).toContain("autoriza e envia mensagens");
    expect(explanation.resultLabel).toBe("Envio confirmado");
  });

  it("always provides a readable fallback for future modules and actions", () => {
    const explanation = explainOperationalAuditEvent(event({
      module: "future.payment.worker",
      action: "invoice.reconciled",
      status: "completed",
      result_code: "invoice_consistent",
      actor_type: "worker",
    }));
    expect(explanation.title).toBe("Invoice reconciled");
    expect(explanation.summary).toContain("O MyChatCRM registrou uma ação");
    expect(explanation.moduleLabel).toBe("Future payment processador");
    expect(explanation.resultLabel).toBe("Invoice consistent");
    expect(explanation.actorLabel).toBe("Processador automático");
  });

  it("translates filter labels", () => {
    expect(auditActorLabel("administrator")).toBe("Administrador");
    expect(auditStatusLabel("blocked")).toBe("Bloqueado");
    expect(auditSeverityLabel("warning")).toBe("Atenção");
  });
});
