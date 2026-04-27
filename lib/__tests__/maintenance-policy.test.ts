import { describe, expect, it } from "vitest";
import { isMaintenanceAnonymousAllowPath, isMaintenanceStatusApiPath } from "../maintenance-policy";

describe("maintenance-policy", () => {
  it("identifica API de estado", () => {
    expect(isMaintenanceStatusApiPath("/api/maintenance/status")).toBe(true);
    expect(isMaintenanceStatusApiPath("/api/maintenance/status/extra")).toBe(false);
  });

  it("permite área admin, health e APIs admin durante manutenção anónima", () => {
    expect(isMaintenanceAnonymousAllowPath("/manutencao")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/admin")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/admin/seguranca")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/api/auth/admin/login")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/api/admin/maintenance")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/api/health")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/")).toBe(false);
    expect(isMaintenanceAnonymousAllowPath("/planos")).toBe(false);
    expect(isMaintenanceAnonymousAllowPath("/api/chat")).toBe(false);
    expect(isMaintenanceAnonymousAllowPath("/api/webhooks/stripe")).toBe(true);
  });
});
