import { describe, expect, it } from "vitest";
import { planLabProviderSwitch, buildLabChecklist, nextLabStep, labConnectionStateLabel,
  type LabConnectionView } from "@/lib/agent-test-lab/connection-plan";

const evolution: LabConnectionView = { provider: "evolution", state: "open", number: "44••••001" };
const meta: LabConnectionView = { provider: "meta_cloud", state: "open", number: "44••••002" };

describe("choosing the provider of a laboratory line", () => {
  it("offers the swap instead of blocking when the other provider is connected", () => {
    const plan = planLabProviderSwitch({ role: "tester", current: evolution, target: "meta_cloud", activeRuns: 0 });
    expect(plan.kind).toBe("switch");
    expect(plan).toMatchObject({ from: "evolution" });
    expect((plan as { confirmMessage: string }).confirmMessage)
      .toBe("O WhatsApp testador está conectado por QR Code · Evolution. Deseja desconectá-lo e conectar por API Oficial Meta?");
  });
  it("describes the opposite swap the same way", () => {
    const plan = planLabProviderSwitch({ role: "tester", current: meta, target: "evolution", activeRuns: 0 });
    expect(plan).toMatchObject({ kind: "switch", from: "meta_cloud", target: "evolution" });
    expect((plan as { confirmMessage: string }).confirmMessage)
      .toBe("O WhatsApp testador está conectado por API Oficial Meta. Deseja desconectá-lo e conectar por QR Code · Evolution?");
  });
  it("states the reason, with the count, when a test is still running", () => {
    const plan = planLabProviderSwitch({ role: "copy", current: evolution, target: "meta_cloud", activeRuns: 2 });
    expect(plan.kind).toBe("blocked");
    expect((plan as { reason: string }).reason).toContain("2 execução(ões) ainda aberta(s)");
  });
  it("connects directly when nothing is connected and never proposes a swap to itself", () => {
    expect(planLabProviderSwitch({ role: "copy", current: null, target: "evolution", activeRuns: 0 }).kind).toBe("connect");
    expect(planLabProviderSwitch({ role: "tester", current: evolution, target: "evolution", activeRuns: 0 }).kind).toBe("already");
  });
  it("is a pure decision: cancelling it cannot have changed anything", () => {
    const current = { ...evolution };
    planLabProviderSwitch({ role: "tester", current, target: "meta_cloud", activeRuns: 0 });
    expect(current).toEqual(evolution);
  });
  it("translates connection states into plain words", () => {
    expect(labConnectionStateLabel("conflict")).toBe("Número já usado por outra conexão");
    expect(labConnectionStateLabel(null)).toBe("Não conectado");
  });
});

const ready = {
  internalOnly: false, tester: evolution, targetKind: "copy" as const, copy: meta,
  agentSelected: true, numberSelected: true, ruleSelected: true, expectsSilence: false,
  numbersDistinct: true, internalApproved: true, originalConfirmed: false,
};

describe("laboratory checklist", () => {
  it("covers every required item and only clears when all of them pass", () => {
    const items = buildLabChecklist(ready);
    expect(items.map(item => item.code)).toEqual([
      "tester_connected", "agent_selected", "number_selected", "rule_found",
      "numbers_distinct", "internal_approved", "ready",
    ]);
    expect(items.every(item => item.ok)).toBe(true);
    expect(nextLabStep(items)?.code).toBe("ready");
  });
  it("points at the exact place to click for whatever is missing", () => {
    const items = buildLabChecklist({ ...ready, tester: null, numberSelected: false });
    expect(items.find(item => item.code === "tester_connected")?.action).toEqual({ label: "Conectar testador", anchor: "lab-passo-conexao" });
    expect(items.find(item => item.code === "number_selected")?.action?.anchor).toBe("lab-passo-numero");
    expect(nextLabStep(items)?.code).toBe("tester_connected");
    expect(items.find(item => item.code === "ready")?.ok).toBe(false);
  });
  it("accepts an intentional silence test as a found rule", () => {
    const items = buildLabChecklist({ ...ready, ruleSelected: false, expectsSilence: true });
    expect(items.find(item => item.code === "rule_found")?.ok).toBe(true);
  });
  it("blocks two identical numbers", () => {
    const items = buildLabChecklist({ ...ready, numbersDistinct: false });
    const distinct = items.find(item => item.code === "numbers_distinct");
    expect(distinct?.ok).toBe(false);
    expect(distinct?.detail).toContain("mesmo");
  });
  it("requires the authorization of real effects only on the original agent", () => {
    expect(buildLabChecklist(ready).some(item => item.code === "original_confirmed")).toBe(false);
    const original = buildLabChecklist({ ...ready, targetKind: "original" });
    expect(original.find(item => item.code === "original_confirmed")?.ok).toBe(false);
    expect(original.find(item => item.code === "ready")?.ok).toBe(false);
  });
  it("asks only for the tester and the internal suite on internal-only modes", () => {
    expect(buildLabChecklist({ ...ready, internalOnly: true, internalApproved: false }).map(item => item.code))
      .toEqual(["tester_connected", "internal_approved"]);
  });
});
