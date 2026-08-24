export type SupportedLanguageCode = "pt" | "en" | "es" | "fr" | "de" | "it";

/**
 * A tag BCP-47 usada pelo modelo não é limitada aos idiomas para os quais a
 * plataforma possui cópias internas traduzidas. `SupportedLanguageCode`
 * continua pequeno apenas para mensagens determinísticas do backend e para o
 * parâmetro opcional do ElevenLabs.
 */
export type ConversationLanguageTag = string;

export type ConfiguredConversationLanguage =
  | { ok: true; mode: "automatic"; tag: ConversationLanguageTag | null }
  | { ok: true; mode: "fixed"; tag: ConversationLanguageTag }
  | { ok: false; mode: "invalid"; value: string };

const LANGUAGE_NAMES: Record<SupportedLanguageCode, string> = {
  pt: "Portuguese",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
};

const LANGUAGE_KEYWORDS: Record<SupportedLanguageCode, readonly string[]> = {
  pt: [
    "olá",
    "ola",
    "você",
    "voce",
    "como posso",
    "obrigado",
    "obrigada",
    "quero",
    "preciso",
    "ajuda",
    "hoje",
    "bom dia",
    "boa tarde",
    "boa noite",
  ],
  en: [
    "hello",
    "hi",
    "how can",
    "help",
    "today",
    "please",
    "thanks",
    "thank you",
    "i need",
    "i want",
    "good morning",
    "good afternoon",
  ],
  es: [
    "hola",
    "cómo",
    "como puedo",
    "ayudar",
    "gracias",
    "quiero",
    "necesito",
    "buenos días",
    "buenas tardes",
    "buenas noches",
    "hoy",
  ],
  fr: [
    "bonjour",
    "salut",
    "comment",
    "aider",
    "merci",
    "aujourd'hui",
    "je veux",
    "j'ai besoin",
    "s'il vous plaît",
    "bonsoir",
  ],
  de: [
    "hallo",
    "guten morgen",
    "guten tag",
    "guten abend",
    "helfen",
    "danke",
    "bitte",
    "ich brauche",
    "ich möchte",
    "heute",
  ],
  it: [
    "ciao",
    "buongiorno",
    "buonasera",
    "come posso",
    "aiutarti",
    "grazie",
    "voglio",
    "ho bisogno",
    "per favore",
    "oggi",
  ],
};

