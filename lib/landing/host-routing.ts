/**
 * Decisão de roteamento por host — roda no middleware, em TODA a requisição.
 *
 * Duas exigências que mandam no desenho:
 *
 * 1. **Barata e pura.** Nada de banco, nada de await. Uma consulta aqui somaria
 *    latência a cada pedido do painel inteiro.
 * 2. **Fecha por omissão para o app.** Host desconhecido continua sendo o app,
 *    como sempre foi. Um bug aqui não pode transformar `/dashboard` numa página
 *    de cliente — por isso o caminho de exceção é o da landing, nunca o inverso.
 *
 * A fronteira de segurança está em `landingHostAllowsPath`: no domínio das
 * páginas, `/admin`, `/dashboard`, `/login` e a API privada não existem. Sem
 * isso, publicar uma página daria a qualquer visitante uma porta para o painel
 * no mesmo cookie de origem.
 */

export type LandingHostConfig = {
  /** Hosts do próprio SaaS (painel, checkout, site). Sempre app. */
  appHosts: string[];
  /** Domínio que serve os subdomínios grátis (`<slug>.<pagesDomain>`). */
  pagesDomain: string | null;
};

export type LandingHostDecision =
  | { kind: "app" }
  | { kind: "landing"; host: string; slug: string | null; rewritePath: string }
  | { kind: "blocked"; host: string; reason: "app_path_on_landing_host" };

function normalizeHostHeader(raw: string | null | undefined): string {
  let host = String(raw ?? "").trim().toLowerCase();
  if (!host) return "";
  // Host com porta (dev) e IPv6 entre colchetes.
  if (host.startsWith("[")) {
    const close = host.indexOf("]");
    return close > 0 ? host.slice(0, close + 1) : host;
  }
  const colon = host.indexOf(":");
  if (colon >= 0) host = host.slice(0, colon);
  return host.replace(/\.+$/, "");
}

/** Hosts que são sempre o app, mesmo sem configuração — dev e previews. */
function isInfrastructureAppHost(host: string): boolean {
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "127.0.0.1" || host === "::1" || host.startsWith("[")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // Previews e o domínio de produção da Vercel.
  if (host.endsWith(".vercel.app")) return true;
  return false;
}

/**
 * Classificação do caminho num host de página. Três destinos, não dois:
 *
 * - `page`      → conteúdo da página do cliente, vai para o renderizador.
 * - `passthrough` → serve o app **tal como está**, sem reescrita. É o endpoint
 *   público do formulário e os ficheiros de raiz. Reescrever isto mandava o
 *   POST do formulário para o renderizador em vez da API, e a página ficava
 *   bonita e incapaz de captar — falha silenciosa, descoberta em teste real.
 * - `blocked`   → painel, admin e API privada não existem neste domínio.
 */
export type LandingPathKind = "page" | "passthrough" | "blocked";

export function classifyLandingPath(pathname: string): LandingPathKind {
  const path = pathname.split("?")[0] ?? "";
  if (path.startsWith("/_next/")) return "passthrough";
  if (path === "/api/public/landing" || path.startsWith("/api/public/landing/")) {
    return "passthrough";
  }
  if (path === "/favicon.ico" || path === "/robots.txt" || path === "/sitemap.xml") {
    return "passthrough";
  }
  if (path.startsWith("/api/")) return "blocked";
  if (path.startsWith("/dashboard")) return "blocked";
  if (path.startsWith("/admin")) return "blocked";
  if (path.startsWith("/login") || path.startsWith("/checkout")) return "blocked";
  if (path === "/sites" || path.startsWith("/sites/")) return "blocked";
  return "page";
}

/** Verdadeiro quando o caminho pode ser servido no host de página (renderizado ou passado adiante). */
export function landingHostAllowsPath(pathname: string): boolean {
  return classifyLandingPath(pathname) !== "blocked";
}

/** Subdomínio grátis: `<slug>.<pagesDomain>` → slug. Apex do domínio devolve null. */
export function extractPlatformSlug(host: string, pagesDomain: string | null): string | null {
  if (!pagesDomain) return null;
  const domain = normalizeHostHeader(pagesDomain);
  if (!domain || host === domain) return null;
  if (!host.endsWith(`.${domain}`)) return null;
  const label = host.slice(0, host.length - domain.length - 1);
  if (!label || label.includes(".")) return null;
  return label;
}

export function resolveLandingHost(params: {
  host: string | null | undefined;
  pathname: string;
  config: LandingHostConfig;
}): LandingHostDecision {
  const host = normalizeHostHeader(params.host);
  if (isInfrastructureAppHost(host)) return { kind: "app" };

  const appHosts = new Set(
    params.config.appHosts.map((h) => normalizeHostHeader(h)).filter(Boolean),
  );
  if (appHosts.has(host)) return { kind: "app" };

  const pagesDomain = normalizeHostHeader(params.config.pagesDomain ?? "");
  // O apex do domínio das páginas é institucional, não é página de ninguém.
  if (pagesDomain && host === pagesDomain) return { kind: "app" };

  /**
   * Módulo adormecido: sem `LANDING_PAGES_DOMAIN` não existe página nenhuma,
   * então host desconhecido continua a ser a aplicação — exatamente como antes
   * deste módulo existir.
   *
   * Sem esta porta, um host apontado para o projeto passaria a receber 404 em
   * vez do site, só por o módulo ter entrado no código. "Adormecido" tem de
   * querer dizer "não muda nada", não "muda um pouco".
   */
  if (!pagesDomain) return { kind: "app" };

  const slug = extractPlatformSlug(host, pagesDomain);

  const pathKind = classifyLandingPath(params.pathname);
  if (pathKind === "blocked") {
    return { kind: "blocked", host, reason: "app_path_on_landing_host" };
  }
  // Passa adiante sem reescrever: é a API pública do formulário e os estáticos.
  if (pathKind === "passthrough") return { kind: "app" };

  const path = params.pathname === "/" ? "" : params.pathname;
  return {
    kind: "landing",
    host,
    slug,
    rewritePath: `/sites/${encodeURIComponent(host)}${path}`,
  };
}
