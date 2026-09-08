/**
 * O gravador de reunioes depende de `getUserMedia`, e `getUserMedia` depende
 * deste cabecalho. Enquanto o site inteiro respondia
 * `Permissions-Policy: microphone=()`, o navegador rejeitava a captura mesmo
 * com o usuario autorizando no prompt — falha silenciosa e cara de diagnosticar.
 *
 * Este teste existe para que uma alteracao futura no `next.config.mjs` nao
 * volte a fechar o microfone em `/dashboard` sem ninguem perceber.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — next.config.mjs e JavaScript puro, sem tipos declarados.
import nextConfig, { permissionsPolicyValue } from "@/next.config.mjs";

type HeaderEntry = { key: string; value: string };
type HeaderRule = { source: string; headers: HeaderEntry[] };

async function headerRules(): Promise<HeaderRule[]> {
  const config = nextConfig as { headers: () => Promise<HeaderRule[]> };
  return config.headers();
}

function permissionsPolicyFor(rules: HeaderRule[], source: string): string {
  const rule = rules.find((entry) => entry.source === source);
  if (!rule) throw new Error(`nenhuma regra de cabecalho para "${source}"`);
  const header = rule.headers.find((entry) => entry.key === "Permissions-Policy");
  if (!header) throw new Error(`"${source}" nao define Permissions-Policy`);
  return header.value;
}

describe("Permissions-Policy do microfone", () => {
  it("libera o microfone apenas para a propria origem em /dashboard", async () => {
    const value = permissionsPolicyFor(await headerRules(), "/dashboard/:path*");
    expect(value).toContain("microphone=(self)");
  });

  it("mantem o microfone fechado fora de /dashboard", async () => {
    const value = permissionsPolicyFor(await headerRules(), "/((?!dashboard).*)");
    expect(value).toContain("microphone=()");
    expect(value).not.toContain("microphone=(self)");
  });

  it("nao afrouxa camera, geolocalizacao ou pagamento em nenhuma rota", async () => {
    for (const rule of await headerRules()) {
      const value = permissionsPolicyFor([rule], rule.source);
      expect(value).toContain("camera=()");
      expect(value).toContain("geolocation=()");
      expect(value).toContain("payment=()");
    }
  });

  it("aplica exatamente uma regra por requisicao (as fontes sao exclusivas)", async () => {
    const rules = await headerRules();
    const sources = rules.map((rule) => rule.source);
    expect(sources).toHaveLength(2);
    // `/((?!dashboard).*)` nunca casa com /dashboard, e `/dashboard/:path*`
    // nunca casa com outra coisa: nao ha requisicao coberta pelas duas, entao o
    // valor do microfone nunca depende da ordem de sobreposicao.
    expect(sources).toContain("/((?!dashboard).*)");
    expect(sources).toContain("/dashboard/:path*");
  });

  it("mantem os demais cabecalhos de seguranca nas duas rotas", async () => {
    for (const rule of await headerRules()) {
      const keys = rule.headers.map((entry) => entry.key);
      expect(keys).toContain("X-Content-Type-Options");
      expect(keys).toContain("Referrer-Policy");
      expect(keys).toContain("X-Frame-Options");
    }
  });

  it("permissionsPolicyValue e a unica fonte do valor", () => {
    expect(permissionsPolicyValue({ allowMicrophone: true })).toBe(
      "camera=(), microphone=(self), geolocation=(), payment=()",
    );
    expect(permissionsPolicyValue({ allowMicrophone: false })).toBe(
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
  });
});
