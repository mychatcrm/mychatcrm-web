import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveClientSessionMock, createSupabaseServiceClientMock } = vi.hoisted(() => ({
  requireActiveClientSessionMock: vi.fn(),
  createSupabaseServiceClientMock: vi.fn(),
}));

vi.mock("@/lib/server/client-session-guard", () => ({
  requireActiveClientSession: requireActiveClientSessionMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: createSupabaseServiceClientMock,
}));

import { DELETE } from "@/app/api/client/whatsapp-campaigns/[id]/route";

/**
 * Excluir tem que EXCLUIR.
 *
 * A rota antiga só marcava `status = 'cancelled'` e ainda filtrava por
 * status. O resultado na tela: o botão "Excluir" (que avisa "não dá pra
 * desfazer") deixava o card lá pra sempre, morto; e como editar apaga a
 * antiga e recria, o cliente terminava com duas cópias — uma delas
 * eternamente "Cancelado". Foi assim que o bug apareceu em produção.
 */

function makeSb(options: { deleted: boolean; onCall: (op: string, args?: unknown) => void }) {
  return {
    from: (table: string) => {
      options.onCall(`from:${table}`);
      const builder: Record<string, unknown> = {};
      builder.delete = () => {
        options.onCall("delete");
        return builder;
      };
      builder.update = (patch: unknown) => {
        options.onCall("update", patch);
        return builder;
      };
      builder.eq = () => builder;
      builder.in = (_col: string, statuses: unknown) => {
        options.onCall("in", statuses);
        return builder;
      };
      builder.select = () => builder;
      builder.maybeSingle = async () => ({
        data: options.deleted ? { id: "camp-1" } : null,
        error: null,
      });
      return builder;
    },
  };
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

const req = new Request("https://example.test", { method: "DELETE" });

describe("DELETE /api/client/whatsapp-campaigns/[id]", () => {
  beforeEach(() => {
    requireActiveClientSessionMock.mockReset();
    createSupabaseServiceClientMock.mockReset();
    requireActiveClientSessionMock.mockResolvedValue({ ok: true, session: { tenantId: "tenant-1" } });
  });

  it("APAGA a linha — não marca como cancelada", async () => {
    const calls: string[] = [];
    createSupabaseServiceClientMock.mockReturnValue(
      makeSb({ deleted: true, onCall: (op) => calls.push(op) }),
    );

    const res = await DELETE(req, ctx("camp-1"));

    expect(res.status).toBe(200);
    expect(calls).toContain("delete");
    // O bug era exatamente este: um update de status no lugar do delete.
    expect(calls).not.toContain("update");
  });

  it("não filtra por status — pausado e concluído também podem ser excluídos", async () => {
    // O filtro antigo (`draft/scheduled/processing`) devolvia 404 justo nos
    // estados em que o cliente mais quer limpar a tela.
    const calls: string[] = [];
    createSupabaseServiceClientMock.mockReturnValue(
      makeSb({ deleted: true, onCall: (op) => calls.push(op) }),
    );

    await DELETE(req, ctx("camp-1"));

    expect(calls).not.toContain("in");
  });

  it("404 quando a campanha não é do tenant", async () => {
    createSupabaseServiceClientMock.mockReturnValue(makeSb({ deleted: false, onCall: () => {} }));
    const res = await DELETE(req, ctx("camp-de-outro"));
    expect(res.status).toBe(404);
  });

  it("401 sem sessão", async () => {
    requireActiveClientSessionMock.mockResolvedValue({
      ok: false,
      response: Response.json({ error: "Não autenticado." }, { status: 401 }),
    });
    const res = await DELETE(req, ctx("camp-1"));
    expect(res.status).toBe(401);
  });
});
