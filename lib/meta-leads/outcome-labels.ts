/** Rótulos do desfecho comercial, partilhados entre painel e export. */
export const OUTCOME_LABEL: Record<string, string> = {
  sem_contato: "Sem contato",
  respondeu: "Respondeu",
  agendou: "Agendou",
  ganho: "Ganho",
  perdido: "Perdido",
};

/** No CSV o rótulo vai sem acento de pontuação para não confundir filtros de planilha. */
export const OUTCOME_CSV_LABEL = OUTCOME_LABEL;
