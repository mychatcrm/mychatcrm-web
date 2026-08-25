import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isBlockedExternalApiIp,
  normalizedIpLiteral,
} from "@/lib/server/external-api-network-policy";

/**
 * O cliente configura a URL da API externa; o alvo é dado não confiável.
 * Sem esta política, um agente vira um proxy para a rede interna da
 * plataforma (SSRF): bastaria apontar a "API de estoque" para o serviço de
 * metadata da nuvem e ler credenciais.
 *
 * A defesa não é só validar a URL — é validar o ENDEREÇO RESOLVIDO a cada
 * conexão, porque um domínio público pode resolver para 127.0.0.1 (DNS
 * rebinding). Estes testes travam as duas metades.
 */
describe("bloqueio de destino interno (SSRF)", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.10.20.30", "loopback (faixa inteira)"],
    ["0.0.0.0", "endereço nulo"],
    ["10.1.2.3", "rede privada A"],
    ["172.16.5.4", "rede privada B"],
    ["172.31.255.254", "rede privada B (fim da faixa)"],
    ["192.168.0.10", "rede privada C"],
    ["169.254.169.254", "metadata da nuvem (AWS/GCP/Azure)"],
    ["169.254.1.1", "link-local"],
    ["100.64.0.1", "CGNAT"],
    ["224.0.0.1", "multicast"],
    ["240.0.0.1", "reservado"],
    ["198.18.0.1", "benchmarking"],
  ])("bloqueia %s (%s)", (ip) => {
    expect(isBlockedExternalApiIp(ip)).toBe(true);
  });

  it.each([
    ["8.8.8.8", "DNS público"],
    ["1.1.1.1", "DNS público"],
    ["93.184.216.34", "host público comum"],
  ])("permite %s (%s)", (ip) => {
    expect(isBlockedExternalApiIp(ip)).toBe(false);
  });

  it.each([
    ["::1", "loopback IPv6"],
    ["::", "endereço nulo IPv6"],
    ["fd00::1", "unique-local IPv6"],
    ["fe80::1", "link-local IPv6"],
    ["ff02::1", "multicast IPv6"],
    ["2001:db8::1", "documentação IPv6"],
  ])("bloqueia %s (%s)", (ip) => {
    expect(isBlockedExternalApiIp(ip)).toBe(true);
  });

  it("bloqueia IPv4 privado disfarçado de IPv6 (::ffff:127.0.0.1)", () => {
    // Um atacante que só filtrasse a forma decimal deixaria isto passar.
    expect(isBlockedExternalApiIp("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedExternalApiIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedExternalApiIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("trata entrada ilegível como bloqueada (falha fechada)", () => {
    for (const bad of ["", "   ", "not-an-ip", "999.999.999.999", "127.0.0", "0x7f.0.0.1"]) {
      expect(isBlockedExternalApiIp(bad)).toBe(true);
    }
  });

  it("reconhece o literal com colchetes de IPv6, como aparece numa URL", () => {
    expect(normalizedIpLiteral("[::1]")).toBe("::1");
    expect(isBlockedExternalApiIp("[::1]")).toBe(true);
  });

  it("nome de host não é literal de IP — vai para a resolução de DNS", () => {
    // É por isto que a validação da URL sozinha não basta: 'api.cliente.com'
    // passa aqui e só o endereço resolvido prova se o destino é interno.
    expect(normalizedIpLiteral("api.cliente.com")).toBeNull();
    expect(normalizedIpLiteral("8.8.8.8")).toBe("8.8.8.8");
  });
});

/**
 * DNS rebinding: o domínio é público na primeira consulta e interno na
 * segunda. Por isso o cliente HTTP passa um `lookup` próprio, que aplica a
 * política em CADA endereço resolvido, em toda conexão — e não apenas uma vez
 * na validação da URL.
 */
describe("revalidação do endereço resolvido (DNS rebinding)", () => {
  it("qualquer endereço interno na resposta do DNS reprova o conjunto", () => {
    // O safeLookup usa `all: true` e rejeita se ALGUM endereço for bloqueado:
    // um round-robin com um IP público e um interno não pode ser aceito só
    // porque o primeiro da lista parecia seguro.
    const resolvidos = ["93.184.216.34", "127.0.0.1"];
    expect(resolvidos.some((ip) => isBlockedExternalApiIp(ip))).toBe(true);
  });

  it("conjunto totalmente público é aceito", () => {
    const resolvidos = ["93.184.216.34", "8.8.8.8"];
    expect(resolvidos.some((ip) => isBlockedExternalApiIp(ip))).toBe(false);
  });
});

/**
 * Redirect é a terceira via de SSRF: a URL validada aponta para um host
 * público que responde 302 para `http://169.254.169.254/...`. Seguir esse
 * salto anularia a checagem de IP, porque o destino final nunca passou pela
 * política.
 *
 * A defesa aqui é estrutural — o cliente usa `node:https.request`, que NÃO
 * segue redirect por conta própria — e por isso precisa de um teste de
 * contrato: trocar por um cliente que siga redirect (fetch/axios) reabriria o
 * buraco sem quebrar nenhum outro teste.
 */
describe("redirects nunca são seguidos automaticamente", () => {
  const source = readFileSync(join(process.cwd(), "lib/server/external-api-http.ts"), "utf8");

  it("usa node:https.request, que não segue redirect sozinho", () => {
    expect(source).toContain('from "node:https"');
    expect(source).toMatch(/httpsRequest\(/);
  });

  it("não usa cliente que segue redirect por padrão nem liga follow explicitamente", () => {
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/follow(Redirects?)?\s*[:=]\s*true/i);
    expect(source).not.toMatch(/maxRedirects\s*[:=]\s*[1-9]/);
  });

  it("resposta que não for JSON é recusada — um 302 com corpo HTML não vira dado", () => {
    expect(source).toContain("external_api_json_required");
  });

  it("aplica a política de IP no lookup de cada conexão, não só na URL", () => {
    expect(source).toContain("lookup: safeLookup");
    expect(source).toContain("isBlockedExternalApiIp");
  });
});
