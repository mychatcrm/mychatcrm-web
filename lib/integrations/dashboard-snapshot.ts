import type { MetaStatusResponse } from "@/app/api/client/meta/status/route";
import type { ExternalApiAuthType } from "@/lib/external-api/types";
import type { TenantWhatsappConnection } from "@/lib/server/tenant-whatsapp-connections";
import type { SlotPurpose } from "@/lib/server/whatsapp-slot-provider";

export type IntegrationsEvolutionSnapshot = {
  id: string;
  slotIndex: number;
  instanceName: string;
  connectionState: string;
  waJid: string | null;
  updatedAt: string;
};

export type IntegrationsCloudSnapshot = {
  connected: true;
  phone_number_id: string;
  display_phone: string | null;
  verified_name: string | null;
  updatedAt: string;
};

export type ExternalApiConnectorCard = {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: ExternalApiAuthType;
  authHeaderName: string | null;
  authUsername: string | null;
  credentialConfigured: boolean;
  enabled: boolean;
  isPrimary: boolean;
  effective: boolean;
  billingStatus: "included" | "extra_active" | "suspended";
  healthStatus: "untested" | "healthy" | "degraded" | "error";
  lastHealthAt: string | null;
  lastErrorCode: string | null;
  agentCount: number;
  operationCount: number;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationsDashboardSnapshotV1 = {
  version: 1;
  generatedAt: string;
  permissions: {
    role: "owner" | "director" | "manager" | "seller";
    canManageExternalApis: boolean;
  };
  whatsapp: {
    capacity: {
      totalSlots: number;
      extraSlots: number;
      includedLines: number;
    };
    offer: {
      amount_cents: number | null;
      currency: string;
      interval_unit: "month" | "year" | null;
    } | null;
    connections: TenantWhatsappConnection[];
    purposeBySlot: Record<number, SlotPurpose | null>;
    evolutionBySlot: Record<number, IntegrationsEvolutionSnapshot>;
    cloudBySlot: Record<number, IntegrationsCloudSnapshot>;
  };
  meta: MetaStatusResponse;
  externalApis: {
    connectors: ExternalApiConnectorCard[];
    capacity: {
      included: 1;
      purchased: number;
      total: number;
      used: number;
    };
  };
};

export type IntegrationsRevalidationResponse = {
  checkedAt: string;
  snapshot: IntegrationsDashboardSnapshotV1;
  evolution: {
    configured: boolean;
    reachable: boolean | null;
    error: string | null;
  } | null;
  meta: {
    reachable: boolean | null;
    checkedPages: number;
    error: string | null;
  } | null;
};
