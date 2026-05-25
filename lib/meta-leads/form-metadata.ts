export type LeadFormFieldRow = { key: string; label: string; value: string };

export type MetaFormSubmissionRow = {
  leadgen_id: string;
  form_id?: string;
  form_name?: string;
  form_fields: LeadFormFieldRow[];
  received_at?: string;
};

export type ParsedMetaLeadProfile = {
  source?: string;
  meta_leadgen_id?: string;
  meta_form_id?: string;
  meta_form_name?: string;
  meta_page_id?: string;
  meta_page_name?: string;
  meta_campaign_id?: string;
  meta_campaign_name?: string;
  meta_adset_id?: string;
  meta_adset_name?: string;
  meta_ad_id?: string;
  meta_ad_name?: string;
  form_fields: LeadFormFieldRow[];
  meta_form_submissions: MetaFormSubmissionRow[];
};

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseFormFieldRows(raw: unknown): LeadFormFieldRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: LeadFormFieldRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const key = textOrNull(item.key) ?? "";
    const label = textOrNull(item.label) ?? key;
    const value = textOrNull(item.value) ?? "";
    if (!key || !value) continue;
    rows.push({ key, label: label || key, value });
  }
  return rows;
}

export function parseMetaLeadProfileMetadata(raw: unknown): ParsedMetaLeadProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const meta_form_submissions: MetaFormSubmissionRow[] = [];
  if (Array.isArray(o.meta_form_submissions)) {
    for (const row of o.meta_form_submissions) {
      if (!row || typeof row !== "object") continue;
      const item = row as Record<string, unknown>;
      const leadgen_id = textOrNull(item.leadgen_id) ?? "";
      if (!leadgen_id) continue;
      const form_fields = parseFormFieldRows(item.form_fields);
      if (form_fields.length === 0) continue;
      meta_form_submissions.push({
        leadgen_id,
        form_id: textOrNull(item.form_id) ?? undefined,
        form_name: textOrNull(item.form_name) ?? undefined,
        form_fields,
        received_at: textOrNull(item.received_at) ?? undefined,
      });
    }
  }

  return {
    source: textOrNull(o.source) ?? undefined,
    meta_leadgen_id: textOrNull(o.meta_leadgen_id) ?? undefined,
    meta_form_id: textOrNull(o.meta_form_id) ?? undefined,
    meta_form_name: textOrNull(o.meta_form_name) ?? undefined,
    meta_page_id: textOrNull(o.meta_page_id) ?? undefined,
    meta_page_name: textOrNull(o.meta_page_name) ?? undefined,
    meta_campaign_id: textOrNull(o.meta_campaign_id) ?? undefined,
    meta_campaign_name: textOrNull(o.meta_campaign_name) ?? undefined,
    meta_adset_id: textOrNull(o.meta_adset_id) ?? undefined,
    meta_adset_name: textOrNull(o.meta_adset_name) ?? undefined,
    meta_ad_id: textOrNull(o.meta_ad_id) ?? undefined,
    meta_ad_name: textOrNull(o.meta_ad_name) ?? undefined,
    form_fields: parseFormFieldRows(o.form_fields),
    meta_form_submissions,
  };
}

export function isLeadAdsProfile(
  source: string | null | undefined,
  meta: ParsedMetaLeadProfile | null,
): boolean {
  const normalized = (source ?? meta?.source ?? "").toLowerCase();
  return normalized === "lead_ads" || normalized.includes("meta") || normalized.includes("facebook");
}

/** Campos efetivos para exibição e IA: histórico + envio atual, sem duplicar por label (último vence). */
export function collectKnownFormFieldRows(meta: ParsedMetaLeadProfile | null): LeadFormFieldRow[] {
  if (!meta) return [];
  const byLabel = new Map<string, LeadFormFieldRow>();

  for (const field of meta.form_fields) {
    byLabel.set(field.label.toLowerCase(), field);
  }
  for (const submission of meta.meta_form_submissions ?? []) {
    for (const field of submission.form_fields) {
      byLabel.set(field.label.toLowerCase(), field);
    }
  }

  return [...byLabel.values()];
}

/** Exibição CRM: nome da Meta → ID → travessão. */
export function formatMetaAttributionLabel(
  name?: string | null,
  id?: string | null,
): string {
  const label = name?.trim();
  if (label) return label;
  const fallbackId = id?.trim();
  if (fallbackId) return fallbackId;
  return "—";
}

export function formatMetaCampaignDisplay(meta: ParsedMetaLeadProfile | null): string {
  return formatMetaAttributionLabel(meta?.meta_campaign_name, meta?.meta_campaign_id);
}

