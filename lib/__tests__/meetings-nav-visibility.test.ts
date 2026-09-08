/**
 * Visibilidade do item de menu.
 *
 * A flag de liberação vive no servidor; a sidebar é componente de cliente. Sem
 * amarrar as duas, o item aparece para TODA conta e leva a uma tela em que cada
 * chamada devolve 404 — pior do que o recurso não existir, porque parece
 * quebrado em vez de indisponível.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardNavPinnedItems } from "@/components/dashboard/navigation";
import { organizationRoleCanAccessDashboardRoute } from "@/lib/organization-role";

vi.mock("@/lib/server/client-session-guard", () => ({
  requireActiveClientSession: vi.fn(),
}));

const { isMeetingsEnabledForTenant } = await import("@/lib/server/meetings-route-guard");

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Reproduz a decisão do layout: quais rotas ficam escondidas para este tenant. */
function hiddenRouteKeys(tenantId: string): string[] {
  return isMeetingsEnabledForTenant(tenantId) ? [] : ["reunioes"];
}

/** Reproduz o filtro da sidebar. */
function visibleRouteKeys(tenantId: string, role: "owner" | "seller" = "owner"): string[] {
  const hidden = hiddenRouteKeys(tenantId);
  return dashboardNavPinnedItems
    .filter(
      (item) =>
        organizationRoleCanAccessDashboardRoute(role, item.routeKey) &&
        !hidden.includes(item.routeKey),
    )
    .map((item) => item.routeKey);
}

describe("item Reuniões na sidebar", () => {
  it("some para conta fora do piloto", () => {
    vi.stubEnv("MEETINGS_ENABLED", "0");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "tenant-mychatcrm-owner");
    // O cliente pagante nao pode ver um menu que so devolve 404.
    expect(visibleRouteKeys("tenant-afb206912f96")).not.toContain("reunioes");
  });

  it("aparece para a conta do piloto", () => {
    vi.stubEnv("MEETINGS_ENABLED", "0");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "tenant-mychatcrm-owner");
    expect(visibleRouteKeys("tenant-mychatcrm-owner")).toContain("reunioes");
  });

  it("some para todos quando o modulo esta desligado sem lista", () => {
    vi.stubEnv("MEETINGS_ENABLED", "0");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "");
    expect(visibleRouteKeys("tenant-mychatcrm-owner")).not.toContain("reunioes");
    expect(visibleRouteKeys("tenant-afb206912f96")).not.toContain("reunioes");
  });

  it("aparece para todos na liberacao geral", () => {
    vi.stubEnv("MEETINGS_ENABLED", "1");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "");
    expect(visibleRouteKeys("tenant-afb206912f96")).toContain("reunioes");
  });

  it("respeita o papel: vendedor liberado ve o item", () => {
    vi.stubEnv("MEETINGS_ENABLED", "1");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "");
    expect(visibleRouteKeys("tenant-a", "seller")).toContain("reunioes");
  });

  it("esconder Reunioes nao derruba nenhum outro item do menu", () => {
    vi.stubEnv("MEETINGS_ENABLED", "0");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "");
    const comModulo = dashboardNavPinnedItems
      .filter((item) => organizationRoleCanAccessDashboardRoute("owner", item.routeKey))
      .map((item) => item.routeKey);
    const semModulo = visibleRouteKeys("tenant-a");
    expect(semModulo).toEqual(comModulo.filter((key) => key !== "reunioes"));
  });
});
