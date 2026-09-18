/**
 * Formulário da página: definição, validação e o payload que vira lead.
 *
 * A validação roda duas vezes — no navegador, para a pessoa corrigir na hora, e
 * outra vez no servidor, porque o formulário está publicado na internet aberta e
 * qualquer um pode postar direto no endpoint. É a mesma regra da lista de
 * espera, pelo mesmo motivo.
 *
 * Telefone é sempre obrigatório e sempre validado com a régua do WhatsApp
 * brasileiro: o lead existe para o agente atender no WhatsApp. Número errado é
 * lead morto que ainda consome cota.
 */

import { checkWhatsapp, whatsappDigits } from "@/lib/brazil-whatsapp";
import type { LandingFormField, LandingFormFieldKind } from "@/lib/landing/types";

export const LANDING_FORM_MAX_FIELDS = 12;
export const LANDING_FORM_MAX_TEXT_LENGTH = 500;
export const LANDING_FORM_MAX_TEXTAREA_LENGTH = 2000;

/** Campos que toda página tem, sempre, na ordem em que aparecem. */
export const LANDING_REQUIRED_FIELD_KEYS = ["name", "phone"] as const;

export function defaultLandingFormFields(): LandingFormField[] {
  return [
    { key: "name", label: "Seu nome", kind: "name", required: true, placeholder: "Nome completo" },
    { key: "phone", label: "WhatsApp", kind: "phone", required: true, placeholder: "(00) 00000-0000" },
    { key: "email", label: "E-mail", kind: "email", required: false, placeholder: "voce@email.com" },
  ];
}

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/**
 * Normaliza a lista vinda do banco ou da IA.
 *
 * Nunca lança: uma versão antiga com um campo que não existe mais tem de
 * continuar renderizando — a página está no ar, comprando tráfego.
 */
export function normalizeLandingFormFields(raw: unknown): LandingFormField[] {
  const input = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const fields: LandingFormField[] = [];

  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key.trim().toLowerCase() : "";
    if (!FIELD_KEY_PATTERN.test(key) || seen.has(key)) continue;

    const kind = normalizeFieldKind(row.kind);
    const label = typeof row.label === "string" && row.label.trim()
      ? row.label.trim().slice(0, 80)
      : defaultLabelForKind(kind, key);

    const options = kind === "select"
      ? (Array.isArray(row.options) ? row.options : [])
          .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
          .map((o) => o.trim().slice(0, 80))
          .slice(0, 20)
      : undefined;

    // `select` sem opção não é um campo, é uma armadilha.
    if (kind === "select" && (!options || options.length === 0)) continue;

    seen.add(key);
    fields.push({
      key,
      label,
      kind,
      required: row.required === true || LANDING_REQUIRED_FIELD_KEYS.includes(key as "name" | "phone"),
      ...(typeof row.placeholder === "string" && row.placeholder.trim()
        ? { placeholder: row.placeholder.trim().slice(0, 120) }
        : {}),
      ...(options ? { options } : {}),
    });

    if (fields.length >= LANDING_FORM_MAX_FIELDS) break;
  }

  // Garante nome e telefone, sempre, mesmo que a versão gravada os tenha perdido.
  for (const required of defaultLandingFormFields()) {
    if (!LANDING_REQUIRED_FIELD_KEYS.includes(required.key as "name" | "phone")) continue;
    if (!fields.some((f) => f.key === required.key)) {
      fields.unshift(required);
    }
  }

  return fields.slice(0, LANDING_FORM_MAX_FIELDS);
}

function normalizeFieldKind(raw: unknown): LandingFormFieldKind {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (value) {
    case "name":
    case "phone":
    case "email":
    case "textarea":
    case "select":
      return value;
    default:
      return "text";
  }
}

