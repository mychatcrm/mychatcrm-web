/**
 * Slug da página = rótulo DNS real (`<slug>.dominio-das-paginas`).
 *
 * Por isso a regra é a do RFC 1123, não a de URL: 1–63 caracteres, só
 * minúsculas, dígitos e hífen, sem começar nem terminar em hífen. Um slug que
 * o Postgres aceita mas o DNS recusa vira página publicada que não abre — falha
 * silenciosa, a pior categoria.
 */

export const LANDING_SLUG_MAX_LENGTH = 63;
export const LANDING_SLUG_MIN_LENGTH = 3;

/**
 * Rótulos que não podem virar página porque já significam outra coisa no
 * domínio, ou porque seriam usados para fingir ser a plataforma.
 *
 * `www`, `mail` e afins são infraestrutura. `login`, `checkout`, `admin`,
 * `pagamento` e `seguranca` são a superfície de phishing óbvia: uma página de
 * cliente em `login.<dominio>` é um golpe pronto.
 */
const RESERVED_SLUGS = new Set([
  "www", "mail", "smtp", "imap", "pop", "ftp", "ns", "ns1", "ns2", "mx",
  "api", "app", "admin", "administrador", "painel", "dashboard", "cdn",
  "static", "assets", "img", "images", "media", "files", "download",
  "login", "signin", "signup", "entrar", "cadastro", "conta", "account",
  "checkout", "pagamento", "pagamentos", "pay", "billing", "fatura",
  "seguranca", "security", "verify", "verificacao", "suporte", "support",
  "help", "ajuda", "status", "blog", "docs", "dev", "test", "teste",
  "staging", "preview", "demo", "mychatcrm", "my-chat-crm", "oficial",
  "internal", "system", "sistema", "root", "localhost", "webmail",
  "autodiscover", "autoconfig", "_domainkey", "dmarc", "spf",
]);

export function isReservedLandingSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}

/** Lista só para a interface explicar o "esse nome não pode". */
export function reservedLandingSlugs(): string[] {
  return [...RESERVED_SLUGS].sort();
}

const ACCENT_MAP: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a", å: "a",
  é: "e", è: "e", ê: "e", ë: "e",
  í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o",
  ú: "u", ù: "u", û: "u", ü: "u",
  ç: "c", ñ: "n", ý: "y", ÿ: "y",
};

function stripAccents(value: string): string {
  let out = "";
  for (const char of value) {
    out += ACCENT_MAP[char] ?? char;
  }
  return out;
}

/**
 * Texto livre → slug candidato. Não garante validade (pode devolver string
 * vazia para uma entrada só de símbolos); quem chama valida depois.
 */
export function slugifyLandingName(raw: string): string {
  const base = stripAccents(String(raw ?? "").toLowerCase());
  const replaced = base.replace(/[^a-z0-9]+/g, "-");
  const trimmed = replaced.replace(/^-+/, "").replace(/-+$/, "").replace(/-{2,}/g, "-");
  return trimmed.slice(0, LANDING_SLUG_MAX_LENGTH).replace(/-+$/, "");
}

export type LandingSlugValidation =
  | { ok: true; slug: string }
  | { ok: false; code: "empty" | "too_short" | "too_long" | "invalid_chars" | "reserved" | "numeric_only"; message: string };

export function validateLandingSlug(raw: unknown): LandingSlugValidation {
  const slug = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (!slug) {
    return { ok: false, code: "empty", message: "Informe o endereço da página." };
  }
  if (slug.length < LANDING_SLUG_MIN_LENGTH) {
    return {
      ok: false,
      code: "too_short",
      message: `O endereço precisa de pelo menos ${LANDING_SLUG_MIN_LENGTH} caracteres.`,
    };
  }
  if (slug.length > LANDING_SLUG_MAX_LENGTH) {
    return {
      ok: false,
      code: "too_long",
      message: `O endereço pode ter no máximo ${LANDING_SLUG_MAX_LENGTH} caracteres.`,
    };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      ok: false,
      code: "invalid_chars",
      message: "Use apenas letras minúsculas, números e hífen.",
    };
  }
  if (slug.startsWith("-") || slug.endsWith("-")) {
    return {
      ok: false,
      code: "invalid_chars",
      message: "O endereço não pode começar nem terminar com hífen.",
    };
  }
  if (slug.includes("--")) {
    // Prefixo `xn--` é IDNA; permitir hífen duplo aqui abriria homógrafo.
    return {
      ok: false,
      code: "invalid_chars",
      message: "O endereço não pode ter dois hífens seguidos.",
    };
  }
  if (/^[0-9]+$/.test(slug)) {
    return {
      ok: false,
      code: "numeric_only",
      message: "O endereço não pode ser só números.",
    };
  }
  if (isReservedLandingSlug(slug)) {
    return { ok: false, code: "reserved", message: "Esse endereço é reservado pela plataforma." };
  }
  return { ok: true, slug };
}

/**
 * Sugestão determinística quando o slug preferido já existe: `nome-2`, `nome-3`…
 * Determinística de propósito — a interface tem de conseguir prever o que vai
 * sair sem ida ao servidor.
 */
export function suggestAlternativeSlug(base: string, attempt: number): string {
  const suffix = `-${Math.max(2, Math.floor(attempt))}`;
  const room = LANDING_SLUG_MAX_LENGTH - suffix.length;
  const head = base.slice(0, Math.max(1, room)).replace(/-+$/, "");
  return `${head}${suffix}`;
}
