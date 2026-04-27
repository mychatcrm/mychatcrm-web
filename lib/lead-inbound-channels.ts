/**
 * Canais de entrada oferecidos hoje no produto (demo local) — alinhados à página Integrações.
 * Três entradas distintas: Facebook (páginas), WhatsApp API Meta, WhatsApp QR.
 * Varias linhas WhatsApp podem existir; cada canal fica «ligado» se alguma linha usar esse metodo.
 */
import { loadFacebookPagesConnection } from "@/lib/facebook-pages-connection-storage";
import { readWhatsAppSlotMethods } from "@/lib/whatsapp-connection-storage";

export type LeadInboundChannelId = "facebook_pages" | "whatsapp_meta" | "whatsapp_qr";

export type LeadInboundChannelDefinition = {
  id: LeadInboundChannelId;
  title: string;
  description: string;
  /** Âncora na página de integrações para o utilizador ajustar a ligação */
  anchor: string;
};

export const LEAD_INBOUND_CHANNELS: LeadInboundChannelDefinition[] = [
  {
    id: "facebook_pages",
    title: "Páginas Facebook da empresa",
    description: "Páginas e presença Meta ligadas à empresa — leads de formulários e campanhas.",
    anchor: "canal-facebook",
  },
  {
    id: "whatsapp_meta",
    title: "WhatsApp Business API (Meta)",
    description: "Cloud API / WABA com número verificado e políticas da Meta.",
    anchor: "canal-whatsapp",
  },
  {
    id: "whatsapp_qr",
    title: "WhatsApp da empresa (QR Code)",
    description: "Sessão via QR no telemóvel — ideal para testes, sem revisão de app na Meta.",
    anchor: "canal-whatsapp",
  },
];

export type LeadInboundChannelStatus = {
  id: LeadInboundChannelId;
  connected: boolean;
};

/** Estado derivado do mesmo armazenamento que `IntegracoesHub` (browser). SSR: tudo desligado. */
export function loadLeadInboundChannelStatuses(tenantId: string): LeadInboundChannelStatus[] {
  if (typeof window === "undefined") {
    return LEAD_INBOUND_CHANNELS.map((c) => ({ id: c.id, connected: false }));
  }
  const slots = readWhatsAppSlotMethods(tenantId);
  const hasMeta = slots.some((s) => s === "meta");
  const hasQr = slots.some((s) => s === "qr");
  const fb = loadFacebookPagesConnection(tenantId);
  return [
    { id: "facebook_pages", connected: Boolean(fb.connected) },
    { id: "whatsapp_meta", connected: hasMeta },
    { id: "whatsapp_qr", connected: hasQr },
  ];
}

export function countConnectedInboundChannels(statuses: LeadInboundChannelStatus[]): number {
  return statuses.filter((s) => s.connected).length;
}
