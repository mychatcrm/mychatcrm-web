export type SupportedLanguageCode = "pt" | "en" | "es" | "fr" | "de" | "it";

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
  { code: "pt", pattern: /\b(não|ção|ões|você|obrigad[oa]|estou|quero|preciso)\b/i },
  { code: "en", pattern: /\b(the|you|your|hello|thanks|please|need|want|help)\b/i },
  { code: "es", pattern: /\b(¿|¡|cómo|quiero|necesito|gracias|ayudar|usted)\b/i },
  { code: "fr", pattern: /\b(bonjour|merci|vous|votre|aujourd'hui|aider|besoin)\b/i },
  { code: "de", pattern: /\b(hallo|danke|bitte|helfen|heute|möchte|brauche|ihnen)\b/i },
  { code: "it", pattern: /\b(ciao|grazie|aiutarti|voglio|bisogno|oggi|sono)\b/i },
];

function normalizeText(text: string): string {
  return text.trim().toLocaleLowerCase();
}

export function detectSupportedLanguageCode(text: string | null | undefined): SupportedLanguageCode {
  const normalized = normalizeText(text ?? "");
  if (!normalized) return "pt";

  for (const hint of LANGUAGE_HINTS) {
    if (hint.pattern.test(normalized)) return hint.code;
  }

  let best: { code: SupportedLanguageCode; score: number } = { code: "pt", score: 0 };
  for (const [code, keywords] of Object.entries(LANGUAGE_KEYWORDS) as Array<
    [SupportedLanguageCode, readonly string[]]
  >) {
    const score = keywords.reduce((total, keyword) => {
      return normalized.includes(keyword) ? total + 1 : total;
    }, 0);
    if (score > best.score) best = { code, score };
  }

  return best.score > 0 ? best.code : "pt";
}