function defaultLabelForKind(kind: LandingFormFieldKind, key: string): string {
  switch (kind) {
    case "name": return "Seu nome";
    case "phone": return "WhatsApp";
    case "email": return "E-mail";
    default: return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}

export type LandingFormValidation =
  | { ok: true; values: Record<string, string>; phoneDigits: string; name: string; email: string | null }
  | { ok: false; errors: Record<string, string> };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Valida a submissão contra a definição da versão publicada.
 *
 * Campo que não está na definição é descartado em silêncio: aceitar chave
 * arbitrária de um POST público encheria o CRM com o que o atacante quisesse.
 */
export function validateLandingSubmission(params: {
  fields: LandingFormField[];
  payload: Record<string, unknown>;
  consentGiven: boolean;
  requireConsent?: boolean;
}): LandingFormValidation {
  const errors: Record<string, string> = {};
  const values: Record<string, string> = {};
  let phoneDigits = "";
  let name = "";
  let email: string | null = null;

  if (params.requireConsent !== false && !params.consentGiven) {
    errors.consent = "É preciso aceitar para continuar.";
  }

  for (const field of params.fields) {
    const raw = params.payload[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";

    if (!value) {
      if (field.required) errors[field.key] = `${field.label} é obrigatório.`;
      continue;
    }

    switch (field.kind) {
      case "phone": {
        const check = checkWhatsapp(value);
        if (!check.ok) {
          errors[field.key] = check.message;
          break;
        }
        phoneDigits = check.digits;
        values[field.key] = check.formatted;
        break;
      }
      case "email": {
        const trimmed = value.slice(0, 254);
        if (!EMAIL_PATTERN.test(trimmed)) {
          errors[field.key] = "E-mail inválido.";
          break;
        }
        email = trimmed.toLowerCase();
        values[field.key] = email;
        break;
      }
      case "name": {
        const trimmed = value.slice(0, 120);
        if (trimmed.length < 2) {
          errors[field.key] = "Informe seu nome.";
          break;
        }
        name = trimmed;
        values[field.key] = trimmed;
        break;
      }
      case "select": {
        const allowed = field.options ?? [];
        if (!allowed.includes(value)) {
          errors[field.key] = "Escolha uma das opções.";
          break;
        }
        values[field.key] = value;
        break;
      }
      case "textarea": {
        values[field.key] = value.slice(0, LANDING_FORM_MAX_TEXTAREA_LENGTH);
        break;
      }
      default: {
        values[field.key] = value.slice(0, LANDING_FORM_MAX_TEXT_LENGTH);
        break;
      }
    }
  }

  if (!phoneDigits && !errors.phone) {
    errors.phone = "Informe seu WhatsApp com DDD.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values, phoneDigits, name, email };
}

/**
 * Telefone na forma canónica do resto do sistema: com o `55` do país.
 *
 * `checkWhatsapp` devolve os dígitos LOCAIS (sem o 55) porque foi feito para
 * validar o que a pessoa digita. Mas `leads.phone` é escrito por outros dois
 * caminhos — Meta (`normalizePhone` em `meta-lead-processing.ts`) e WhatsApp
 * (`normalizeWhatsAppPhone`, que vem do `remoteJid`) — e **os dois gravam com
 * o 55**.
 *
 * Gravar sem o prefixo criaria uma segunda linha para a mesma pessoa: a chave
 * única é `(tenant_id, phone)` e `62999887766` não colide com `5562999887766`.
 * O estrago não é o registo duplicado, é o que vem depois — a conversa do
 * WhatsApp anexa-se ao outro lead, e a atribuição da campanha fica órfã
 * exatamente no fluxo que este módulo existe para medir.
 */
export function canonicalLeadPhone(localDigits: string): string {
  const digits = String(localDigits ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const stripped = digits.startsWith("0") ? digits.slice(1) : digits;
  if (stripped.length >= 10 && stripped.length <= 11 && !stripped.startsWith("55")) {
    return `55${stripped}`;
  }
  return stripped;
}

/**
 * Chave de deduplicação da submissão.
 *
 * Mesma página + mesmo telefone + mesma hora = uma submissão. A janela horária
 * é o que separa "clicou duas vezes no botão" de "voltou amanhã com outro
 * interesse" — o segundo caso é lead legítimo e não pode ser engolido.
 */
export function buildSubmissionDedupKey(params: {
  phoneDigits: string;
  at?: Date;
  windowMs?: number;
}): string {
  const windowMs = params.windowMs ?? 60 * 60 * 1000;
  const at = params.at ?? new Date();
  const bucket = Math.floor(at.getTime() / windowMs);
  return `${whatsappDigits(params.phoneDigits)}:${bucket}`;
}
