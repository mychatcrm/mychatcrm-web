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
    description: "Sincroniza compromissos com a agenda comercial e lembretes. Estado partilhado com a pagina Agenda.",
  },
  {
    slug: "pipedrive",
    title: "Pipedrive",
    group: "CRM e Vendas",
    backend: "local",
    description: "Sincroniza oportunidades e contactos quando o CRM mestre estiver no Pipedrive (producao).",
  },
  {
    slug: "hubspot",
    title: "HubSpot",
    group: "CRM e Vendas",
    backend: "local",
    description: "Liga marketing e vendas B2B ao fluxo de leads e etapas do MyChatCRM.",
  },
  {
    slug: "rd_station",
    title: "RD Station",
    group: "CRM e Vendas",
    backend: "local",
    description: "Importa leads de inbound e campanhas para o funil e disparos.",
  },
  {
    slug: "zapier",
    title: "Zapier",
    group: "Automacao",
    backend: "local",
    description: "Orquestra eventos do CRM/WhatsApp com centenas de apps sem codigo.",
  },
  {
    slug: "make",
    title: "Make",
    group: "Automacao",
    backend: "local",
    description: "Cenarios visuais avancados e filas entre sistemas.",
  },
  {
    slug: "n8n",
    title: "n8n",
    group: "Automacao",
    backend: "local",
    description: "Automacao self-hosted ou cloud com controlo fino de dados.",
  },
  {
    slug: "gmail",
    title: "Gmail",
    group: "Comunicacao",
    backend: "local",
    description: "Envio de alertas, relatorios e notificacoes via SMTP/Google APIs.",
  },
  {
    slug: "outlook_smtp",
    title: "Outlook SMTP",
    group: "Comunicacao",
    backend: "local",
    description: "E-mail transacional e avisos usando Microsoft 365 / Outlook.",
  },
  {
    slug: "webhook",
    title: "Webhook proprio",
    group: "Personalizado",
    backend: "local",
    description: "Recebe eventos JSON no endpoint do cliente para ERP, BI ou filas internas.",
  },
  {
    slug: "api_key",
    title: "API Key do cliente",
    group: "Personalizado",
    backend: "local",
    description: "Autenticacao para chamadas server-to-server ao MyChatCRM (sem expor segredos no browser).",
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
