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
    expect(isMaintenanceAnonymousAllowPath("/reset-password")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/forgot-password")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/api/auth/forgot-password")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/api/auth/reset-password")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/api/debug/resend-ping")).toBe(true);
  });

  it("permite login de cliente (API e páginas) durante manutenção", () => {
    expect(isMaintenanceAnonymousAllowPath("/api/auth/client/login")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/api/auth/client/logout")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/login")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/en/login")).toBe(true);
    expect(isMaintenanceAnonymousAllowPath("/es/login")).toBe(true);
  });
});
