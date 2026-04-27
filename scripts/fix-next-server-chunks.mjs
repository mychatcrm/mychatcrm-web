import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const serverDir = join(process.cwd(), ".next", "server");
const chunksDir = join(serverDir, "chunks");

if (!existsSync(serverDir) || !existsSync(chunksDir)) {
  process.exit(0);
}

mkdirSync(serverDir, { recursive: true });

for (const entry of readdirSync(chunksDir)) {
  if (!entry.endsWith(".js")) continue;
  cpSync(join(chunksDir, entry), join(serverDir, entry));
}
