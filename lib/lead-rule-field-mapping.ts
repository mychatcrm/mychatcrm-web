import type { LeadFieldMapping } from "@/lib/lead-distribution-rules";

export type LeadRuleMappableField = {
  key: string;
  label?: string | null;
  type?: string | null;
};

export type AppliedLeadRuleMapping = {
  name: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  observations: Array<{ key: string; label: string; value: string }>;
  mappedFields: Record<string, string>;
};

export const CONTEXT_LEAD_MAPPING_FIELDS: { key: string; label: string }[] = [
  { key: "form_name", label: "Nome do formulário (form_name)" },
  { key: "page_name", label: "Nome da página (page_name)" },
  { key: "campaign_name", label: "Nome da campanha (campaign_name)" },
  { key: "ad_name", label: "Nome do anúncio (ads_name)" },
];

export function normalizeLeadFieldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

export function inferCrmFieldFromLeadFormField(field: LeadRuleMappableField): string {
  const type = normalizeLeadFieldText(field.type ?? "");
  const key = normalizeLeadFieldText(field.key);
  const label = normalizeLeadFieldText(field.label ?? "");
  const combined = `${type} ${key} ${label}`.trim();

  if (type === "full name" || type === "full_name") return "nome";
  if (type === "phone" || type === "phone number" || type === "phone_number") return "celular";
  if (type === "email" || type === "e mail") return "email";

  if (
    hasAny(combined, [
      /\b(company|business|empresa|organizacao|organizacao|razao social|razão social|nome da empresa)\b/,
      /\b(imobiliaria|imobiliária|corretora)\b/,
    ])
  ) {
    return "empresa";
  }

  if (
    hasAny(combined, [
      /\b(email|e mail|mail|work email|correio)\b/,
      /\bendereco de email\b/,
      /\be-mail\b/,
    ])
  ) {
    return "email";
  }

  if (
    hasAny(combined, [
      /\b(phone|phone number|work phone|telefone|telemovel|telemóvel|celular|whatsapp|mobile|cell|numero|número|zap)\b/,
      /\bcontacto telefonico\b/,
      /\bcontato telefonico\b/,
    ])
  ) {
    return "celular";
  }

  if (
    hasAny(combined, [
      /\b(full name|first name|last name|display name|profile name|nome completo|primeiro nome|sobrenome)\b/,
      /\b(seu nome|teu nome|qual.*nome)\b/,
      /^name\b/,
      /^nome\b/,
    ])
  ) {
    return "nome";
  }

  return "mensagem";
}

function defaultMappingId(): string {
  return `map-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function buildLeadRuleMappingsFromFields(
  fields: LeadRuleMappableField[],
  existing: LeadFieldMapping[],
  options: { forceAuto: boolean; includeContext?: boolean; makeId?: () => string },
): LeadFieldMapping[] {
  const makeId = options.makeId ?? defaultMappingId;
  const existingByKey = new Map(existing.filter((m) => m.kind === "form").map((m) => [m.sourceKey, m]));
  const formRows: LeadFieldMapping[] = fields.map((field) => {
    const prev = existingByKey.get(field.key);
    const crmField = options.forceAuto
      ? inferCrmFieldFromLeadFormField(field)
      : (prev?.crmField ?? inferCrmFieldFromLeadFormField(field));
    return {
      id: prev?.id ?? makeId(),
      sourceKey: field.key,
      sourceLabel: field.label?.trim() || field.key,
      kind: "form",
      crmField,
    };
  });

  if (!options.includeContext) return formRows;

  const ctxExisting = existing.filter((m) => m.kind === "context");
  const contextRows: LeadFieldMapping[] = CONTEXT_LEAD_MAPPING_FIELDS.map((field) => {
    const prev = ctxExisting.find((x) => x.sourceKey === field.key);
    return {
      id: prev?.id ?? makeId(),
      sourceKey: field.key,
      sourceLabel: field.label,
      kind: "context",
      crmField: options.forceAuto ? "mensagem" : (prev?.crmField ?? "mensagem"),
    };
  });

  return [...formRows, ...contextRows];
}

function normalizeSourceKey(value: string): string {
  return normalizeLeadFieldText(value).replace(/\s+/g, "_");
}

function normalizePhoneForLead(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const stripped = digits.startsWith("0") ? digits.slice(1) : digits;
  if (stripped.length >= 10 && stripped.length <= 11 && !stripped.startsWith("55")) {
    return `55${stripped}`;
  }
  return stripped;
}

function fieldValue(fields: Record<string, string>, sourceKey: string): string {
  const candidates = [sourceKey, sourceKey.toLowerCase(), normalizeSourceKey(sourceKey)];
  for (const key of candidates) {
    const direct = fields[key]?.trim();
    if (direct) return direct;
  }
  const wanted = normalizeSourceKey(sourceKey);
  for (const [key, value] of Object.entries(fields)) {
    if (normalizeSourceKey(key) === wanted && value.trim()) return value.trim();
  }
  return "";
}

export function applyLeadRuleMappingsToFields(
  fields: Record<string, string>,
  mappings: LeadFieldMapping[],
): AppliedLeadRuleMapping {
  const result: AppliedLeadRuleMapping = {
    name: null,
    phone: null,
    email: null,
    company: null,
    observations: [],
    mappedFields: {},
  };

  for (const mapping of mappings) {
    if (mapping.kind !== "form" || mapping.crmField === "__ignore__") continue;
    const value = fieldValue(fields, mapping.sourceKey);
    if (!value) continue;

    result.mappedFields[mapping.crmField] = value;

    if (mapping.crmField === "nome" && !result.name) {
      result.name = value;
      continue;
    }
    if (mapping.crmField === "celular" && !result.phone) {
      const phone = normalizePhoneForLead(value);
      if (phone) result.phone = phone;
      continue;
    }
    if (mapping.crmField === "email" && !result.email) {
      result.email = value;
      continue;
    }
    if (mapping.crmField === "empresa" && !result.company) {
      result.company = value;
      continue;
    }
    if (mapping.crmField === "mensagem") {
      result.observations.push({
        key: mapping.sourceKey,
        label: mapping.sourceLabel || mapping.sourceKey,
        value,
      });
    }
  }

  return result;
}
