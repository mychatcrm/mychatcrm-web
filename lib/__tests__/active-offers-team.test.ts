import { describe, expect, it } from "vitest";
import { deriveOfferTeamId, offerInTeamScope } from "@/lib/server/active-offers-team";
import type { AccessScope } from "@/lib/server/access-scope";

function fakeSupabase(rows: Array<{ team_id: string | null }> | null, error = false) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: error ? null : rows, error: error ? { message: "x" } : null }),
        }),
      }),
    }),
  };
}

describe("deriveOfferTeamId", () => {
  it("usa a equipe quando todos os leads são dela", async () => {
    const sb = fakeSupabase([{ team_id: "t1" }, { team_id: "t1" }]);
    expect(await deriveOfferTeamId(sb, "tenant-a", ["l1", "l2"])).toBe("t1");
  });

  it("fica sem equipe quando os leads são de equipes diferentes", async () => {
    const sb = fakeSupabase([{ team_id: "t1" }, { team_id: "t2" }]);
    expect(await deriveOfferTeamId(sb, "tenant-a", ["l1", "l2"])).toBeNull();
  });

  it("fica sem equipe se algum lead não tem equipe", async () => {
    const sb = fakeSupabase([{ team_id: "t1" }, { team_id: null }]);
    expect(await deriveOfferTeamId(sb, "tenant-a", ["l1", "l2"])).toBeNull();
  });

  it("não consulta nada quando a lista de leads é vazia", async () => {
    let consultou = false;
    const sb = {
      from: () => {
        consultou = true;
        return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }) }) };
      },
    };
    expect(await deriveOfferTeamId(sb, "tenant-a", [])).toBeNull();
    expect(consultou).toBe(false);
  });

  it("falha fechado (sem equipe) quando a consulta dá erro", async () => {
    expect(await deriveOfferTeamId(fakeSupabase(null, true), "tenant-a", ["l1"])).toBeNull();
  });
});

describe("offerInTeamScope", () => {
  const teamScope: AccessScope = { kind: "teams", teamIds: ["t1"] };
  const sellerScope: AccessScope = { kind: "own", employeeId: "sel-1" };

  it("titular vê qualquer lista", () => {
    expect(offerInTeamScope({ team_id: "t9" }, { kind: "all" })).toBe(true);
    expect(offerInTeamScope({ team_id: null }, { kind: "all" })).toBe(true);
  });

  it("gerente vê a lista da equipe dele", () => {
    expect(offerInTeamScope({ team_id: "t1" }, teamScope)).toBe(true);
  });

  it("gerente NÃO vê a lista de outra equipe", () => {
    expect(offerInTeamScope({ team_id: "t2" }, teamScope)).toBe(false);
  });

  it("lista sem equipe só aparece para quem a criou", () => {
    const offer = { team_id: null, created_by: "gerente@example.com" };
    expect(offerInTeamScope(offer, teamScope, "gerente@example.com")).toBe(true);
    expect(offerInTeamScope(offer, teamScope, "outro@example.com")).toBe(false);
    expect(offerInTeamScope(offer, teamScope)).toBe(false);
  });

  it("vendedor não é recortado aqui — segue pela lista de designados", () => {
    expect(offerInTeamScope({ team_id: "t9" }, sellerScope)).toBe(true);
  });
});
