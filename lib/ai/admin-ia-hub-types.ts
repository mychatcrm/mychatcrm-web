/** Tipos partilhados entre API e UI do OmniChat IA Hub (sem importar `app/`). */

export type OpenAiTestConnectionPayload = {
  ok: boolean;
  code: "OK" | "NO_KEY" | "HTTP_ERROR" | "NETWORK" | "RATE_LIMIT_ADMIN";
  latencyMs: number | null;
  httpStatus: number | null;
  message: string;
};
