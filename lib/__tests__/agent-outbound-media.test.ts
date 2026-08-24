import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractMediaFilenames,
  resolveOutboundMediaForAgentResponse,
  stripMediaTags,
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

describe("extractMediaFilenames / stripMediaTags", () => {
  it("returns empty array when there are no tags", () => {
    expect(extractMediaFilenames("Olá, segue a informação.")).toEqual([]);
    expect(stripMediaTags("Olá, segue a informação.")).toBe("Olá, segue a informação.");
  });

  it("extracts one tag and strips it from visible text", () => {
    const text = "Segue a foto:\n[[ENVIAR_MEDIA:fachada.jpg]]\n";
    expect(extractMediaFilenames(text)).toEqual(["fachada.jpg"]);
    expect(stripMediaTags(text)).toBe("Segue a foto:");
    expect(stripMediaTags(text)).not.toContain("ENVIAR_MEDIA");
  });

  it("extracts three tags in order", () => {
    const text = [
      "A:",
      "[[ENVIAR_MEDIA:a.jpg]]",
      "B:",
      "[[ENVIAR_MEDIA:b.png]]",
      "C:",
      "[[ENVIAR_MEDIA:c.pdf]]",
    ].join("\n");
    expect(extractMediaFilenames(text)).toEqual(["a.jpg", "b.png", "c.pdf"]);
  });

  it("trims spaces inside tags and tolerates varied casing", () => {
    const text = "[[enviar_media:  spa.jpg ]]\n[[ENVIAR_MEDIA:Piscina.JPG]]";
    expect(extractMediaFilenames(text)).toEqual(["spa.jpg", "Piscina.JPG"]);
    const stripped = stripMediaTags(`${text}\n\n\n\nRodapé`);
    expect(stripped).not.toMatch(/ENVIAR_MEDIA/i);
    expect(stripped).toBe("Rodapé");
  });

  it("stripOutboundMediaDirectives keeps only intro text when multiple tags are interleaved", () => {
    const parsed = stripOutboundMediaDirectives(
      "Claro! Aqui estão as fotos 👇\n[[ENVIAR_MEDIA:spa.jpg]]\nE a piscina:\n[[ENVIAR_MEDIA:piscina.jpg]]\n",
    );
    expect(parsed.filenames).toEqual(["spa.jpg", "piscina.jpg"]);
    expect(parsed.cleanedText).toBe("Claro! Aqui estão as fotos 👇");
    expect(parsed.cleanedText).not.toContain("piscina");
    expect(parsed.cleanedText).not.toContain("ENVIAR_MEDIA");
  });

  it("stripOutboundMediaDirectives deduplicates repeated filenames before sending", () => {
    const parsed = stripOutboundMediaDirectives(
      "Segue 👇\n[[ENVIAR_MEDIA:piscina.jpg]]\n[[ENVIAR_MEDIA:spa.jpg]]\n[[ENVIAR_MEDIA:piscina.jpg]]\n",
    );

    expect(parsed.filenames).toEqual(["piscina.jpg", "spa.jpg"]);
    expect(parsed.cleanedText).toBe("Segue 👇");
  });
});

describe("agent outbound media helpers", () => {
  it("never infers a file or overwrites the configured reply", async () => {
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
      structuredFilenames: [],
    });

    expect(resolved.inferred).toBe(false);
    expect(resolved.cleanedText).toBe("Não posso enviar fotos por aqui.");
    expect(resolved.filenames).toEqual([]);
  });

  it("uses only exact filenames selected by the structured contract", async () => {
    const resolved = await resolveOutboundMediaForAgentResponse({
      tenantId: "tenant-1",
      agentId: "agent-1",
      responseText: "Here is the requested material.",
      userRequestText: "Send it",
      structuredFilenames: ["global-catalog.json", "global-catalog.json"],
    });
    expect(resolved.cleanedText).toBe("Here is the requested material.");
    expect(resolved.filenames).toEqual(["global-catalog.json"]);
  });

  it("deduplicates repeated media directives when resolving a response", async () => {
    const resolved = await resolveOutboundMediaForAgentResponse({
      tenantId: "tenant-1",
      agentId: "agent-1",
      responseText: [
        "Aqui estão os arquivos 👇",
        "[[ENVIAR_MEDIA:piscina.jpg]]",
        "[[ENVIAR_MEDIA:piscina.jpg]]",
        "[[ENVIAR_MEDIA:spa.jpg]]",
      ].join("\n"),
      userRequestText: "Quero fotos da piscina e do spa",
    });

    expect(resolved.inferred).toBe(false);
    expect(resolved.filenames).toEqual(["piscina.jpg", "spa.jpg"]);
  });
});
