import { describe, expect, it } from "vitest";
import {
  DEFAULT_CENTRAL_TIMEZONE,
  EMPTY_CENTRAL_FILTERS,
  countActiveCentralFilters,
  parseCentralFilters,
  resolveDatePreset,
  serializeCentralFilters,
  zonedDayEndExclusiveISO,
  zonedDayOf,
  zonedDayStartISO,
} from "@/lib/meta-leads/central-filters";

describe("parseCentralFilters", () => {
  it("devolve os padrões para uma query vazia", () => {
    const filters = parseCentralFilters(new URLSearchParams());
    expect(filters).toEqual(EMPTY_CENTRAL_FILTERS);
  });

  it("lê listas, datas e busca", () => {
    const filters = parseCentralFilters(
      new URLSearchParams("from=2026-09-01&to=2026-09-17&cp=c1,c2&fm=f1&q=joao&arch=all&sort=oldest"),
    );
    expect(filters.from).toBe("2026-09-01");
    expect(filters.to).toBe("2026-09-17");
    expect(filters.campaignIds).toEqual(["c1", "c2"]);
    expect(filters.formIds).toEqual(["f1"]);
    expect(filters.search).toBe("joao");
    expect(filters.archived).toBe("all");
    expect(filters.sort).toBe("oldest");
  });

  it("descarta data inválida em vez de aceitar lixo", () => {
    const filters = parseCentralFilters(new URLSearchParams("from=01/09/2026&to=ontem"));
    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
  });

  it("recusa valores fora do enum de status", () => {
    const filters = parseCentralFilters(new URLSearchParams("crm=synced,dropped&wa=sent&bk=ok,inventado"));
    expect(filters.crmStatuses).toEqual(["synced"]);
    expect(filters.waStatuses).toEqual(["sent"]);
    expect(filters.buckets).toEqual(["ok"]);
  });

  it("troca período invertido em vez de devolver vazio", () => {
    const filters = parseCentralFilters(new URLSearchParams("from=2026-09-20&to=2026-09-01"));
    expect(filters.from).toBe("2026-09-01");
    expect(filters.to).toBe("2026-09-20");
  });

  it("limita o tamanho da busca e ignora fuso inválido", () => {
    const filters = parseCentralFilters(new URLSearchParams(`q=${"a".repeat(400)}&tz=Marte/Olimpo`));
    expect(filters.search.length).toBeLessThanOrEqual(120);
    expect(filters.timezone).toBe(DEFAULT_CENTRAL_TIMEZONE);
  });

  it("remove duplicados e ids absurdamente longos", () => {
    const longId = "x".repeat(500);
    const filters = parseCentralFilters(new URLSearchParams(`cp=c1,c1,c2,${longId}`));
    expect(filters.campaignIds).toEqual(["c1", "c2"]);
  });
});

describe("serializeCentralFilters", () => {
  it("faz ida e volta sem perder recorte", () => {
    const original = parseCentralFilters(
      new URLSearchParams("from=2026-08-01&to=2026-08-31&cp=c1,c2&ag=a1&q=maria&arch=archived"),
    );
    const roundTrip = parseCentralFilters(serializeCentralFilters(original));
    expect(roundTrip).toEqual(original);
  });

  it("não escreve o que é padrão — o link fica curto", () => {
    const query = serializeCentralFilters(EMPTY_CENTRAL_FILTERS).toString();
    expect(query).toBe("");
  });
});

describe("countActiveCentralFilters", () => {
  it("conta período como um recorte só", () => {
    const filters = parseCentralFilters(new URLSearchParams("from=2026-09-01&to=2026-09-17"));
    expect(countActiveCentralFilters(filters)).toBe(1);
  });

  it("soma listas, busca e arquivamento", () => {
    const filters = parseCentralFilters(new URLSearchParams("cp=c1&fm=f1&q=ana&arch=all"));
    expect(countActiveCentralFilters(filters)).toBe(4);
  });
});

describe("conversão de dia local para instante", () => {
  it("usa o fuso do tenant, não o do servidor", () => {
    // São Paulo está em UTC-3 o ano todo desde 2019.
    expect(zonedDayStartISO("2026-09-17", "America/Sao_Paulo")).toBe("2026-09-17T03:00:00.000Z");
    expect(zonedDayEndExclusiveISO("2026-09-17", "America/Sao_Paulo")).toBe("2026-09-18T03:00:00.000Z");
  });

  it("dá um intervalo de 24 h para um dia comum", () => {
    const start = new Date(zonedDayStartISO("2026-03-10", "America/Sao_Paulo") as string).getTime();
    const end = new Date(zonedDayEndExclusiveISO("2026-03-10", "America/Sao_Paulo") as string).getTime();
    expect(end - start).toBe(24 * 60 * 60 * 1000);
  });

  it("respeita horário de verão de outro fuso", () => {
    // Lisboa em julho está em UTC+1.
    expect(zonedDayStartISO("2026-07-15", "Europe/Lisbon")).toBe("2026-07-14T23:00:00.000Z");
  });

  it("devolve null para dia malformado", () => {
    expect(zonedDayStartISO("15/07/2026", "America/Sao_Paulo")).toBeNull();
  });

  it("zonedDayOf devolve o dia do calendário do tenant", () => {
    // 03:30 UTC ainda é o dia anterior em São Paulo.
    expect(zonedDayOf(new Date("2026-09-18T02:30:00Z"), "America/Sao_Paulo")).toBe("2026-09-17");
  });
});

describe("resolveDatePreset", () => {
  const now = new Date("2026-09-17T15:00:00Z");

  it("hoje é um único dia", () => {
    expect(resolveDatePreset("hoje", "America/Sao_Paulo", now)).toEqual({
      from: "2026-09-17",
      to: "2026-09-17",
    });
  });

  it("7 dias inclui hoje", () => {
    expect(resolveDatePreset("7d", "America/Sao_Paulo", now)).toEqual({
      from: "2026-09-11",
      to: "2026-09-17",
    });
  });

  it("este mês começa no dia 1", () => {
    expect(resolveDatePreset("mes", "America/Sao_Paulo", now)).toEqual({
      from: "2026-09-01",
      to: "2026-09-17",
    });
  });

  it("mês passado cobre o mês inteiro", () => {
    expect(resolveDatePreset("mes_anterior", "America/Sao_Paulo", now)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });
});
