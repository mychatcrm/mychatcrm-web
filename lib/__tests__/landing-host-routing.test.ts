/**
 * Casos nomeados do roteamento por host.
 *
 * A certificação em massa prova os invariantes; este ficheiro documenta as
 * decisões concretas, para quem mexer no middleware daqui a um ano ver de
 * imediato o que NÃO pode mudar.
 */
import { describe, expect, it } from "vitest";

import {
  classifyLandingPath,
  extractPlatformSlug,
  landingHostAllowsPath,
  resolveLandingHost,
} from "@/lib/landing/host-routing";

const config = {
  appHosts: ["mychatcrm.com.br", "www.mychatcrm.com.br"],
  pagesDomain: "mcpaginas.com.br",
};

describe("roteamento por host das páginas", () => {
  it("serve o app nos domínios do SaaS", () => {
    for (const host of ["mychatcrm.com.br", "www.mychatcrm.com.br", "MYCHATCRM.COM.BR"]) {
      expect(resolveLandingHost({ host, pathname: "/dashboard", config }).kind).toBe("app");
    }
  });

  it("serve o app em desenvolvimento e em previews", () => {
    for (const host of ["localhost:3030", "127.0.0.1:3000", "mychatcrm-git-abc.vercel.app"]) {
      expect(resolveLandingHost({ host, pathname: "/", config }).kind).toBe("app");
    }
  });

  it("reescreve o subdomínio da plataforma para o renderizador", () => {
    const decision = resolveLandingHost({
      host: "consultoria.mcpaginas.com.br",
      pathname: "/",
      config,
    });
    expect(decision).toEqual({
      kind: "landing",
      host: "consultoria.mcpaginas.com.br",
      slug: "consultoria",
      rewritePath: "/sites/consultoria.mcpaginas.com.br",
    });
  });

  it("reescreve domínio de cliente desconhecido", () => {
    const decision = resolveLandingHost({ host: "cliente.com.br", pathname: "/", config });
    expect(decision.kind).toBe("landing");
    if (decision.kind === "landing") {
      expect(decision.slug).toBeNull();
      expect(decision.rewritePath).toBe("/sites/cliente.com.br");
    }
  });

  it("mantém o apex do domínio de páginas como institucional", () => {
    expect(resolveLandingHost({ host: "mcpaginas.com.br", pathname: "/", config }).kind).toBe("app");
  });

  it("bloqueia painel, admin e API privada num host de página", () => {
    for (const pathname of [
      "/dashboard",
      "/dashboard/crm",
      "/admin",
      "/admin/login",
      "/login",
      "/checkout/solo",
      "/api/client/landing-pages",
      "/api/webhooks/stripe",
      "/sites/outro.com",
    ]) {
      const decision = resolveLandingHost({ host: "cliente.com.br", pathname, config });
      expect(decision.kind).toBe("blocked");
    }
  });

  it("deixa passar apenas a submissão pública e os estáticos", () => {
    for (const pathname of ["/api/public/landing/submit", "/_next/static/x.js", "/favicon.ico"]) {
      expect(landingHostAllowsPath(pathname)).toBe(true);
    }
    expect(landingHostAllowsPath("/api/public/landing")).toBe(true);
    expect(landingHostAllowsPath("/api/client/crm")).toBe(false);
  });

  it("entrega o endpoint público do formulário à API, sem reescrever", () => {
    // Regressão: reescrever este caminho mandava o POST do formulário para o
    // renderizador, e a página ficava publicada sem conseguir captar nada.
    const decision = resolveLandingHost({
      host: "cliente.com.br",
      pathname: "/api/public/landing/submit",
      config,
    });
    expect(decision.kind).toBe("app");
  });

  it("classifica o caminho em página, passagem ou bloqueio", () => {
    expect(classifyLandingPath("/")).toBe("page");
    expect(classifyLandingPath("/privacidade")).toBe("page");
    expect(classifyLandingPath("/api/public/landing/submit")).toBe("passthrough");
    expect(classifyLandingPath("/_next/static/a.css")).toBe("passthrough");
    expect(classifyLandingPath("/favicon.ico")).toBe("passthrough");
    expect(classifyLandingPath("/api/client/crm")).toBe("blocked");
    expect(classifyLandingPath("/dashboard")).toBe("blocked");
    expect(classifyLandingPath("/sites")).toBe("blocked");
    // Não basta começar por "/api/public/landing": tem de ser o caminho exato
    // ou um filho dele, senão "/api/public/landing-x" passaria.
    expect(classifyLandingPath("/api/public/landing-outro")).toBe("blocked");
  });

  it("fecha para o app quando nada está configurado", () => {
    const empty = { appHosts: [], pagesDomain: null };
    expect(resolveLandingHost({ host: "qualquer.com", pathname: "/", config: empty }).kind).toBe("app");
  });

  it("extrai o slug apenas de um nível de subdomínio", () => {
    expect(extractPlatformSlug("loja.mcpaginas.com.br", "mcpaginas.com.br")).toBe("loja");
    expect(extractPlatformSlug("a.b.mcpaginas.com.br", "mcpaginas.com.br")).toBeNull();
    expect(extractPlatformSlug("mcpaginas.com.br", "mcpaginas.com.br")).toBeNull();
    expect(extractPlatformSlug("outro.com", "mcpaginas.com.br")).toBeNull();
    expect(extractPlatformSlug("loja.mcpaginas.com.br", null)).toBeNull();
  });

  it("ignora a porta e o ponto final do cabeçalho Host", () => {
    const decision = resolveLandingHost({
      host: "cliente.com.br:443.",
      pathname: "/",
      config,
    });
    expect(decision.kind).toBe("landing");
    if (decision.kind === "landing") expect(decision.host).toBe("cliente.com.br");
  });
});
