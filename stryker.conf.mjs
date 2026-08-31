/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  mutate: [
    // Critical policy surfaces only: explicit timezone and agenda values,
    // follow-up hard stops, tenant kill switches and final outbox authorization.
    // Presentation strings and optional context shaping are exercised by the
    // normal 2k+ suite but are deliberately outside the critical 90% gate.
    "lib/agents/agent-datetime.ts:11-49",
    "lib/ai/agent-turn-plan.ts:177-207",
    "lib/server/follow-up-engine.ts:190-211",
    "lib/server/agent-runtime-controls.ts:35-68",
    "lib/server/agent-outbound-outbox.ts:48-81",
  ],
  reporters: ["clear-text", "progress", "json"],
  jsonReporter: {
    fileName: "reports/mutation/critical.json",
  },
  thresholds: {
    high: 90,
    low: 90,
    break: 90,
  },
  timeoutMS: 60_000,
  timeoutFactor: 1.5,
  concurrency: 4,
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
  vitest: {
    configFile: "vitest.config.ts",
  },
};
