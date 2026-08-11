import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import {
  clearMaintenanceSnapshotCache,
  fetchMaintenanceSnapshot,
} from "../maintenance-middleware-snapshot";

/**
 * Este snapshot é lido em TODA requisição de dashboard/API pelo middleware, e
 * era a segunda maior fonte de latência da tela de Integrações (526 chamadas
 * internas em 2h). O que os testes seguram é o que torna isso barato: o cache
 * de isolate e o fato de a resposta poder ser servida pelo CDN.
 */

/** Só `nextUrl.origin` é usado pela função. */
function fakeRequest(origin = "https://app.test"): NextRequest {
  return { nextUrl: { origin } } as unknown as NextRequest;
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearMaintenanceSnapshotCache();
  fetchMock = vi.fn(async () => jsonResponse({ enabled: false }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearMaintenanceSnapshotCache();
});

describe("fetchMaintenanceSnapshot", () => {
  it("não refaz a consulta dentro da janela de cache", async () => {
    await fetchMaintenanceSnapshot(fakeRequest());
    await fetchMaintenanceSnapshot(fakeRequest());
    await fetchMaintenanceSnapshot(fakeRequest());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("não força no-store — a resposta precisa poder vir do CDN", async () => {
    await fetchMaintenanceSnapshot(fakeRequest());

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.cache).toBeUndefined();
  });

  it("lê o estado ligado com mensagem", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ enabled: true, message: "Voltamos já", estimatedReturnAt: "2026-01-01T00:00:00Z" }),
    );

    const snap = await fetchMaintenanceSnapshot(fakeRequest());

    expect(snap).toEqual({
      enabled: true,
      message: "Voltamos já",
      estimatedReturnAt: "2026-01-01T00:00:00Z",
    });
  });

  it("falha de rede assume manutenção desligada (não derruba o painel)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const snap = await fetchMaintenanceSnapshot(fakeRequest());

    expect(snap.enabled).toBe(false);
  });

  it("resposta não-ok também assume desligada", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 500 }));

    const snap = await fetchMaintenanceSnapshot(fakeRequest());

    expect(snap.enabled).toBe(false);
  });
});
