/**
 * Domínio do cliente: o que ele já tem, ou o que ele compra connosco.
 *
 * Duas coisas têm de estar certas aqui ou o cliente fica com a página no ar e o
 * endereço morto: normalizar o hostname do jeito que o DNS entende, e saber se
 * é apex ou subdomínio — porque apex não aceita CNAME e subdomínio não deve
 * usar A. Errar isso é o suporte de todo dia das plataformas que fazem isto mal.
 */

/**
 * Sufixos públicos de dois rótulos relevantes para o Brasil e para o mundo.
 *
 * Não é a PSL inteira (são milhares de entradas e mudam), é o recorte que cobre
 * o que um cliente brasileiro traz. Sufixo desconhecido cai no padrão de dois
 * rótulos, que é o certo para `.com`, `.io`, `.app` e afins.
 */
const TWO_LABEL_PUBLIC_SUFFIXES = new Set([
  "com.br", "net.br", "org.br", "gov.br", "edu.br", "adv.br", "eng.br",
  "med.br", "esp.br", "ind.br", "inf.br", "rec.br", "srv.br", "tur.br",
  "art.br", "blog.br", "eco.br", "emp.br", "app.br", "bio.br", "cnt.br",
  "ecn.br", "far.br", "flog.br", "fnd.br", "fot.br", "fst.br", "ggf.br",
  "imb.br", "jor.br", "lel.br", "mat.br", "mus.br", "not.br", "ntr.br",
  "odo.br", "ppg.br", "pro.br", "psc.br", "psi.br", "qsl.br", "radio.br",
  "slg.br", "teo.br", "trd.br", "vet.br", "vlog.br", "wiki.br", "zlg.br",
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "com.pt", "org.pt", "edu.pt", "gov.pt",
  "com.ar", "com.mx", "com.co", "com.pe", "com.uy", "com.py", "com.cl",
  "co.jp", "or.jp", "ne.jp", "ac.jp",
  "com.es", "org.es", "com.tr", "com.cn", "com.hk", "com.sg", "co.nz",
  "co.za", "co.in", "net.in", "org.in", "co.il", "com.ua", "com.pl",
]);

export type LandingHostKind = "apex" | "subdomain";

export type LandingHostValidation =
  | {
      ok: true;
      host: string;
      apex: string;
      kind: LandingHostKind;
      /** Rótulo à esquerda do apex, quando é subdomínio. */
      label: string | null;
    }
  | {
      ok: false;
      code:
        | "empty"
        | "too_long"
        | "invalid_chars"
        | "invalid_label"
        | "missing_tld"
        | "ip_address"
        | "punycode"
        | "reserved_tld"
        | "platform_domain";
      message: string;
    };

/** TLDs que não existem na internet pública — domínio interno não vira página. */
const RESERVED_TLDS = new Set([
  "local", "localhost", "localdomain", "internal", "intranet", "lan",
  "home", "corp", "test", "example", "invalid", "onion",
]);

function stripScheme(raw: string): string {
  let value = raw.trim();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  // Corta caminho, query, fragmento e credenciais — cliente cola a URL inteira.
  const at = value.lastIndexOf("@");
  if (at >= 0) value = value.slice(at + 1);
  value = value.split("/")[0] ?? "";
  value = value.split("?")[0] ?? "";
  value = value.split("#")[0] ?? "";
  // Porta.
  const colon = value.indexOf(":");
  if (colon >= 0) value = value.slice(0, colon);
  return value;
}

/**
 * Normaliza para a forma canónica: minúsculas, sem esquema, sem `www.`, sem
 * ponto final. `www` sai porque o cliente digita com e sem, e os dois têm de
 * apontar para a mesma página — senão ele compra tráfego para um endereço que
 * não existe.
 */
export function normalizeLandingHost(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  let host = stripScheme(value).toLowerCase();
  host = host.replace(/\.+$/, "");
  if (host.startsWith("www.") && host.split(".").length > 2) {
    host = host.slice(4);
  }
  return host;
}

