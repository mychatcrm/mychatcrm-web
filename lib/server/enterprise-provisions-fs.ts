import fs from "fs";
import path from "path";
import type { EnterpriseProvisionRecord, EnterpriseProvisionsFile } from "@/lib/enterprise-provision-types";

const FILE = path.join(process.cwd(), "data", "enterprise-provisions.json");

function emptyStore(): EnterpriseProvisionsFile {
  return { provisions: [] };
}

export function readEnterpriseProvisionsFile(): EnterpriseProvisionsFile {
  try {
    if (!fs.existsSync(FILE)) return emptyStore();
    const raw = fs.readFileSync(FILE, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyStore();
    const provisions = (parsed as EnterpriseProvisionsFile).provisions;
    if (!Array.isArray(provisions)) return emptyStore();
    return { provisions: provisions.filter(Boolean) as EnterpriseProvisionRecord[] };
  } catch {
    return emptyStore();
  }
}

export function writeEnterpriseProvisionsFile(store: EnterpriseProvisionsFile) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2), "utf8");
}

export function getEnterpriseProvisionByTenantId(tenantId: string): EnterpriseProvisionRecord | null {
  const { provisions } = readEnterpriseProvisionsFile();
  return provisions.find((p) => p.tenantId === tenantId) ?? null;
}

export function appendEnterpriseProvision(record: EnterpriseProvisionRecord) {
  const store = readEnterpriseProvisionsFile();
  store.provisions.push(record);
  writeEnterpriseProvisionsFile(store);
}
