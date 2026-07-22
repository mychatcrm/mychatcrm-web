import type { SupportedLanguageCode } from "@/lib/ai/language-detect";

const GENERIC_FAILURE_REPLIES: Record<SupportedLanguageCode, string> = {
  pt: "Não consegui gerar uma resposta agora. Por favor tente de novo em instantes.",
  en: "I couldn't generate a response right now. Please try again in a moment.",
  es: "No pude generar una respuesta ahora. Por favor inténtalo de nuevo en unos instantes.",
  fr: "Je n'ai pas pu générer de réponse pour le moment. Veuillez réessayer dans quelques instants.",
  de: "Ich konnte gerade keine Antwort erstellen. Bitte versuchen Sie es gleich noch einmal.",
  it: "Non sono riuscito a generare una risposta ora. Riprova tra poco.",
};

export function localizedAgentFailureReply(languageCode: SupportedLanguageCode): string {
  return GENERIC_FAILURE_REPLIES[languageCode];
}
