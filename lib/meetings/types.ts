/**
 * Tipos compartilhados do modulo de reunioes (cliente e servidor).
 *
 * Nao importa nada de `lib/server/*` nem de `@supabase/*` — este arquivo entra
 * no bundle do browser.
 */

/**
 * Quem alcanca a reuniao.
 *
 * - `private`  — so o autor (e o titular da conta).
 * - `team`     — a equipe carimbada na reuniao.
 * - `company`  — todo mundo do tenant.
 * - `lead`     — quem ja alcanca o lead vinculado, pela mesma regra que governa
 *                conversas e agenda (`lib/server/access-scope.ts`).
 */
export type MeetingVisibility = "private" | "team" | "company" | "lead";

export const MEETING_VISIBILITIES: readonly MeetingVisibility[] = [
  "private",
  "team",
  "company",
  "lead",
] as const;

export function isMeetingVisibility(value: unknown): value is MeetingVisibility {
  return (
    typeof value === "string" &&
    (MEETING_VISIBILITIES as readonly string[]).includes(value)
  );
}

/**
 * Estagios do ciclo de vida. `partial` existe porque a transcricao pode dar
 * certo e a analise falhar: o usuario ainda tem o audio e o texto, e isso nunca
 * pode ser tratado como falha total.
 */
export type MeetingStatus =
  | "draft"
  | "uploading"
  | "queued"
  | "transcribing"
  | "analyzing"
  | "completed"
  | "partial"
  | "failed";

export const MEETING_STATUSES: readonly MeetingStatus[] = [
  "draft",
  "uploading",
  "queued",
  "transcribing",
  "analyzing",
  "completed",
  "partial",
  "failed",
] as const;

/** Rotulos em portugues para a interface. */
export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  draft: "Rascunho",
  uploading: "Enviando",
  queued: "Na fila",
  transcribing: "Transcrevendo",
  analyzing: "Analisando",
  completed: "Concluída",
  partial: "Concluída em parte",
  failed: "Falhou",
};

/** Como o audio chegou. */
export type MeetingSource = "record" | "upload";

/**
 * Forma minima de reuniao necessaria para decidir visibilidade.
 * Espelha `ScopableLead` de `lib/server/access-scope.ts`.
 */
export type ScopableMeeting = {
  created_by_employee_id?: string | null;
  team_id?: string | null;
  lead_id?: string | null;
  visibility?: MeetingVisibility | null;
};

/** Colunas que a decisao de visibilidade precisa ler — usar em todo select de recorte. */
export const SCOPABLE_MEETING_COLUMNS =
  "created_by_employee_id, team_id, lead_id, visibility";
