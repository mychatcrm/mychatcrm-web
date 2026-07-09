export type ActiveOfferCreatedVia = "manual_crm" | "smart_filter";
export type ActiveOfferDistributionMode = "shared_pool" | "split_evenly";
export type ActiveOfferDisposition =
  | "pending"
  | "no_answer"
  | "answered_transfer"
  | "answered_not_interested"
  | "do_not_call";

export type ActiveOfferFilterSnapshot = {
  kanbanStages?: string[];
  minDaysInactive?: number | null;
  ownerEmployeeIds?: string[];
  includeUnassigned?: boolean;
  sources?: string[];
  excludeOptOut?: boolean;
};

export type ActiveOfferFilterInput = {
  kanbanStages?: string[];
  minDaysInactive?: number | null;
  ownerEmployeeIds?: string[];
  includeUnassigned?: boolean;
  sources?: string[];
  excludeOptOut?: boolean;
  limit?: number;
};

export type ActiveOfferProgressStats = {
  pending: number;
  noAnswer: number;
  answeredTransfer: number;
  answeredNotInterested: number;
  doNotCall: number;
  total: number;
  completed: number;
};

export const ACTIVE_OFFER_DISPOSITION_LABELS: Record<ActiveOfferDisposition, string> = {
  pending: "Pendente",
  no_answer: "Não atendeu",
  answered_transfer: "Transferiu p/ minha base",
  answered_not_interested: "Não quer nada",
  do_not_call: "Não ligar mais",
};

export const ACTIVE_OFFER_MAX_LEADS = 5000;
