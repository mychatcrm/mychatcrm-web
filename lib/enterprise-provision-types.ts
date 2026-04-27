/**
 * Contas Enterprise provisionadas pelo admin — limites por contrato (null = sem limite prático).
 */

export type EnterpriseLimitField = number | null;

export type EnterpriseProvisionLimits = {
  maxDirectors: EnterpriseLimitField;
  maxManagers: EnterpriseLimitField;
  maxSellers: EnterpriseLimitField;
  includedAgents: EnterpriseLimitField;
  maxSalesFunnels: EnterpriseLimitField;
  monthlyAttendedLeadsCap: EnterpriseLimitField;
  includedWhatsAppLines: EnterpriseLimitField;
};

export type EnterpriseProvisionRecord = {
  id: string;
  tenantId: string;
  organizationName: string;
  ownerEmployeeId: string;
  ownerEmail: string;
  ownerName: string;
  createdAt: string;
  notes?: string;
  limits: EnterpriseProvisionLimits;
};

export type EnterpriseProvisionsFile = {
  provisions: EnterpriseProvisionRecord[];
};
