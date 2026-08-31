declare module "../../scripts/agent-runtime-watchdog.mjs" {
  export function decideWatchdogNotification(params: {
    healthy: boolean;
    now: number;
    previousRuns: Array<{ conclusion: string; created_at: string }>;
  }): "failure" | "repeat" | "recovery" | null;
}