const LANGUAGE_HINTS: Array<{ code: SupportedLanguageCode; pattern: RegExp }> = [
  {
    code: "pt",
    pattern:
      /\b(não|ção|ões|você|obrigad[oa]|estou|quero|preciso|sim|pode|poderia|poderíamos|agendar|agendamento|agendamentos|horário|compromisso|próximo|próxima|hoje|amanhã|segunda|terça|quarta|quinta|sexta|veja|nenhum|meu|minha|para|agora)\b/i,
  },
  { code: "en", pattern: /\b(the|you|your|hello|thanks|please|need|want|help)\b/i },
  { code: "es", pattern: /\b(¿|¡|cómo|quiero|necesito|gracias|ayudar|usted)\b/i },
  { code: "fr", pattern: /\b(bonjour|merci|vous|votre|aujourd'hui|aider|besoin)\b/i },
  { code: "de", pattern: /\b(hallo|danke|bitte|helfen|heute|möchte|brauche|ihnen)\b/i },
  { code: "it", pattern: /\b(ciao|grazie|aiutarti|voglio|bisogno|oggi|sono)\b/i },
];

const AUTOMATIC_LANGUAGE_VALUES = new Set(["", "auto", "automatic", "automático", "automatico"]);

const LEGACY_LANGUAGE_TAGS: Readonly<Record<string, string>> = {
  "português br": "pt-BR",
  "portugues br": "pt-BR",
  português: "pt",
  portugues: "pt",
  portuguese: "pt",
  inglês: "en",
  ingles: "en",
  english: "en",
  espanhol: "es",
  español: "es",
  spanish: "es",
  francês: "fr",
  frances: "fr",
  french: "fr",
  alemão: "de",
  alemao: "de",
  german: "de",
  italiano: "it",
  italian: "it",
};

function normalizeText(text: string): string {
  return text.trim().toLocaleLowerCase();
}

export function detectSupportedLanguageCode(text: string | null | undefined): SupportedLanguageCode {
  const normalized = normalizeText(text ?? "");
  if (!normalized) return "en";

  // As cópias determinísticas do backend ainda não cobrem todos os idiomas.
  // Para scripts fora desse conjunto, inglês é o fallback técnico neutro; o
  // runtime de IA usa `detectConversationLanguageTag` e preserva o idioma real.
  if (
    /[\p{Script=Arabic}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Devanagari}\p{Script=Cyrillic}]/u.test(
      normalized,
    )
  ) {
    return "en";
  }

  for (const hint of LANGUAGE_HINTS) {
    if (hint.pattern.test(normalized)) return hint.code;
  }

  let best: { code: SupportedLanguageCode; score: number } = { code: "en", score: 0 };
  for (const [code, keywords] of Object.entries(LANGUAGE_KEYWORDS) as Array<
    [SupportedLanguageCode, readonly string[]]
  >) {
    const score = keywords.reduce((total, keyword) => {
      return normalized.includes(keyword) ? total + 1 : total;
    }, 0);
    if (score > best.score) best = { code, score };
  }

  return best.score > 0 ? best.code : "en";
}

export function supportedLanguageName(code: SupportedLanguageCode): string {
  return LANGUAGE_NAMES[code];
}

/**
 * Devolve uma copia interna apenas quando a tag BCP-47 realmente pertence a
 * um dos idiomas traduzidos pela plataforma. Idiomas desconhecidos retornam
 * `null`; o chamador pode então usar uma representação sem linguagem em vez
 * de impor inglês ou português à conversa.
 */
export function supportedLanguageCodeFromTag(
  tag: string | null | undefined,
): SupportedLanguageCode | null {
  if (!tag) return null;
  let canonical: string;
  try {
    [canonical] = Intl.getCanonicalLocales(tag.replaceAll("_", "-"));
  } catch {
    return null;
  }
  const base = canonical.split("-")[0]?.toLocaleLowerCase();
  return base && Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, base)
    ? (base as SupportedLanguageCode)
    : null;
}

/**
 * Texto mínimo para uma resposta que contém somente anexos. Uma tag fora das
 * cópias internas recebe um marcador universal, nunca um fallback EN/PT.
 */
export function localizedAttachmentIntro(languageTag: string | null | undefined): string {
  const language = supportedLanguageCodeFromTag(languageTag);
  if (!language) return "📎";
  return {
    pt: "Segue o arquivo solicitado.",
    en: "Here is the requested file.",
    es: "Aquí está el archivo solicitado.",
    fr: "Voici le fichier demandé.",
    de: "Hier ist die angeforderte Datei.",
    it: "Ecco il file richiesto.",
  }[language];
}

/**
 * Detecta também scripts que não existiam no seletor legado. Em texto sem
 * evidência linguística devolve `null`: isso é deliberado, pois escolher
 * português seria um fallback comercial invisível.
 */
export function detectConversationLanguageTag(
  text: string | null | undefined,
): ConversationLanguageTag | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;

  if (/\p{Script=Arabic}/u.test(raw)) return "ar";
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(raw)) return "ja";
  if (/\p{Script=Han}/u.test(raw)) return "zh";
  if (/\p{Script=Devanagari}/u.test(raw)) return "hi";
  if (/\p{Script=Cyrillic}/u.test(raw)) return "ru";

  const normalized = normalizeText(raw);
  for (const hint of LANGUAGE_HINTS) {
    if (hint.pattern.test(normalized)) return hint.code;
  }

  let best: { code: SupportedLanguageCode; score: number } | null = null;
  for (const [code, keywords] of Object.entries(LANGUAGE_KEYWORDS) as Array<
    [SupportedLanguageCode, readonly string[]]
  >) {
    const score = keywords.reduce(
      (total, keyword) => total + (normalized.includes(keyword) ? 1 : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) best = { code, score };
  }
  return best?.code ?? null;
}

