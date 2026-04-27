export type MaintenanceState = {
  enabled: boolean;
  /** Mensagem curta para visitantes (opcional). */
  message: string;
  /** ISO 8601 opcional — exibido na página pública. */
  estimatedReturnAt: string;
  updatedAt: string;
  updatedByAdminEmail: string;
};

export const defaultMaintenanceState = (): MaintenanceState => ({
  enabled: false,
  message: "",
  estimatedReturnAt: "",
  updatedAt: "",
  updatedByAdminEmail: "",
});
