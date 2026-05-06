import { describe, expect, it } from "vitest";
import { surfacePostgrestForAdminUi } from "@/lib/server/admin-ia-data-plane-errors";

/**
 * Smoke lógico (sem rede): respostas seguras para health/admin alinhadas ao contrato do hub IA.
 */
describe("OmniChat IA hub — superfície de erros Supabase", () => {
  it("não expõe mensagens cruas de permission denied", () => {
    const surf = surfacePostgrestForAdminUi('permission denied for table "x"', "42501");
    expect(surf.headline.toLowerCase()).not.toContain("permission");
    expect(surf.headline.toLowerCase()).not.toContain("table");
  });

  it("mapeia erros [supabase/server] sem repetir nomes de variáveis no título", () => {
    const surf = surfacePostgrestForAdminUi(
      '[supabase/server] env "SUPABASE_SERVICE_ROLE_KEY" inválida',
      null,
    );
    expect(surf.headline.length).toBeGreaterThan(10);
    expect(surf.headline).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(surf.headline).not.toContain("NEXT_PUBLIC");
  });
});
