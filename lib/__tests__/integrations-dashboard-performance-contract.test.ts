import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("contrato de abertura rápida de /dashboard/integracoes", () => {
  it("status Meta inicial é DB-only", () => {
    const source = read("app/api/client/meta/status/route.ts");
    expect(source).toContain("loadIntegrationsDashboardSnapshot");
    expect(source).not.toContain("metaGraphRequest");
    expect(source).not.toContain("leadgen_forms");
  });

  it("hub não faz polling global nem status Cloud por slot", () => {
    const source = read("components/dashboard/integrations/IntegracoesHub.tsx");
    expect(source).toContain("initialSnapshot");
    expect(source).not.toContain("setInterval(() => void loadConnections(), 5_000)");
    expect(source).not.toContain("/api/client/whatsapp-cloud/status?slotIndex=");
  });

  it("Evolution só polla durante estado transitório", () => {
    const source = read("components/dashboard/integrations/EvolutionQrSlotPanel.tsx");
    expect(source).toContain("if (!timeSensitive) return");
    expect(source).not.toContain("20_000");
  });

  it("listagem de conexões elimina o N+1 de provider", () => {
    const source = read("lib/server/tenant-whatsapp-connections.ts");
    expect(source).toContain("tenant_whatsapp_slot_state");
    expect(source).not.toContain("getSlotActiveProvider");
  });
});
