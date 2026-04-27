import fs from "fs";
import path from "path";
import type { TeamEmployee } from "@/lib/team-employees-types";

const DATA_DIR = path.join(process.cwd(), "data", "team-employees");

function safeTenantFileName(tenantId: string) {
  return tenantId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "tenant";
}

function filePath(tenantId: string) {
  return path.join(DATA_DIR, `${safeTenantFileName(tenantId)}.json`);
}

function normalizeEmployee(row: unknown): TeamEmployee | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id : null;
  const nome = typeof r.nome === "string" ? r.nome.trim() : "";
  if (!id || !nome) return null;
  const hr = r.hierarchyRole;
  const hierarchyRole =
    hr === "director" || hr === "manager" || hr === "seller" ? hr : ("seller" as const);
  const emailRaw = typeof r.email === "string" ? r.email.trim() : "";
  const funcaoRaw = typeof r.funcao === "string" ? r.funcao.trim() : "";
  let initialPassword = "";
  if (typeof r.initialPassword === "string") initialPassword = r.initialPassword.trim();
  else if (typeof r.password === "string") initialPassword = r.password.trim();
  return {
    id,
    nome,
    email: emailRaw || "legacy-sem-email@local.invalid",
    funcao: funcaoRaw || "—",
    initialPassword,
    ativo: r.ativo !== false,
    hierarchyRole,
    reportsToId: typeof r.reportsToId === "string" && r.reportsToId ? r.reportsToId : undefined,
    accountSuspended: r.accountSuspended === true,
  };
}

export function readTeamEmployeesFromDisk(tenantId: string): TeamEmployee[] {
  try {
    const p = filePath(tenantId);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeEmployee).filter(Boolean) as TeamEmployee[];
  } catch {
    return [];
  }
}

export function writeTeamEmployeesToDisk(tenantId: string, employees: TeamEmployee[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath(tenantId), JSON.stringify(employees, null, 2), "utf8");
}

export function findTeamMemberCredentialsAcrossTenants(
  emailLc: string,
  password: string,
): { tenantId: string; employee: TeamEmployee } | null {
  try {
    if (!fs.existsSync(DATA_DIR)) return null;
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const tenantId = f.replace(/\.json$/i, "");
      const list = readTeamEmployeesFromDisk(tenantId);
      const hit = list.find((e) => {
        const storedPwd = (e.initialPassword ?? "").trim();
        return (
          e.email.trim().toLowerCase() === emailLc &&
          storedPwd === password.trim() &&
          !e.accountSuspended
        );
      });
      if (hit) return { tenantId, employee: hit };
    }
    return null;
  } catch {
    return null;
  }
}

/** True se o e-mail aparece em algum ficheiro de colaboradores (independente da senha). */
export function teamMemberEmailExistsAcrossTenants(emailLc: string): boolean {
  try {
    if (!fs.existsSync(DATA_DIR)) return false;
    const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const tenantId = f.replace(/\.json$/i, "");
      const list = readTeamEmployeesFromDisk(tenantId);
      if (list.some((e) => e.email.trim().toLowerCase() === emailLc)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
