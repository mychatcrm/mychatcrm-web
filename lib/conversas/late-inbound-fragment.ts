/**
 * A late fragment was authored before the last committed agent response but
 * reached MyChatCRM afterwards. It is persisted for audit/history, but it must
 * never create an isolated automatic reply or mutate the agenda after that
 * response. The rule is transport-only and independent of language or niche.
 */
export function shouldSuppressLateInboundFragment(params: {
  isLateFragment: boolean;
  kind: string;
  content: string;
}): boolean {
  return params.isLateFragment;
}
