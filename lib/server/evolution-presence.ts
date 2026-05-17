/**
 * evolution-presence.ts
 *
 * Simula comportamento humano enviando indicadores de presença
 * (digitando / gravando áudio) antes de cada mensagem outbound.
 *
 * Endpoint Evolution API v2:
 *   POST /chat/sendPresence/{instanceName}
 *   Body: { "number": "5511999999999", "options": { "presence": "composing"|"recording", "delay": ms } }
 *
 * A função envia o indicador e aguarda o delay antes de retornar,
 * para que o utilizador veja "digitando..." antes de a mensagem chegar.
 */

import { evolutionApiKey } from "@/lib/integrations/evolution-api";

const EVOLUTION_BASE =
  process.env.EVOLUTION_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

/**
 * Calcula o delay de digitação para um texto outbound.
 * Mínimo 2s, máximo 8s, baseado no comprimento do texto.
 */
export function typingDelayMs(text: string): number {
  return Math.min(8000, Math.max(2000, text.length * 50));
}

/**
 * Envia um indicador de presença e aguarda o delay antes de retornar.
 * Nunca lança excepção — falhas são registadas e ignoradas.
 *
 * @param instanceName  Nome da instância Evolution
 * @param number        Número do destinatário (formato E.164 sem +)
 * @param presence      "composing" para texto, "recording" para áudio
 * @param delayMs       Duração do indicador em milissegundos (e tempo de espera)
 */
export async function sendPresence(
  instanceName: string,
  number: string,
  presence: "composing" | "recording",
  delayMs: number,
): Promise<void> {
  if (!EVOLUTION_BASE) {
    await sleep(delayMs);
    return;
  }

  const apiKey = evolutionApiKey();
  if (!apiKey) {
    await sleep(delayMs);
    return;
  }

  try {
    await fetch(
      `${EVOLUTION_BASE}/chat/sendPresence/${encodeURIComponent(instanceName)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: apiKey,
        },
        body: JSON.stringify({
          number,
          options: { presence, delay: delayMs },
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
  } catch (err) {
    // Falha silenciosa — a mensagem será enviada na mesma sem o indicador
    console.warn(
      "[evolution-presence] sendPresence falhou",
      err instanceof Error ? err.message : err,
    );
  }

  // Aguarda o delay independentemente do resultado da chamada,
  // para que o utilizador veja o indicador antes de a mensagem chegar.
  await sleep(delayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
