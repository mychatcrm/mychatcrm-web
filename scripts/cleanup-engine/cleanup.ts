/**
 * Entrada legada: reencaminha para `executeCleanup.ts`.
 *
 *   analyze  → scan
 *   execute → safe
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), "executeCleanup.ts");
const raw = process.argv.slice(2);
const mapped: string[] = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === "analyze") mapped.push("scan");
  else if (a === "execute") mapped.push("safe");
  else mapped.push(a);
}
const r = spawnSync("npx", ["tsx", engine, ...mapped], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
