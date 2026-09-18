import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveClientSessionMock, resolveAccessScopeMock } = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  resolveAccessScopeMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({
  requireActiveClientSession: requireActiveClientSessionMock,
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn(() => ({ tag: "sb" })) }));
vi.mock("@/lib/server/access-scope", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/access-scope")>(
    "@/lib/server/access-scope",
  );
  return { ...actual, resolveAccessScope: resolveAccessScopeMock };
});

import { actorLabel, requireCentralAccess } from "@/lib/server/meta-lead-central-guard";

beforeEach(() => {
  requireActiveClientSessionMock.mockReset();
  resolveAccessScopeMock.mockReset();
  resolveAccessScopeMock.mockResolvedValue({ kind: "all" });
});

describe("requireCentralAccess", () => {
  it("repassa a recusa da sessão", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Não autenticado." }, { status: 401 }),
    });

    const guard = await requireCentralAccess();
    expect(guard.ok).toBe(false);
  });

  /**
   * O middleware só valida papel em `/dashboard/*`. Sem esta checagem na API, um
   * vendedor autenticado lia nome, telefone e e-mail de todos os leads do
   * tenant só chamando a rota — mesmo sem a página aparecer no menu dele.
   */
  it("bloqueia vendedor com 403, mesmo autenticado", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-1", employeeId: "emp-1", organizationRole: "seller" },
    });

    const guard = await requireCentralAccess();
    expect(guard.ok).toBe(false);
    if (!guard.ok) {
      expect(guard.response.status).toBe(403);
      const body = (await guard.response.json()) as { code?: string };
      expect(body.code).toBe("FORBIDDEN_ROUTE");
    }
  });

  it("colaborador sem papel declarado é tratado como vendedor", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-1", employeeId: "emp-1" },
    });

    const guard = await requireCentralAccess();
    expect(guard.ok).toBe(false);
  });

  it("gerente entra com o recorte por equipe resolvido", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-1", employeeId: "emp-2", organizationRole: "manager" },
    });
    resolveAccessScopeMock.mockResolvedValue({ kind: "teams", teamIds: ["team-1"] });

    const guard = await requireCentralAccess();
    expect(guard.ok).toBe(true);
    if (guard.ok) {
      expect(guard.scope).toEqual({ kind: "teams", teamIds: ["team-1"] });
      // Investimento e CPL são dados do negócio do cliente: só o titular vê.
      expect(guard.canSeeSpend).toBe(false);
    }
  });

  it("titular entra sem recorte e com acesso ao investimento", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant-1" },
    });

    const guard = await requireCentralAccess();
    expect(guard.ok).toBe(true);
    if (guard.ok) {
      expect(guard.scope).toEqual({ kind: "all" });
      expect(guard.canSeeSpend).toBe(true);
    }
  });
});

describe("actorLabel", () => {
  it("usa o colaborador quando existe", () => {
    expect(actorLabel({ tenantId: "t", employeeId: "emp-7" } as never)).toBe("emp-7");
  });

  it("cai para owner na sessão do titular", () => {
    expect(actorLabel({ tenantId: "t" } as never)).toBe("owner");
  });
});
