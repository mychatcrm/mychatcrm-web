import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const evolutionSendMedia = vi.fn(async () => ({ ok: true, status: 200, error: null }));
const evolutionSendAudio = vi.fn(async () => ({ ok: true, status: 200, error: null }));
const resolveEvolutionSendNumber = vi.fn(async ({ number }: { number: string }) => ({
  status: "exists" as const,
  sendNumber: number,
  jid: `${number}@s.whatsapp.net`,
  platformNumber: number,
  candidateNumbers: [number],
}));
const createR2PresignedGetUrl = vi.fn(async () => "https://r2.example/presigned");
const lookupReadyAgentMediaForOutbound = vi.fn(
  async ({ filename }: { filename: string }) => ({
    id: `id-${filename}`,
    tenantId: "tenant-1",
    agentId: "agent-1",
    originalFilename: filename,
    mimeType: "image/jpeg",
    sizeBytes: 100,
    storageKey: `keys/${filename}`,
    description: null,
    status: "ready" as const,
    createdAt: "",
    updatedAt: "",
  }),
);
const findReadyAgentMediaByFilenameFlexible = vi.fn(async () => null);

vi.mock("@/lib/integrations/evolution-api", () => ({
  evolutionSendMedia,
  evolutionSendAudio,
  resolveEvolutionSendNumber,
}));

vi.mock("@/lib/integrations/r2-storage", () => ({
  isR2Configured: () => true,
  createR2PresignedGetUrl,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({}),
}));

vi.mock("@/lib/server/agent-media-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/agent-media-files")>();
  return {
    ...actual,
    lookupReadyAgentMediaForOutbound,
    findReadyAgentMediaByFilenameFlexible,
  };
});

describe("sendAgentOutboundMediaViaEvolution", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    evolutionSendMedia.mockClear();
    evolutionSendAudio.mockClear();
    resolveEvolutionSendNumber.mockClear();
    createR2PresignedGetUrl.mockClear();
    lookupReadyAgentMediaForOutbound.mockClear();
    findReadyAgentMediaByFilenameFlexible.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls Evolution sendMedia once per file with delay between sends", async () => {
    const { sendAgentOutboundMediaViaEvolution } = await import(
      "@/lib/server/send-agent-outbound-media-evolution"
    );

    const sendPromise = sendAgentOutboundMediaViaEvolution({
      tenantId: "tenant-1",
      agentId: "agent-1",
      instanceName: "inst",
      number: "5511999990000",
      originalFilenames: ["a.jpg", "b.jpg", "c.jpg"],
    });

    await vi.runAllTimersAsync();
    await sendPromise;

    expect(evolutionSendMedia).toHaveBeenCalledTimes(3);
    expect(lookupReadyAgentMediaForOutbound).toHaveBeenCalledTimes(3);
    expect(createR2PresignedGetUrl).toHaveBeenCalledTimes(3);
  });
});
