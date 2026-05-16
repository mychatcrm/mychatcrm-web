import { describe, expect, it } from "vitest";
import {
  inferOutboundMediaFilenamesForRequest,
  isLikelyOutboundMediaRequest,
  looksLikeOutboundMediaRefusal,
  resolveOutboundMediaForAgentResponse,
  stripOutboundMediaDirectives,
} from "@/lib/server/agent-media-files";

function fakeSupabaseWithMedia(rows: Array<Record<string, unknown>>) {
  return {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => ({ data: rows, error: null }),
      };
      return chain;
    },
  } as never;
}

describe("agent outbound media helpers", () => {
  it("extracts every ENVIAR_MEDIA tag in order and strips all from text", () => {
    const parsed = stripOutboundMediaDirectives(
      "Aqui está o SPA:\n[[ENVIAR_MEDIA:spa.jpg]]\nE a piscina:\n[[ENVIAR_MEDIA:piscina.jpg]]\n",
    );
    expect(parsed.filenames).toEqual(["spa.jpg", "piscina.jpg"]);
    expect(parsed.cleanedText).not.toContain("ENVIAR_MEDIA");
    expect(parsed.cleanedText).toContain("SPA");
    expect(parsed.cleanedText).toContain("piscina");
  });

  it("detects media requests and media refusal text", () => {
    expect(isLikelyOutboundMediaRequest("Pode me enviar as fotos?")).toBe(true);
    expect(isLikelyOutboundMediaRequest("Qual é o horário de atendimento?")).toBe(false);
    expect(looksLikeOutboundMediaRefusal("Não posso enviar fotos por aqui.")).toBe(true);
  });

  it("infers a ready image filename when the user asks for photos", async () => {
    const filenames = await inferOutboundMediaFilenamesForRequest({
      sb: fakeSupabaseWithMedia([
        {
          original_filename: "fachada-residencial.jpg",
          description: "Foto da fachada",
          mime_type: "image/jpeg",
        },
        {
          original_filename: "tabela.pdf",
          description: "Tabela de valores",
          mime_type: "application/pdf",
        },
      ]),
      tenantId: "tenant-1",
      agentId: "agent-1",
      requestText: "Me manda fotos da fachada",
    });

    expect(filenames).toEqual(["fachada-residencial.jpg"]);
  });

  it("replaces model refusal with a sendable media response", async () => {
    const resolved = await resolveOutboundMediaForAgentResponse({
      sb: fakeSupabaseWithMedia([
        {
          original_filename: "decorado.png",
          description: "Foto do decorado",
          mime_type: "image/png",
        },
      ]),
      tenantId: "tenant-1",
      agentId: "agent-1",
      responseText: "Não posso enviar fotos por aqui.",
      userRequestText: "Tem foto do decorado?",
    });

    expect(resolved.inferred).toBe(true);
    expect(resolved.cleanedText).toBe("Claro, vou te enviar agora.");
    expect(resolved.filenames).toEqual(["decorado.png"]);
  });
});
