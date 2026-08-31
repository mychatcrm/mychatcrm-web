#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function changedFiles() {
  try {
    const base = process.env.AUDIT_BASE_SHA?.trim();
    const tracked = execFileSync("git", ["diff", "--name-only", base ? `${base}...HEAD` : "HEAD"], { encoding: "utf8" });
    const untracked = base ? "" : execFileSync("git", ["ls-files", "--others", "--exclude-standard", "app/api"], { encoding: "utf8" });
    return Array.from(new Set(`${tracked}\n${untracked}`.split("\n").filter(Boolean)));
  } catch {
    return [];
  }
}

const failures = [];
for (const file of changedFiles().filter((name) => /^app\/api\/.+\/route\.ts$/.test(name))) {
  const source = readFileSync(file, "utf8");
  if (!/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(source)) continue;
  const covered = /appendOperationalAuditEvent|operational-audit:\s*(database-triggered|reconciled)/.test(source);
  if (!covered) failures.push(file);
}

if (failures.length) {
  console.error("Mutable API routes changed without an operational-audit contract:");
  for (const file of failures) console.error(`- ${file}`);
  process.exitCode = 1;
} else {
  console.log("Operational audit coverage check passed.");
}