/** Aceita aliases legados conhecidos e qualquer tag BCP-47 válida. */
export function resolveConfiguredConversationLanguage(
  agentIdioma: string | null | undefined,
  conversationText: string | null | undefined,
): ConfiguredConversationLanguage {
  const raw = (agentIdioma ?? "").trim();
  const normalized = raw.toLocaleLowerCase();
  if (AUTOMATIC_LANGUAGE_VALUES.has(normalized)) {
    return { ok: true, mode: "automatic", tag: detectConversationLanguageTag(conversationText) };
  }

  const legacyTag = LEGACY_LANGUAGE_TAGS[normalized];
  if (legacyTag) return { ok: true, mode: "fixed", tag: legacyTag };

  try {
    const [canonical] = Intl.getCanonicalLocales(raw.replaceAll("_", "-"));
    if (canonical) return { ok: true, mode: "fixed", tag: canonical };
  } catch {
    // A configuração inválida é devolvida ao chamador; não há fallback oculto.
  }
  return { ok: false, mode: "invalid", value: raw };
}

export function buildAgentLanguageInstruction(
  agentIdioma: string | null | undefined,
  conversationText: string | null | undefined,
):
  | { ok: true; instruction: string; languageTag: string | null }
  | { ok: false; detail: string } {
  const resolved = resolveConfiguredConversationLanguage(agentIdioma, conversationText);
  if (!resolved.ok) {
    return {
      ok: false,
      detail: `agent_invalid_language:${resolved.value || "empty"}; expected=BCP-47_or_Automatic`,
    };
  }
  if (resolved.mode === "fixed") {
    return {
      ok: true,
      languageTag: resolved.tag,
      instruction: `LANGUAGE POLICY: Respond exclusively in the configured BCP-47 language \"${resolved.tag}\". Do not switch languages unless the client configuration is changed.`,
    };
  }
  if (resolved.tag) {
    return {
      ok: true,
      languageTag: resolved.tag,
      instruction: `LANGUAGE POLICY: The latest user message is in BCP-47 language \"${resolved.tag}\". Respond exclusively in that language for this turn.`,
    };
  }
  return {
    ok: true,
    languageTag: null,
    instruction:
      "LANGUAGE POLICY: Automatically mirror the language of the latest user message. The text is inconclusive, so do not default to any preselected language.",
  };
}

/**
 * O TTS usa o texto FINAL. Para idiomas fora do conjunto aceito pelo parâmetro
 * `language_code` do provedor, omite-se a dica e o modelo multilíngue infere o
 * idioma diretamente do próprio texto.
 */
export function resolveTtsLanguageCode(
  finalReply: string | null | undefined,
): SupportedLanguageCode | undefined {
  const tag = detectConversationLanguageTag(finalReply);
  const base = tag?.split("-")[0];
  return base && Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, base)
    ? (base as SupportedLanguageCode)
    : undefined;
}

/**
 * Idioma efetivo das mensagens que o SISTEMA gera (não o modelo): usa o idioma
 * fixo configurado no agente quando houver, senão detecta o do cliente.
 *
 * Espelha a regra de `buildLanguageInstruction` — sem isto, um agente
 * configurado para responder sempre em inglês recebia mensagem de sistema em
 * português no meio da conversa.
 */
export function resolveConfiguredLanguageCode(
  agentIdioma: string | null | undefined,
  fallbackText: string,
): SupportedLanguageCode {
  const resolved = resolveConfiguredConversationLanguage(agentIdioma, fallbackText);
  if (resolved.ok && resolved.mode === "fixed") {
    const base = resolved.tag.split("-")[0];
    if (base && Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, base)) {
      return base as SupportedLanguageCode;
    }
  }
  return detectSupportedLanguageCode(fallbackText);
}
