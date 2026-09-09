import { labPhoneJid } from "./policy";
export function acceptsLabInbound(input: { fromMe: boolean; providerTime: string | null; remoteJid: string;
  targetJid: string; runCreatedAt: string; deadlineAt: string; now: number }): boolean {
  if (input.fromMe || !labPhoneJid(input.remoteJid) || labPhoneJid(input.remoteJid) !== labPhoneJid(input.targetJid)) return false;
  const occurred = input.providerTime ? Date.parse(input.providerTime) : NaN;
  const created = Date.parse(input.runCreatedAt), deadline = Date.parse(input.deadlineAt);
  // Missing provider timestamp is not enough evidence to import a history sync.
  return Number.isFinite(occurred) && Number.isFinite(created) && Number.isFinite(deadline) &&
    occurred >= created && occurred <= input.now + 30000 && input.now <= deadline;
}