export function formatMetaAdsetDisplay(meta: ParsedMetaLeadProfile | null): string {
  return formatMetaAttributionLabel(meta?.meta_adset_name, meta?.meta_adset_id);
}

export function formatMetaAdDisplay(meta: ParsedMetaLeadProfile | null): string {
  return formatMetaAttributionLabel(meta?.meta_ad_name, meta?.meta_ad_id);
}

export function formatMetaFormReceivedAt(iso: string | undefined, fallback?: string | null): string | null {
  const raw = iso?.trim() || fallback?.trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildMetaFormAttributionLines(meta: ParsedMetaLeadProfile | null): string[] {
  if (!meta) return [];
  const lines: string[] = [];
  if (meta.meta_form_name) lines.push(`Formulário: ${meta.meta_form_name}`);
  if (meta.meta_page_name) lines.push(`Página Meta: ${meta.meta_page_name}`);
  const campaign = formatMetaCampaignDisplay(meta);
  const adset = formatMetaAdsetDisplay(meta);
  const ad = formatMetaAdDisplay(meta);
  if (campaign !== "—") lines.push(`Campanha: ${campaign}`);
  if (adset !== "—") lines.push(`Conjunto de anúncios: ${adset}`);
  if (ad !== "—") lines.push(`Anúncio: ${ad}`);
  if (meta.meta_leadgen_id) lines.push(`ID do lead Meta: ${meta.meta_leadgen_id}`);
  return lines;
}

export function buildMetaFormKnownFactsPromptBlock(
  profileMetadata: Record<string, unknown> | ParsedMetaLeadProfile | null | undefined,
): string | null {
  const meta = parseMetaLeadProfileMetadata(profileMetadata ?? null);
  if (!meta) return null;

  const fields = collectKnownFormFieldRows(meta);
  if (fields.length === 0 && !meta.meta_form_name) return null;

  const answeredLabels = fields.map((f) => f.label);
  const fieldLines = fields.map((f) => `- ${f.label}: ${f.value}`);

  const blocks = [
    "DADOS JÁ INFORMADOS PELO LEAD NO FORMULÁRIO META (MEMÓRIA OBRIGATÓRIA)",
    "Regra crítica: tudo listado abaixo já foi preenchido pelo lead no formulário. NUNCA pergunte de novo nenhum desses itens.",
    "Exemplos do que NÃO pode repetir como pergunta: nome, telefone, e-mail, renda, interesse, tipo de imóvel, bairro, faixa de preço, Minha Casa Minha Vida, casa ou apartamento, motivo da compra, ou qualquer campo listado.",
    "Use os dados para continuar a conversa de forma personalizada, como quem já leu o formulário.",
    "Se faltar informação essencial que não está na lista, pergunte somente o que falta.",
    "",
    ...buildMetaFormAttributionLines(meta),
    answeredLabels.length
      ? `Perguntas já respondidas no formulário (${answeredLabels.length}): ${answeredLabels.join("; ")}`
      : null,
    fieldLines.length ? `Campos preenchidos:\n${fieldLines.join("\n")}` : null,
  ].filter((line): line is string => Boolean(line));

  return blocks.join("\n");
}

export function buildMetaInitialOutreachUserPrompt(params: {
  leadName: string;
  phone: string;
  email: string | null;
  profileMetadata: Record<string, unknown>;
}): string {
  const facts = buildMetaFormKnownFactsPromptBlock(params.profileMetadata);
  const meta = parseMetaLeadProfileMetadata(params.profileMetadata);
  const lines = [
    "Um novo lead acabou de preencher um formulário Meta Lead Ads e deve receber o primeiro atendimento agora pelo WhatsApp.",
    "Responda como o agente configurado, com uma primeira mensagem curta, útil e contextual.",
    "Não diga que é uma simulação. Não invente dados além do contexto abaixo.",
    "A primeira mensagem deve demonstrar que você leu o formulário (cite 2–3 dados relevantes do lead).",
    "",
    facts ?? "",
    "",
    `Contato confirmado no cadastro: nome ${params.leadName}, telefone ${params.phone}${params.email ? `, e-mail ${params.email}` : ""}.`,
    meta?.meta_form_name ? `Formulário de origem: ${meta.meta_form_name}.` : null,
  ].filter((line): line is string => Boolean(line));

  return lines.join("\n");
}

export function buildMetaFormMemorySummary(
  profileMetadata: Record<string, unknown> | null | undefined,
): string | null {
  const block = buildMetaFormKnownFactsPromptBlock(profileMetadata ?? null);
  if (!block) return null;
  return block.split("\n").slice(0, 12).join("\n");
}
