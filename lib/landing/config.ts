/**
 * Configuração das páginas por variável de ambiente.
 *
 * Roda no middleware (runtime edge), então: só leitura de `process.env`, sem
 * `server-only`, sem import de nada pesado. Tudo tem padrão seguro — enquanto
 * `LANDING_PAGES_DOMAIN` não estiver definida, o módulo fica adormecido e a
 * aplicação se comporta exatamente como antes.
 *
 * O domínio das páginas é DIFERENTE do domínio do SaaS de propósito, e isto não
 * é preferência estética: página de cliente e painel na mesma origem significam
 * que um único cliente mal-intencionado consegue fazer o Google Safe Browsing
 * marcar o domínio inteiro — e aí cai o login, o checkout e o painel de todos os
 * outros clientes junto.
 */

const DEFAULT_APP_HOSTS = [
  "mychatcrm.com",
  "www.mychatcrm.com",
  "mychatcrm.com.br",
  "www.mychatcrm.com.br",
];

function envValue(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function hostFromUrlish(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const host = withoutScheme.split("/")[0] ?? "";
  return host.split(":")[0]?.toLowerCase().replace(/\.+$/, "") ?? "";
}

/** Domínio que serve `<slug>.<domínio>`. Vazio = módulo desligado. */
export function landingPagesDomain(): string | null {
  const configured = hostFromUrlish(envValue("LANDING_PAGES_DOMAIN"));
  return configured || null;
}

/** Hosts do SaaS — nunca podem ser confundidos com página de cliente. */
export function landingAppHosts(): string[] {
  const fromEnv = envValue("LANDING_APP_HOSTS")
    .split(",")
    .map((entry) => hostFromUrlish(entry))
    .filter(Boolean);

  const siteHost = hostFromUrlish(envValue("NEXT_PUBLIC_SITE_URL"));
  const publicBase = hostFromUrlish(envValue("MYCHATCRM_PUBLIC_BASE_URL"));

  const all = new Set<string>([...DEFAULT_APP_HOSTS, ...fromEnv]);
  if (siteHost) {
    all.add(siteHost);
    all.add(siteHost.startsWith("www.") ? siteHost.slice(4) : `www.${siteHost}`);
  }
  if (publicBase) all.add(publicBase);
  return [...all];
}

/**
 * Alvo do CNAME para domínio de cliente. `cname.vercel-dns.com` é o padrão
 * porque é onde a aplicação vive hoje; sai em env para uma mudança de
 * hospedagem não exigir deploy de código nem reconfiguração de cada cliente.
 */
export function landingCnameTarget(): string {
  return hostFromUrlish(envValue("LANDING_DNS_CNAME_TARGET")) || "cname.vercel-dns.com";
}

/** IP do registro A para apex, que não aceita CNAME. */
export function landingApexIp(): string {
  return envValue("LANDING_DNS_APEX_IP") || "76.76.21.21";
}

/**
 * Liga só o caminho do domínio do cliente, sem domínio de páginas.
 *
 * Existe porque as duas coisas têm requisitos diferentes: o subdomínio grátis
 * (`<slug>.<domínio>`) precisa de um wildcard, que exige plano pago na
 * hospedagem; o domínio que o cliente traz é registado um a um e funciona em
 * qualquer plano. Amarrar os dois ao mesmo interruptor impedia de usar o que já
 * funciona por causa do que ainda não está contratado.
 */
export function areLandingCustomDomainsEnabled(): boolean {
  return envValue("LANDING_CUSTOM_DOMAINS_ENABLED") === "true";
}

export function landingHostConfig(): {
  appHosts: string[];
  pagesDomain: string | null;
  customDomainsEnabled: boolean;
} {
  return {
    appHosts: landingAppHosts(),
    pagesDomain: landingPagesDomain(),
    customDomainsEnabled: areLandingCustomDomainsEnabled(),
  };
}

/** Há pelo menos um caminho para publicar? Sem isto a interface avisa em vez de publicar no vazio. */
export function isLandingModuleConfigured(): boolean {
  return landingPagesDomain() !== null || areLandingCustomDomainsEnabled();
}

/** O endereço grátis só existe com o domínio de páginas (e o wildcard) configurado. */
export function isLandingPlatformSubdomainEnabled(): boolean {
  return landingPagesDomain() !== null;
}

export function landingPublicUrl(params: { slug: string; host?: string | null }): string | null {
  if (params.host) return `https://${params.host}`;
  const domain = landingPagesDomain();
  if (!domain) return null;
  return `https://${params.slug}.${domain}`;
}

/**
 * Créditos dados uma vez a cada tenant, na primeira vez que abre as Páginas.
 *
 * Zero por omissão: não invento economia. Mas a carteira nasce vazia, e um
 * cliente que abre a tela sem saldo nenhum não consegue gerar nada — fica com
 * um produto que parece quebrado. Pôr um valor aqui é o interruptor para isso
 * não acontecer enquanto os pacotes do Stripe não existirem.
 */
export function landingWelcomeCredits(): number {
  const parsed = Number.parseInt(envValue("LANDING_WELCOME_CREDITS"), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, 500);
}

/** Token da API Hostinger, usada para comprar domínio e apontar DNS pelo painel. */
export function hostingerApiToken(): string | null {
  return envValue("HOSTINGER_API_TOKEN") || null;
}

export function isDomainPurchaseEnabled(): boolean {
  return hostingerApiToken() !== null && envValue("LANDING_DOMAIN_PURCHASE_ENABLED") === "true";
}

/**
 * Credenciais da hospedagem para registar o domínio do cliente no projeto, que
 * é o que faz o certificado sair sozinho.
 *
 * Aceita `VERCEL_TOKEN` além de `VERCEL_API_TOKEN` porque o projeto já usa o
 * primeiro nome noutros sítios — obrigar a duplicar o mesmo segredo com dois
 * nomes é uma armadilha de configuração, não uma medida de segurança.
 */
export function vercelDomainApi(): { token: string; projectId: string; teamId: string | null } | null {
  const token = envValue("VERCEL_API_TOKEN") || envValue("VERCEL_TOKEN");
  const projectId = envValue("VERCEL_PROJECT_ID");
  if (!token || !projectId) return null;
  return { token, projectId, teamId: envValue("VERCEL_TEAM_ID") || null };
}
