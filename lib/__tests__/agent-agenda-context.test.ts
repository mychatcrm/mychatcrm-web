import { describe, expect, it } from "vitest";
import {
  buildAgentAgendaContextBlock,
  formatAgentAgendaContextBlock,
  normalizeAgendaAttendeePhone,
} from "@/lib/server/agent-agenda-context";

function makeSb(params: {
  future?: Record<string, unknown>[];
  past?: Record<string, unknown>[];
  calls?: { filters: [string, unknown][]; range: "future" | "past" | null; limit: number | null }[];
}) {
  return {
    from: () => ({
      select: () => {
        const call = { filters: [] as [string, unknown][], range: null as "future" | "past" | null, limit: null as number | null };
        params.calls?.push(call);
        const chain = {
          eq(column: string, value: unknown) {
            call.filters.push([column, value]);
            return chain;
          },
          neq(column: string, value: unknown) {
            call.filters.push([`${column}!=`, value]);
            return chain;
          },
          gte() {
            call.range = "future";
            return chain;
          },
          lt() {
            call.range = "past";
            return chain;
          },
          order() {
            return chain;
          },
          async limit(limit: number) {
            call.limit = limit;
            return { data: call.range === "future" ? params.future ?? [] : params.past ?? [], error: null };
          },
        };
        return chain;
      },
    }),
  };
}

describe("agent agenda context", () => {
  it("normalizes WhatsApp JID and rejects invalid phones", () => {
    expect(normalizeAgendaAttendeePhone("5562999999999@s.whatsapp.net")).toBe("5562999999999");
    expect(normalizeAgendaAttendeePhone("123")).toBeNull();
  });

  it("formats future and past appointments compactly", () => {
    const block = formatAgentAgendaContextBlock({
      timezone: "America/Sao_Paulo",
      futureEvents: [
        {
          title: "Reunião comercial",
          start_at: "2026-06-02T15:00:00.000Z",
          end_at: "2026-06-02T16:00:00.000Z",
          status: "confirmed",
          location: "Sala 2",
        },
      ],
      pastEvents: [
        {
          title: "Primeiro contato",
          start_at: "2026-05-20T15:00:00.000Z",
          end_at: "2026-05-20T16:00:00.000Z",
          status: "confirmed",
          location: null,
        },
      ],
    });

    expect(block).toContain("CONTEXTO DE AGENDA DO CONTATO");
    expect(block).toContain("Reunião comercial");
    expect(block).toContain("Sala 2");
    expect(block).toContain("Agendamentos anteriores");
    expect(block).toContain("Primeiro contato");
  });

  it("filters by tenant and phone and limits both query windows", async () => {
    const calls: { filters: [string, unknown][]; range: "future" | "past" | null; limit: number | null }[] = [];
    const sb = makeSb({ calls });

    await buildAgentAgendaContextBlock({
      tenantId: "tenant-1",
      remoteJid: "5562999999999@s.whatsapp.net",
      timezone: "America/Sao_Paulo",
      sb: sb as never,
      now: new Date("2026-06-01T12:00:00.000Z"),
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.filters).toContainEqual(["tenant_id", "tenant-1"]);
      expect(call.filters).toContainEqual(["attendee_phone", "5562999999999"]);
      expect(call.filters).toContainEqual(["status!=", "cancelled"]);
      expect(call.limit).toBe(3);
    }
    expect(calls.map((call) => call.range).sort()).toEqual(["future", "past"]);
  });
});
