/**
 * evolution-presence.ts
 *
 * Simula comportamento humano enviando indicadores de presença
 * (digitando / gravando áudio) antes de cada mensagem outbound.
 *
 * Endpoint Evolution API v2:
 *   POST /chat/sendPresence/{instanceName}
 *   Body: { "number": "5511999999999", "presence": "composing"|"recording", "delay": ms }
 *
 * O próprio endpoint controla por quanto tempo a presença fica ativa. Não
 * adicionamos outro sleep local depois da chamada: além de duplicar o delay
 * quando a API funciona, isso atrasava 2–8s até quando a API respondia 400.
 */

import { evolutionFetchJson } from "@/lib/integrations/evolution-api";

const PRESENCE_TIMEOUT_MS = 5_000;

/**
 * Calcula o delay de digitação para um texto outbound.
 * Mínimo 2s, máximo 8s, baseado no comprimento do texto.
 */
export function typingDelayMs(text: string): number {
  return Math.min(8000, Math.max(2000, text.length * 50));
}

/**
 * Envia um indicador de presença.
 * Nunca lança excepção — falhas são registadas e ignoradas.
 *
 * @param instanceName  Nome da instância Evolution
 * @param number        Número do destinatário (formato E.164 sem +)
 * @param presence      "composing" para texto, "recording" para áudio
 * @param delayMs       Duração do indicador em milissegundos na Evolution
 */
export async function sendPresence(
  instanceName: string,
  number: string,
  presence: "composing" | "recording",
  delayMs: number,
): Promise<void> {
  try {
    const enc = encodeURIComponent(instanceName);
    const res = await evolutionFetchJson<unknown>(`/chat/sendPresence/${enc}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        number,
        presence,
        delay: delayMs,
      }),
      timeoutMs: PRESENCE_TIMEOUT_MS,
    });
    if (!res.ok) {
      console.warn("[evolution-presence] sendPresence non-ok", {
        status: res.status,
        error: res.error,
      });
    }
  } catch (err) {
    // Falha silenciosa — a mensagem será enviada na mesma sem o indicador
    console.warn(
      "[evolution-presence] sendPresence falhou",
      err instanceof Error ? err.message : err,
    );
  }

}
