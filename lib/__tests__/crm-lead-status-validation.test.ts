import { describe, expect, it } from "vitest";
import {
  validateLeadFunnelIdForUpdate,
  validateLeadStatusForUpdate,
} from "@/lib/server/crm-lead-status-validation";

describe("crm-lead-status-validation", () => {
  it("accepts official kanban status ids", () => {
    expect(validateLeadStatusForUpdate("novo")).toBeNull();
    expect(validateLeadStatusForUpdate("contato")).toBeNull();
  });

  it("accepts custom col-* status ids", () => {
    expect(validateLeadStatusForUpdate("col-abc123def")).toBeNull();
  });

  it("rejects unknown status ids", () => {
    expect(validateLeadStatusForUpdate("etapa-inexistente")).toBe("Status inválido.");
  });

  it("enforces allowedStatusIds when provided", () => {
    expect(validateLeadStatusForUpdate("novo", ["contato", "proposta"])).toBe(
      "Status não permitido para este funil.",
    );
    expect(validateLeadStatusForUpdate("contato", ["contato", "proposta"])).toBeNull();
  });

  it("validates funnel ids", () => {
    expect(validateLeadFunnelIdForUpdate("funil-default")).toBeNull();
    expect(validateLeadFunnelIdForUpdate("funil-abc123")).toBeNull();
    expect(validateLeadFunnelIdForUpdate("")).toBe("Funil inválido.");
    expect(validateLeadFunnelIdForUpdate("invalid")).toBe("Funil inválido.");
  });
});

describe("leadPayloadToUpdate validation contract", () => {
  it("maps funilId and status fields used by CRM migration flows", () => {
    const patch = {
      status: "contato",
      funilId: "funil-default",
    };
    expect(validateLeadStatusForUpdate(String(patch.status))).toBeNull();
    expect(validateLeadFunnelIdForUpdate(String(patch.funilId))).toBeNull();
  });
});
