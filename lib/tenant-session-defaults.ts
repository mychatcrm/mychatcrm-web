import type { ClientPlan } from "@/lib/client-auth";

/** Metadados de plano/nome por tenant quando o login vem só do registo de colaborador (ficheiro). */
export function tenantPlanDefaults(tenantId: string): {
  plan: ClientPlan;
  planLabel: "Solo" | "Equipa" | "Escala" | "Enterprise";
  companyName: string;
} {
  switch (tenantId) {
    case "tenant-mychatcrm-owner":
      return { plan: "enterprise", planLabel: "Enterprise", companyName: "MyChatCRM — Conta titular" };
    default:
      return { plan: "equipa", planLabel: "Equipa", companyName: "Organização" };
  }
}
