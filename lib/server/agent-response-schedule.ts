import type { AgentSmartWaitSettings } from "@/lib/agents/smart-wait-settings";

export function computeAgentResponseSchedule(params: {
  now: Date;
  firstMessageAt: Date;
  lastMessageAt: Date;
  inboundMessageCount: number;
  settings: Pick<AgentSmartWaitSettings, "initialSeconds" | "followupSeconds" | "maxSeconds">;
}): { scheduledFor: Date; maxWaitUntil: Date } {
  const maxWaitUntil = new Date(
    params.firstMessageAt.getTime() + params.settings.maxSeconds * 1000,
  );
  const waitMs =
    (params.inboundMessageCount <= 1
      ? params.settings.initialSeconds
      : params.settings.followupSeconds) * 1000;
  const ideal = new Date(params.lastMessageAt.getTime() + waitMs);
  const scheduledFor = ideal.getTime() > maxWaitUntil.getTime() ? maxWaitUntil : ideal;
  return { scheduledFor, maxWaitUntil };
}

export function maskRemoteJidForLog(remoteJid: string): string {
  const digits = remoteJid.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `***${digits.slice(-4)}`;
}

export function isJobReadyToProcess(scheduledForIso: string, now = new Date()): boolean {
  return now.getTime() >= new Date(scheduledForIso).getTime();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
