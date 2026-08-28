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
 * salto SEM revalidar o destino anularia a checagem de IP.
 *
 * Contrato atual (desde o fix de 08/2026, motivado por conectores reais que
 * 308-redirecionam barra final e caíam num "json_required" sem explicação):
 * o cliente SEGUE redirect — até MAX_REDIRECTS saltos — mas cada salto passa
 * pelo MESMO `performHttpRequest` que a primeira chamada, então a política de
 * IP e o HTTPS-only rodam de novo a cada hop, nunca só na URL original. A
 * defesa continua estrutural (não sobe servidor de verdade), só que agora
 * prova o oposto do teste antigo: que existe UM único ponto de conexão real
 * (`httpsRequest(` aparece uma vez só) e que o laço de redirect passa por ele
 * — não por um `fetch`/`axios` com follow automático, nem por uma chamada
 * direta que pule a checagem.
 */
describe("redirects só são seguidos revalidando IP a cada salto", () => {
  const source = readFileSync(join(process.cwd(), "lib/server/external-api-http.ts"), "utf8");

  it("usa node:https.request, nunca fetch/axios com follow automático", () => {
    expect(source).toContain('from "node:https"');
    expect(source).toMatch(/httpsRequest\(/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/\baxios\b/);
    expect(source).not.toMatch(/follow(Redirects?)?\s*[:=]\s*true/i);
  });

  it("existe um único ponto de conexão real — todo salto passa pela mesma checagem de IP", () => {
    // Se isto passar a bater mais de uma vez, algum caminho novo pode estar
    // abrindo conexão sem passar por performHttpRequest (e sua checagem de IP).
    expect(source.match(/httpsRequest\(/g)?.length).toBe(1);
  });

  it("o número de saltos de redirect é limitado", () => {
    expect(source).toMatch(/MAX_REDIRECTS\s*=\s*[1-5]\b/);
  });

  it("só segue os status de redirect padrão, não qualquer 3xx", () => {
    expect(source).toContain("REDIRECT_STATUSES");
    expect(source).toMatch(/new Set\(\[301,\s*302,\s*303,\s*307,\s*308\]\)/);
  });

  it("resposta final que não for JSON é recusada — HTML de erro não vira dado", () => {
    expect(source).toContain("external_api_json_required");
  });

  it("aplica a política de IP no lookup de cada conexão, não só na URL", () => {
    expect(source).toContain("lookup: safeLookup");
    expect(source).toContain("isBlockedExternalApiIp");
    // A checagem de IP literal e o lookup seguro vivem dentro de
    // performHttpRequest — a mesma função chamada em cada salto do redirect.
    const fnStart = source.indexOf("function performHttpRequest");
    const fnEnd = source.indexOf("\n}\n", fnStart);
    const fnBody = source.slice(fnStart, fnEnd);
    expect(fnBody).toContain("lookup: safeLookup");
    expect(fnBody).toContain("isBlockedExternalApiIp");
  });

  it("cada salto exige HTTPS — não dá pra rebaixar pra http:// no meio do redirect", () => {
    const fnStart = source.indexOf("function performHttpRequest");
    const fnEnd = source.indexOf("\n}\n", fnStart);
    const fnBody = source.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/protocol\s*!==\s*"https:"/);
  });
});
