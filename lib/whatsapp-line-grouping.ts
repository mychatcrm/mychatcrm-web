/**
 * Agrupa as linhas WhatsApp do tenant pelas duas seções fixas da tela de
 * Integrações — Formulários Meta / WhatsApp Direto — em vez da antiga lista
 * numerada "Linha 1, Linha 2..." com um dropdown de finalidade em cada uma.
 *
 * Módulo puro (sem "server-only"/"use client") para ser testável em unidade
 * sem montar o componente inteiro.
 */
import type { SlotPurpose } from "@/lib/server/whatsapp-slot-provider";

export type WhatsappLineDescriptor = {
  slotIndex: number;
  purpose: SlotPurpose | null;
  connected: boolean;
};

export type WhatsappLineGrouping = {
  forms: number[];
  direct: number[];
  /**
   * Linha sem finalidade travada mas já com número conectado — caso raro de
   * migração (ex.: linha que servia as duas finalidades antes desta tela
   * existir). Fica isolada da UI principal, não uma terceira seção normal.
   */
  pendingWithConnection: number[];
  /** Slots dentro da capacidade do plano sem finalidade nem conexão nenhuma. */
  freeCapacity: number;
};

export function groupWhatsappLinesByPurpose(lines: readonly WhatsappLineDescriptor[]): WhatsappLineGrouping {
  const forms: number[] = [];
  const direct: number[] = [];
  const pendingWithConnection: number[] = [];
  let freeCapacity = 0;

  for (const line of [...lines].sort((a, b) => a.slotIndex - b.slotIndex)) {
    if (line.purpose === "forms") {
      forms.push(line.slotIndex);
    } else if (line.purpose === "direct") {
      direct.push(line.slotIndex);
    } else if (line.connected) {
      pendingWithConnection.push(line.slotIndex);
    } else {
      freeCapacity += 1;
    }
  }

  return { forms, direct, pendingWithConnection, freeCapacity };
}
