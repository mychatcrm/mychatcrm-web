import { describe, expect, it } from "vitest";
import {
  defaultDashboardPathForOrganizationRole,
  organizationRoleCanAccessDashboardRoute,
  sessionCanAccessDashboardRoute,
} from "@/lib/organization-role";

/**
 * Trava o mapa de acesso por papel. Cada linha aqui é uma decisão de produto —
 * se mudar sem intenção, o teste quebra antes de ir para produção.
 */
describe("acesso a rotas do painel por papel", () => {
  const ROTAS = [
    "overview",
    "crm",
    "conversas",
    "ofertas-ativas",
    "agentes",
    "integracoes-leads",
    "disparos",
    "agenda",
    "lembretes",
    "integracoes",
    "suporte",
    "colaboradores",
    "equipes",
    "configuracoes",
  ] as const;

  const ESPERADO: Record<string, { owner: boolean; director: boolean; manager: boolean; seller: boolean }> = {
    overview: { owner: true, director: true, manager: true, seller: false },
    crm: { owner: true, director: true, manager: true, seller: true },
    // Vendedor passou a ter Conversas depois que a inbox virou recortada no servidor.
    conversas: { owner: true, director: true, manager: true, seller: true },
    "ofertas-ativas": { owner: true, director: true, manager: true, seller: true },
    agentes: { owner: true, director: true, manager: true, seller: false },
    "integracoes-leads": { owner: true, director: true, manager: true, seller: false },
    disparos: { owner: true, director: true, manager: true, seller: false },
    agenda: { owner: true, director: true, manager: true, seller: true },
    lembretes: { owner: true, director: true, manager: true, seller: true },
    integracoes: { owner: true, director: true, manager: true, seller: false },
    suporte: { owner: true, director: true, manager: true, seller: true },
    // Gestão de pessoas e de equipes é exclusiva do titular.
    colaboradores: { owner: true, director: false, manager: false, seller: false },
    equipes: { owner: true, director: false, manager: false, seller: false },
    configuracoes: { owner: true, director: false, manager: false, seller: false },
  };

  for (const rota of ROTAS) {
    it(`respeita o acesso esperado em "${rota}"`, () => {
      const esperado = ESPERADO[rota];
      expect(organizationRoleCanAccessDashboardRoute("owner", rota)).toBe(esperado.owner);
      expect(organizationRoleCanAccessDashboardRoute("director", rota)).toBe(esperado.director);
      expect(organizationRoleCanAccessDashboardRoute("manager", rota)).toBe(esperado.manager);
      expect(organizationRoleCanAccessDashboardRoute("seller", rota)).toBe(esperado.seller);
    });
  }

  it("abre Configurações para o diretor raiz (titular sem superior)", () => {
    expect(
      sessionCanAccessDashboardRoute(
        { organizationRole: "director", employeeId: "dir-1" },
        "configuracoes",
      ),
    ).toBe(true);
  });

  it("mantém Configurações fechada para diretor com superior", () => {
    expect(
      sessionCanAccessDashboardRoute(
        { organizationRole: "director", employeeId: "dir-1", reportsToEmployeeId: "dir-0" },
        "configuracoes",
      ),
    ).toBe(false);
  });

  it("não abre Equipes por ser diretor raiz — só o titular gere equipes", () => {
    expect(
      sessionCanAccessDashboardRoute({ organizationRole: "director", employeeId: "dir-1" }, "equipes"),
    ).toBe(false);
  });

  it("leva o vendedor direto para o CRM ao entrar", () => {
    expect(defaultDashboardPathForOrganizationRole("seller")).toBe("/dashboard/crm");
    expect(defaultDashboardPathForOrganizationRole("manager")).toBe("/dashboard");
  });
});
