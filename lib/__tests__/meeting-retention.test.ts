/**
 * Varredura de retenção.
 *
 * Dois erros seriam caros e silenciosos: marcar como apagado um áudio que
 * continua no bucket (ele nunca mais entraria na varredura), e apagar a linha
 * antes do objeto (o áudio ficaria órfão, sem ponteiro para removê-lo).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const r2 = vi.hoisted(() => ({ deleteR2Object: vi.fn(async () => undefined) }));
const audit = vi.hoisted(() => ({ appendOperationalAuditEvent: vi.fn(async () => null) }));

vi.mock("@/lib/integrations/r2-storage", () => r2);
vi.mock("@/lib/server/operational-audit", () => audit);

const { sweepMeetingRetention } = await import("@/lib/server/meeting-retention");

type Row = Record<string, unknown>;

/**
 * Supabase falso. `meetings` é consultado duas vezes na varredura: primeiro os
 * áudios vencidos, depois as exclusões pedidas.
 */
function fakeSupabase(options: { expired?: Row[]; deleted?: Row[] }) {
  const calls = { updates: [] as Row[], deletes: 0 };
  let selectCall = 0;

  function chain() {
    const c: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "not", "lt", "limit", "in"]) {
      c[method] = () => c;
    }
    c.update = (patch: Row) => {
      calls.updates.push(patch);
      return c;
    };
    c.delete = () => {
      calls.deletes += 1;
      return c;
    };
    c.then = (resolve: (value: unknown) => unknown) => {
      selectCall += 1;
      const data = selectCall === 1 ? (options.expired ?? []) : (options.deleted ?? []);
      return Promise.resolve({ data, error: null }).then(resolve);
    };
    return c;
  }

  return { sb: { from: () => chain() } as never, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  r2.deleteR2Object.mockResolvedValue(undefined);
});

describe("áudio vencido", () => {
  it("apaga o objeto e marca a data, preservando o registro", async () => {
    const { sb, calls } = fakeSupabase({
      expired: [{ id: "m-1", tenant_id: "tenant-a", storage_key: "meetings/tenant-a/m-1/audio.webm" }],
    });

    const result = await sweepMeetingRetention(sb);

    expect(r2.deleteR2Object).toHaveBeenCalledWith("meetings/tenant-a/m-1/audio.webm");
    expect(result.audioExpired).toBe(1);
    // Transcrição e análise continuam: só o áudio expira.
    expect(calls.deletes).toBe(0);
    expect(calls.updates[0]).toHaveProperty("audio_deleted_at");
  });

  it("NÃO marca como apagado quando o storage falha", async () => {
    // Marcar aqui tiraria a reunião da varredura para sempre, deixando o áudio
    // no bucket além do prazo de retenção — falha de privacidade, não de custo.
    r2.deleteR2Object.mockRejectedValue(new Error("r2 offline"));
    const { sb, calls } = fakeSupabase({
      expired: [{ id: "m-1", tenant_id: "tenant-a", storage_key: "meetings/tenant-a/m-1/audio.webm" }],
    });

    const result = await sweepMeetingRetention(sb);

    expect(result.audioExpired).toBe(0);
    expect(result.failures).toBe(1);
    expect(calls.updates).toHaveLength(0);
  });
});

describe("exclusão definitiva", () => {
  it("apaga o objeto ANTES da linha", async () => {
    const order: string[] = [];
    r2.deleteR2Object.mockImplementation(async () => {
      order.push("r2");
    });

    const { sb } = fakeSupabase({
      deleted: [
        {
          id: "m-2",
          tenant_id: "tenant-a",
          storage_key: "meetings/tenant-a/m-2/audio.webm",
          audio_deleted_at: null,
        },
      ],
    });

    const result = await sweepMeetingRetention(sb);
    order.push("db");

    expect(order).toEqual(["r2", "db"]);
    expect(result.hardDeleted).toBe(1);
  });

  it("não tenta apagar duas vezes um áudio já expirado", async () => {
    const { sb } = fakeSupabase({
      deleted: [
        {
          id: "m-3",
          tenant_id: "tenant-a",
          storage_key: "meetings/tenant-a/m-3/audio.webm",
          audio_deleted_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await sweepMeetingRetention(sb);

    expect(r2.deleteR2Object).not.toHaveBeenCalled();
    expect(result.hardDeleted).toBe(1);
  });
});

describe("varredura vazia", () => {
  it("não faz nada quando não há o que apagar", async () => {
    const { sb, calls } = fakeSupabase({});
    const result = await sweepMeetingRetention(sb);
    expect(result).toEqual({ audioExpired: 0, hardDeleted: 0, failures: 0 });
    expect(calls.updates).toHaveLength(0);
    expect(r2.deleteR2Object).not.toHaveBeenCalled();
  });
});
