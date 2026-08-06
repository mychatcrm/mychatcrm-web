import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const { createSupabaseServiceClient, getEvolutionInstanceByTenantSlot, getWhatsAppCloudConnection } = vi.hoisted(() => ({
  createSupabaseServiceClient: vi.fn(),
  getEvolutionInstanceByTenantSlot: vi.fn(),
  getWhatsAppCloudConnection: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient }));
vi.mock("@/lib/server/tenant-evolution-instance-db", () => ({ getEvolutionInstanceByTenantSlot }));
vi.mock("@/lib/server/whatsapp-cloud-connections", () => ({ getWhatsAppCloudConnection }));

import {
  getSlotActiveProvider,
  getSlotPurpose,
  getSlotPurposesForTenant,
  setSlotActiveProvider,
  setSlotPurpose,
} from "@/lib/server/whatsapp-slot-provider";

type Row = Record<string, unknown>;

function makeFakeSb(rules: Row[]) {
  const slotState: Row[] = [];
  const ruleUpdates: { filters: Record<string, unknown>; ids: string[]; patch: Row }[] = [];

  const sb = {
    from: (table: string) => {
      if (table === "tenant_whatsapp_slot_state") {
        return {
          select: () => ({
            // `.eq()` é ao mesmo tempo thenable (listagem do tenant inteiro) e
            // encadeável com um segundo `.eq().maybeSingle()` (linha única).
            eq: (col: string, val: unknown) => {
              const matches = () => slotState.filter((r) => r[col] === val);
              return {
                eq: (col2: string, val2: unknown) => ({
                  maybeSingle: async () => ({
                    data: matches().find((r) => r[col2] === val2) ?? null,
                    error: null,
                  }),
                }),
                then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
                  resolve({ data: matches(), error: null }),
              };
            },
          }),
          upsert: (payload: Row) => {
            const idx = slotState.findIndex((r) => r.tenant_id === payload.tenant_id && r.slot_index === payload.slot_index);
            if (idx >= 0) slotState[idx] = { ...slotState[idx], ...payload };
            else slotState.push({ ...payload });
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "lead_distribution_rules") {
        return {
          select: (_cols: string) => ({
            eq: (col: string, val: unknown) => ({
              eq: (col2: string, val2: unknown) =>
                Promise.resolve({
                  data: rules.filter((r) => r[col] === val && r[col2] === val2),
                  error: null,
                }),
            }),
          }),
          update: (patch: Row) => ({
            eq: (col: string, val: unknown) => ({
              eq: (col2: string, val2: unknown) => ({
                in: (col3: string, ids: string[]) => {
                  ruleUpdates.push({ filters: { [col]: val, [col2]: val2 }, ids, patch });
                  for (const rule of rules) {
                    if (
                      rule[col] === val &&
                      rule[col2] === val2 &&
                      ids.includes(rule[col3] as string)
                    ) {
                      Object.assign(rule, patch);
                    }
                  }
                  return Promise.resolve({ error: null });
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  return { sb, slotState, ruleUpdates, rules };
}

describe("getSlotActiveProvider", () => {
  it("defaults to evolution when no state row exists", async () => {
    const { sb } = makeFakeSb([]);
    createSupabaseServiceClient.mockReturnValue(sb);

    expect(await getSlotActiveProvider("t1", 0)).toBe("evolution");
  });
});

describe("setSlotActiveProvider", () => {
  it("switches the record and repoints lead_distribution_rules from the old connection to the new one", async () => {
    const rules: Row[] = [{ id: "rule-1", tenant_id: "t1", connection_id: "evo-uuid-1", transport: "evolution", source: "whatsapp_direct", meta_template_name: null }];
    const { sb, slotState } = makeFakeSb(rules);
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ id: "evo-uuid-1" });
    getWhatsAppCloudConnection.mockResolvedValue({ phone_number_id: "meta-123" });

    const result = await setSlotActiveProvider("t1", 0, "cloud_api");

    expect(slotState).toEqual([
      expect.objectContaining({ tenant_id: "t1", slot_index: 0, active_provider: "cloud_api" }),
    ]);
    expect(rules[0]).toMatchObject({ connection_id: "meta-123", transport: "cloud_api" });
    expect(result).toEqual({ switchedRuleIds: ["rule-1"], blockedRules: [] });
  });

  it("does nothing to lead_distribution_rules when the other side has no connection yet", async () => {
    const rules: Row[] = [{ id: "rule-1", tenant_id: "t1", connection_id: "evo-uuid-1", transport: "evolution", source: "whatsapp_direct", meta_template_name: null }];
    const { sb } = makeFakeSb(rules);
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue(null);
    getWhatsAppCloudConnection.mockResolvedValue({ phone_number_id: "meta-999" });

    const result = await setSlotActiveProvider("t1", 0, "cloud_api");

    expect(rules[0]).toMatchObject({ connection_id: "evo-uuid-1", transport: "evolution" });
    expect(result).toEqual({ switchedRuleIds: [], blockedRules: [] });
  });

  it("regressão real (2026-07-19): regra de Lead Ads sem template aprovado NÃO migra pra API Meta e continua respondendo no QR", async () => {
    const rules: Row[] = [
      {
        id: "2aecc659-8fbe-40d4-836b-2e73c152d36d",
        name: "[Recrutamento]",
        tenant_id: "t1",
        connection_id: "evo-uuid-1",
        transport: "evolution",
        source: "meta_form",
        meta_template_name: null,
      },
    ];
    const { sb } = makeFakeSb(rules);
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ id: "evo-uuid-1" });
    getWhatsAppCloudConnection.mockResolvedValue({ phone_number_id: "meta-123" });

    const result = await setSlotActiveProvider("t1", 0, "cloud_api");

    // A regra fica exatamente como estava — continua indo pro QR de verdade,
    // em vez de ficar marcada cloud_api e cair num fallback silencioso.
    expect(rules[0]).toMatchObject({ connection_id: "evo-uuid-1", transport: "evolution" });
    expect(result).toEqual({
      switchedRuleIds: [],
      blockedRules: [{ id: "2aecc659-8fbe-40d4-836b-2e73c152d36d", name: "[Recrutamento]" }],
    });
  });

  it("migra regra de Lead Ads pra API Meta quando ela já tem template aprovado configurado", async () => {
    const rules: Row[] = [
      {
        id: "rule-ready",
        name: "[Recrutamento com template]",
        tenant_id: "t1",
        connection_id: "evo-uuid-1",
        transport: "evolution",
        source: "meta_form",
        meta_template_name: "mychatcrm_lead_outreach_v1",
      },
    ];
    const { sb } = makeFakeSb(rules);
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ id: "evo-uuid-1" });
    getWhatsAppCloudConnection.mockResolvedValue({ phone_number_id: "meta-123" });

    const result = await setSlotActiveProvider("t1", 0, "cloud_api");

    expect(rules[0]).toMatchObject({ connection_id: "meta-123", transport: "cloud_api" });
    expect(result).toEqual({ switchedRuleIds: ["rule-ready"], blockedRules: [] });
  });

  it("migra regra de Lead Ads sem template de volta pro QR sem restrição (evolution nunca precisa de template)", async () => {
    const rules: Row[] = [
      {
        id: "rule-back-to-qr",
        name: "[Recrutamento]",
        tenant_id: "t1",
        connection_id: "meta-123",
        transport: "cloud_api",
        source: "meta_form",
        meta_template_name: null,
      },
    ];
    const { sb } = makeFakeSb(rules);
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue({ id: "evo-uuid-1" });
    getWhatsAppCloudConnection.mockResolvedValue({ phone_number_id: "meta-123" });

    const result = await setSlotActiveProvider("t1", 0, "evolution");

    expect(rules[0]).toMatchObject({ connection_id: "evo-uuid-1", transport: "evolution" });
    expect(result).toEqual({ switchedRuleIds: ["rule-back-to-qr"], blockedRules: [] });
  });
});

// A finalidade da linha é o que impede regra de formulário e regra de WhatsApp
// direto de dividirem o mesmo número. `null` significa livre e tem que manter o
// comportamento anterior — nenhum tenant já configurado pode mudar no deploy.
describe("finalidade da linha (purpose)", () => {
  it("linha sem registro é livre", async () => {
    const { sb } = makeFakeSb([]);
    createSupabaseServiceClient.mockReturnValue(sb);

    expect(await getSlotPurpose("t1", 0)).toBeNull();
    expect(await getSlotPurposesForTenant("t1")).toEqual(new Map());
  });

  it("grava a finalidade preservando o provedor ativo quando não havia registro", async () => {
    const { sb, slotState } = makeFakeSb([]);
    createSupabaseServiceClient.mockReturnValue(sb);

    await setSlotPurpose("t1", 1, "direct");

    expect(slotState).toHaveLength(1);
    expect(slotState[0]).toMatchObject({
      tenant_id: "t1",
      slot_index: 1,
      purpose: "direct",
      active_provider: "evolution",
    });
    expect(await getSlotPurpose("t1", 1)).toBe("direct");
  });

  it("mantém o provedor já escolhido ao travar a finalidade", async () => {
    const { sb, slotState } = makeFakeSb([]);
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue(null);
    getWhatsAppCloudConnection.mockResolvedValue(null);

    await setSlotActiveProvider("t1", 0, "cloud_api");
    await setSlotPurpose("t1", 0, "forms");

    expect(slotState[0]).toMatchObject({ active_provider: "cloud_api", purpose: "forms" });
  });

  it("destravar (null) volta a linha para livre", async () => {
    const { sb } = makeFakeSb([]);
    createSupabaseServiceClient.mockReturnValue(sb);

    await setSlotPurpose("t1", 0, "forms");
    await setSlotPurpose("t1", 0, null);

    expect(await getSlotPurpose("t1", 0)).toBeNull();
  });

  it("lista a finalidade de todas as linhas do tenant numa consulta", async () => {
    const { sb } = makeFakeSb([]);
    createSupabaseServiceClient.mockReturnValue(sb);

    await setSlotPurpose("t1", 0, "forms");
    await setSlotPurpose("t1", 1, "direct");

    expect(await getSlotPurposesForTenant("t1")).toEqual(
      new Map([
        [0, "forms"],
        [1, "direct"],
      ]),
    );
  });

  // Regressão silenciosa: alternar QR↔API Meta não pode destravar a linha, senão
  // uma regra da finalidade errada passaria a ser aceita sem ninguém perceber.
  it("alternar provedor não apaga a finalidade travada", async () => {
    const { sb } = makeFakeSb([]);
    createSupabaseServiceClient.mockReturnValue(sb);
    getEvolutionInstanceByTenantSlot.mockResolvedValue(null);
    getWhatsAppCloudConnection.mockResolvedValue(null);

    await setSlotPurpose("t1", 0, "direct");
    await setSlotActiveProvider("t1", 0, "cloud_api");

    expect(await getSlotPurpose("t1", 0)).toBe("direct");
  });
});

describe("migração da coluna de finalidade", () => {
  const sql = readFileSync(
    resolve(__dirname, "../../supabase/migrations/20260806001632_tenant_whatsapp_slot_purpose.sql"),
    "utf8",
  );

  it("adiciona purpose anulável em tenant_whatsapp_slot_state", () => {
    expect(sql).toContain("alter table public.tenant_whatsapp_slot_state");
    expect(sql).toContain("add column if not exists purpose text null");
  });

  it("restringe os valores a forms/direct mantendo NULL como livre", () => {
    expect(sql).toContain("check (purpose is null or purpose in ('forms', 'direct'))");
  });

  it("não faz backfill — nenhuma linha existente nasce travada", () => {
    expect(sql).not.toMatch(/update\s+public\.tenant_whatsapp_slot_state/i);
    expect(sql).not.toMatch(/default\s+'(forms|direct)'/i);
  });
});
