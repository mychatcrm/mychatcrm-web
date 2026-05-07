/**
 * Catálogo único das integrações do painel (alinhado ao que o produto expõe hoje).
 * `backend` indica onde o estado vive: Google Agenda partilha storage com `AgendaHub`.
 */

export type IntegrationBackend = "google_agenda" | "local";

export type IntegrationSlug =
  | "google_agenda"
  | "pipedrive"
  | "hubspot"
  | "rd_station"
  | "zapier"
  | "make"
  | "n8n"
  | "gmail"
  | "outlook_smtp"
  | "webhook"
  | "api_key";

export type IntegrationDefinition = {
  slug: IntegrationSlug;
  title: string;
  group: string;
  description: string;
  backend: IntegrationBackend;
};

export const INTEGRATIONS_CATALOG: IntegrationDefinition[] = [
  {
    slug: "google_agenda",
    title: "Google Agenda",
    group: "CRM e Vendas",
    backend: "google_agenda",
    description: "Compromissos e lembretes alinhados com a página Agenda.",
  },
  {
    slug: "pipedrive",
    title: "Pipedrive",
    group: "CRM e Vendas",
    backend: "local",
    description: "Oportunidades e contactos a partir do Pipedrive (quando o backend estiver ativo).",
  },
  {
    slug: "hubspot",
    title: "HubSpot",
    group: "CRM e Vendas",
    backend: "local",
    description: "Marketing e vendas B2B ligados ao funil de leads.",
  },
  {
    slug: "rd_station",
    title: "RD Station",
    group: "CRM e Vendas",
    backend: "local",
    description: "Leads de campanhas e inbound no funil.",
  },
  {
    slug: "zapier",
    title: "Zapier",
    group: "Automacao",
    backend: "local",
    description: "Liga o CRM e o WhatsApp a centenas de apps, sem código.",
  },
  {
    slug: "make",
    title: "Make",
    group: "Automacao",
    backend: "local",
    description: "Cenários visuais e filas entre sistemas.",
  },
  {
    slug: "n8n",
    title: "n8n",
    group: "Automacao",
    backend: "local",
    description: "Automação self-hosted ou cloud com controlo de dados.",
  },
  {
    slug: "gmail",
    title: "Gmail",
    group: "Comunicacao",
    backend: "local",
    description: "Alertas e notificações por e-mail (Gmail / Google).",
  },
  {
    slug: "outlook_smtp",
    title: "Outlook SMTP",
    group: "Comunicacao",
    backend: "local",
    description: "E-mail transacional com Microsoft 365 / Outlook.",
  },
  {
    slug: "webhook",
    title: "Webhook proprio",
    group: "Personalizado",
    backend: "local",
    description: "Eventos JSON para o seu ERP, BI ou filas internas.",
  },
  {
    slug: "api_key",
    title: "API Key do cliente",
    group: "Personalizado",
    backend: "local",
    description: "Chamadas servidor a servidor ao MyChatCRM, sem segredos no browser.",
  },
];

const GROUP_ORDER = ["CRM e Vendas", "Automacao", "Comunicacao", "Personalizado"];

export function integrationsGrouped(): { group: string; items: IntegrationDefinition[] }[] {
  const map = new Map<string, IntegrationDefinition[]>();
  for (const def of INTEGRATIONS_CATALOG) {
    const list = map.get(def.group) ?? [];
    list.push(def);
    map.set(def.group, list);
  }
  return GROUP_ORDER.filter((g) => map.has(g)).map((group) => ({ group, items: map.get(group)! }));
}

export const LOCAL_INTEGRATION_SLUGS = INTEGRATIONS_CATALOG.filter((d) => d.backend === "local").map((d) => d.slug);
