import fs from "fs";
import path from "path";
import { defaultMaintenanceState, type MaintenanceState } from "@/lib/maintenance-types";

const DATA_DIR = path.join(process.cwd(), "data", "maintenance");
const STATE_FILE = path.join(DATA_DIR, "state.json");

function normalize(raw: unknown): MaintenanceState {
  const base = defaultMaintenanceState();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    message: typeof o.message === "string" ? o.message.slice(0, 2000) : "",
    estimatedReturnAt:
      typeof o.estimatedReturnAt === "string" ? o.estimatedReturnAt.slice(0, 80) : "",
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt.slice(0, 80) : "",
    updatedByAdminEmail:
      typeof o.updatedByAdminEmail === "string" ? o.updatedByAdminEmail.slice(0, 320) : "",
  };
}

export function readMaintenanceState(): MaintenanceState {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return defaultMaintenanceState();
    }
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as unknown;
    return normalize(raw);
  } catch {
    return defaultMaintenanceState();
  }
}

export function writeMaintenanceState(state: MaintenanceState) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}
