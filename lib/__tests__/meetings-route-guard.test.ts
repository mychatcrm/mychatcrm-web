import { afterEach, describe, expect, it, vi } from "vitest";

// `client-session-guard` puxa `client-auth-server`, que usa `cache()` do React
// — indisponivel fora do runtime do Next. Esta suite cobre a politica de
// liberacao e o mapeamento de erro, nao a leitura de sessao.
vi.mock("@/lib/server/client-session-guard", () => ({
  requireActiveClientSession: vi.fn(),
}));

const { isMeetingsEnabledForTenant, meetingRouteError } = await import(
  "@/lib/server/meetings-route-guard"
);
import { MeetingQuotaExceededError } from "@/lib/server/meeting-quota";
import { computeMeetingQuotaState } from "@/lib/meetings/plan-limits";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("liberação do módulo", () => {
  it("fica desligado por padrão", () => {
    vi.stubEnv("MEETINGS_ENABLED", "");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "");
    expect(isMeetingsEnabledForTenant("tenant-a")).toBe(false);
  });

  it("liga para todos com MEETINGS_ENABLED=1", () => {
    vi.stubEnv("MEETINGS_ENABLED", "1");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "");
    expect(isMeetingsEnabledForTenant("tenant-a")).toBe(true);
  });

  it("a lista por tenant tem precedência sobre a flag global", () => {
    // É o que permite o piloto interno: ligar só para uma conta, mesmo com a
    // flag global ainda desligada — e não vazar para as demais se alguém ligar
    // a global por engano.
    vi.stubEnv("MEETINGS_ENABLED", "1");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "tenant-piloto");
    expect(isMeetingsEnabledForTenant("tenant-piloto")).toBe(true);
    expect(isMeetingsEnabledForTenant("tenant-a")).toBe(false);
  });

  it("ignora espaços e entradas vazias na lista", () => {
    vi.stubEnv("MEETINGS_ENABLED", "");
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", " tenant-a , , tenant-b ");
    expect(isMeetingsEnabledForTenant("tenant-a")).toBe(true);
    expect(isMeetingsEnabledForTenant("tenant-b")).toBe(true);
    expect(isMeetingsEnabledForTenant("tenant-c")).toBe(false);
  });

  it("não liga com valores parecidos com verdadeiro", () => {
    vi.stubEnv("MEETINGS_ENABLED_TENANTS", "");
    for (const value of ["true", "yes", "on", "0"]) {
      vi.stubEnv("MEETINGS_ENABLED", value);
      expect(isMeetingsEnabledForTenant("tenant-a")).toBe(false);
    }
  });
});

describe("respostas de erro", () => {
  async function bodyOf(response: Response): Promise<Record<string, unknown>> {
    return (await response.json()) as Record<string, unknown>;
  }

  it("traduz códigos conhecidos para português com o status certo", async () => {
    const cases: Array<[string, number]> = [
      ["meeting_not_found", 404],
      ["meeting_lead_not_found", 404],
      ["meeting_mime_type_not_supported", 400],
      ["meeting_upload_already_finished", 409],
      ["meeting_file_too_large", 413],
      ["meeting_upload_object_missing", 422],
    ];
    for (const [code, status] of cases) {
      const response = meetingRouteError(new Error(code));
      expect(response.status).toBe(status);
      const body = await bodyOf(response);
      expect(String(body.error)).not.toBe("");
      expect(body.code).toBe(code);
    }
  });

  it("responde 404 — não 403 — quando a chave sai do prefixo do tenant", async () => {
    // Confirmar que o registro existe já seria vazamento entre empresas.
    const response = meetingRouteError(new Error("meeting_storage_key_outside_tenant"));
    expect(response.status).toBe(404);
    expect(String((await bodyOf(response)).error)).toContain("não encontrada");
  });

  it("não vaza mensagem interna em erro desconhecido", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = meetingRouteError(new Error('relation "meetings" does not exist'));
    expect(response.status).toBe(500);
    const body = await bodyOf(response);
    expect(String(body.error)).not.toContain("relation");
    expect(body.code).toBeUndefined();
  });

  it("devolve 429 com o saldo quando a cota acabou", async () => {
    const state = computeMeetingQuotaState({ plan: "solo", usedSeconds: 999_999 });
    const response = meetingRouteError(new MeetingQuotaExceededError(state));
    expect(response.status).toBe(429);
    const body = await bodyOf(response);
    expect(body.code).toBe("MEETING_QUOTA_EXCEEDED");
    expect((body.quota as Record<string, number>).remainingSeconds).toBe(0);
  });

  it("trata valor lançado que não é Error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = meetingRouteError("string solta");
    expect(response.status).toBe(500);
  });
});