/** Apex (domínio registável) de um host já normalizado. */
export function apexOf(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (TWO_LABEL_PUBLIC_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

export function validateLandingHost(raw: unknown, platformDomains: string[] = []): LandingHostValidation {
  const host = normalizeLandingHost(raw);

  if (!host) {
    return { ok: false, code: "empty", message: "Informe o domínio." };
  }
  if (host.length > 253) {
    return { ok: false, code: "too_long", message: "Domínio acima de 253 caracteres." };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes("[")) {
    return { ok: false, code: "ip_address", message: "Use um domínio, não um endereço IP." };
  }
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return {
      ok: false,
      code: "invalid_chars",
      message: "O domínio tem caracteres inválidos. Acentos e emojis não são aceites.",
    };
  }

  const labels = host.split(".");
  if (labels.length < 2) {
    return { ok: false, code: "missing_tld", message: "Informe o domínio completo, com a terminação." };
  }
  for (const label of labels) {
    if (!label || label.length > 63) {
      return { ok: false, code: "invalid_label", message: "Cada parte do domínio precisa de 1 a 63 caracteres." };
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      return { ok: false, code: "invalid_label", message: "Nenhuma parte do domínio pode começar ou terminar com hífen." };
    }
  }

  const tld = labels[labels.length - 1] ?? "";
  if (RESERVED_TLDS.has(tld)) {
    return { ok: false, code: "reserved_tld", message: "Esse domínio não existe na internet pública." };
  }
  if (!/^[a-z]{2,}$/.test(tld)) {
    return { ok: false, code: "missing_tld", message: "Terminação de domínio inválida." };
  }
  // `xn--` é IDNA. Aceitar homógrafo em domínio de cliente é abrir phishing.
  if (labels.some((label) => label.startsWith("xn--"))) {
    return {
      ok: false,
      code: "punycode",
      message: "Domínios internacionalizados ainda não são aceites.",
    };
  }

  const apex = apexOf(host);
  const normalizedPlatform = platformDomains
    .map((d) => normalizeLandingHost(d))
    .filter(Boolean);
  if (normalizedPlatform.some((d) => host === d || host.endsWith(`.${d}`))) {
    return {
      ok: false,
      code: "platform_domain",
      message: "Esse domínio pertence à plataforma. Use o endereço gratuito ou traga um domínio seu.",
    };
  }

  const kind: LandingHostKind = host === apex ? "apex" : "subdomain";
  const label = kind === "subdomain" ? host.slice(0, host.length - apex.length - 1) : null;
  return { ok: true, host, apex, kind, label };
}

export type LandingDnsRecord = {
  type: "A" | "CNAME" | "TXT";
  /** Nome exatamente como o cliente digita no painel do registador. */
  name: string;
  value: string;
  purpose: "routing" | "verification";
  note?: string;
};

export const LANDING_DNS_VERIFICATION_PREFIX = "_mychatcrm";

/**
 * O que o cliente precisa de criar no DNS dele.
 *
 * Apex recebe A (não existe CNAME no apex sem suporte a ALIAS do registador);
 * subdomínio recebe CNAME, que sobrevive a troca de IP da plataforma. O TXT de
 * posse vai nos dois casos: sem prova, qualquer um reivindicaria domínio alheio.
 */
export function buildLandingDnsRecords(params: {
  host: string;
  kind: LandingHostKind;
  apex: string;
  label: string | null;
  verificationToken: string;
  cnameTarget: string;
  apexIp: string;
}): LandingDnsRecord[] {
  const records: LandingDnsRecord[] = [];

  if (params.kind === "apex") {
    records.push({
      type: "A",
      name: "@",
      value: params.apexIp,
      purpose: "routing",
      note: "Se o seu registador oferecer ALIAS ou ANAME, pode usar no lugar do A.",
    });
    records.push({
      type: "CNAME",
      name: "www",
      value: params.cnameTarget,
      purpose: "routing",
      note: "Faz www.<domínio> abrir a mesma página.",
    });
  } else {
    records.push({
      type: "CNAME",
      name: params.label ?? "@",
      value: params.cnameTarget,
      purpose: "routing",
    });
  }

  records.push({
    type: "TXT",
    name: params.kind === "apex"
      ? LANDING_DNS_VERIFICATION_PREFIX
      : `${LANDING_DNS_VERIFICATION_PREFIX}.${params.label}`,
    value: `mychatcrm-verification=${params.verificationToken}`,
    purpose: "verification",
    note: "Prova que o domínio é seu. Pode apagar depois que ficar ativo.",
  });

  return records;
}

/** Valor esperado no TXT — comparado com o que o DNS devolveu. */
export function expectedVerificationTxt(token: string): string {
  return `mychatcrm-verification=${token}`;
}

/**
 * Confere a resposta do DNS. Tolerante a aspas e a espaços porque cada
 * registador devolve o TXT de um jeito, e a comparação estrita rejeitava
 * domínio configurado corretamente.
 */
export function txtRecordsMatchToken(records: string[], token: string): boolean {
  const expected = expectedVerificationTxt(token).toLowerCase();
  return records.some((record) => {
    const cleaned = String(record ?? "")
      .replace(/^"+|"+$/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
    return cleaned === expected;
  });
}
