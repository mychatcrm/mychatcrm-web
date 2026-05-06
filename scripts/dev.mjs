#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const cwd = process.cwd();
const nextBin = resolve(cwd, "node_modules/next/dist/bin/next");

const host = process.env.NEXT_DEV_HOSTNAME ?? "127.0.0.1";
const port = String(process.env.PORT ?? process.env.NEXT_DEV_PORT ?? 3030);
const turbo = process.argv.includes("--turbo");

const lines = [
  "",
  "  MyChatCRM — desenvolvimento local",
  `  → Browser: http://127.0.0.1:${port}`,
  "  • Porta padrão: 3030 (não é 3000).",
  '  • Se "localhost" não abrir, use 127.0.0.1 (IPv6 vs IPv4 no macOS).',
];
if (host === "0.0.0.0") {
  lines.push(
    "  • Host 0.0.0.0: também acessível pelo IP da máquina na rede local.",
  );
}
lines.push("");
console.log(lines.join("\n"));

const args = [nextBin, "dev", "--hostname", host, "--port", port];
if (turbo) args.push("--turbo");

const child = spawn(process.execPath, args, {
  cwd,
  stdio: "inherit",
  env: {
    ...process.env,
    WATCHPACK_POLLING: process.env.WATCHPACK_POLLING ?? "true",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
