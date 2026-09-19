import type { ClientPlan } from "@/lib/client-auth";

/** Conta titular da plataforma — a nossa, não a de um cliente. */
export const PLATFORM_OWNER_TENANT_ID = "tenant-mychatcrm-owner";

/** Metadados de plano/nome por tenant quando o login vem só do registo de colaborador (ficheiro). */
export function tenantPlanDefaults(tenantId: string): {
  plan: ClientPlan;
  planLabel: "Solo" | "Equipa" | "Escala" | "Enterprise";
  companyName: string;
} {
  switch (tenantId) {
    case PLATFORM_OWNER_TENANT_ID:
      return { plan: "enterprise", planLabel: "Enterprise", companyName: "MyChatCRM — Conta titular" };
    default:
      return { plan: "equipa", planLabel: "Equipa", companyName: "Organização" };
  }
}
