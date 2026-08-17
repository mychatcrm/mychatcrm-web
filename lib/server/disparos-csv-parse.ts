/**
 * Leitura de lista de contatos colada/enviada pelo cliente.
 *
 * Função pura de propósito: separar o parsing do acesso ao banco deixa o
 * formato — que é onde mora a bagunça do mundo real — coberto por teste sem
 * precisar de Supabase.
 *
 * O que o cliente manda nunca é limpo: cabeçalho às vezes existe, às vezes não;
 * separador é vírgula ou ponto e vírgula (Excel brasileiro exporta com `;`);
 * telefone vem com parênteses, traço, espaço e às vezes sem o 55.
 */
import { ensureBrazilianMobileWhatsappDigits } from "@/lib/integrations/evolution-api";

/** Teto por importação — mesmo limite já usado nas consultas de público. */
export const DISPAROS_IMPORT_MAX_ROWS = 5000;

export type ParsedContact = {
  name: string | null;
  /** Telefone normalizado (com DDI e 9º dígito quando aplicável). */
  phone: string;
};

export type CsvParseResult = {
  contacts: ParsedContact[];
  /** Linhas descartadas, com o motivo e o conteúdo original para o cliente conferir. */
  invalid: Array<{ line: number; raw: string; reason: "sem_telefone" | "telefone_invalido" }>;
  /** Telefones repetidos DENTRO do próprio arquivo (o primeiro vence). */
  duplicatesInFile: number;
  /** true quando o arquivo passou do teto e foi cortado. */
  truncated: boolean;
};

/** Divide respeitando aspas: `"Silva, João";5562...` não pode virar 3 colunas. */
function splitLine(line: string, separator: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // Aspas duplas escapadas ("") viram uma aspa literal.
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === separator && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((value) => value.trim());
}

/** Excel pt-BR exporta com `;`. Decide pelo que aparece mais na primeira linha. */
function detectSeparator(firstLine: string): string {
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  if (tabs > semicolons && tabs > commas) return "\t";
  return semicolons > commas ? ";" : ",";
}

const NAME_HEADERS = ["nome", "name", "contato", "cliente", "lead"];
const PHONE_HEADERS = ["telefone", "phone", "celular", "whatsapp", "numero", "número", "fone", "tel"];

/**
 * Descobre quais colunas são nome e telefone.
 *
 * Com cabeçalho reconhecido, usa os nomes. Sem cabeçalho, cai na heurística:
 * a coluna com mais dígitos é o telefone, a outra é o nome. Exigir cabeçalho
 * seria rejeitar a lista que o cliente exportou de qualquer lugar.
 */
function resolveColumns(
  cells: string[],
): { nameIndex: number; phoneIndex: number; isHeader: boolean } {
  const lower = cells.map((c) => c.toLowerCase().replace(/^"|"$/g, "").trim());
  const nameIndex = lower.findIndex((c) => NAME_HEADERS.includes(c));
  const phoneIndex = lower.findIndex((c) => PHONE_HEADERS.includes(c));

  if (phoneIndex >= 0) {
    return { nameIndex: nameIndex >= 0 ? nameIndex : phoneIndex === 0 ? 1 : 0, phoneIndex, isHeader: true };
  }

  // Sem cabeçalho: a coluna com mais dígitos é o telefone.
  let bestIndex = 0;
  let bestDigits = -1;
  cells.forEach((cell, index) => {
    const digits = cell.replace(/\D/g, "").length;
    if (digits > bestDigits) {
      bestDigits = digits;
      bestIndex = index;
    }
  });
  return { nameIndex: bestIndex === 0 ? 1 : 0, phoneIndex: bestIndex, isHeader: false };
}

export function parseDisparosContactsCsv(raw: string): CsvParseResult {
  const invalid: CsvParseResult["invalid"] = [];
  const contacts: ParsedContact[] = [];
  const seen = new Set<string>();
  let duplicatesInFile = 0;

  const lines = raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return { contacts, invalid, duplicatesInFile, truncated: false };
  }

  const separator = detectSeparator(lines[0]!);
  const firstCells = splitLine(lines[0]!, separator);
  const { nameIndex, phoneIndex, isHeader } = resolveColumns(firstCells);

  const dataLines = isHeader ? lines.slice(1) : lines;
  const truncated = dataLines.length > DISPAROS_IMPORT_MAX_ROWS;
  const usable = truncated ? dataLines.slice(0, DISPAROS_IMPORT_MAX_ROWS) : dataLines;

  usable.forEach((line, index) => {
    // +1 para linha humana; +1 de novo quando houve cabeçalho consumido.
    const lineNumber = index + 1 + (isHeader ? 1 : 0);
    const cells = splitLine(line, separator);
    const rawPhone = cells[phoneIndex] ?? "";
    const rawName = (cells[nameIndex] ?? "").replace(/^"|"$/g, "").trim();

    if (!rawPhone.replace(/\D/g, "")) {
      invalid.push({ line: lineNumber, raw: line.slice(0, 120), reason: "sem_telefone" });
      return;
    }

    // Mesma normalização do resto da plataforma (13 dígitos em móvel BR): sem
    // isso o mesmo contato entraria duas vezes, uma grafia com 9 e outra sem.
    // A base real tem as duas formas, então o dedupe contra `leads` compara
    // pelas duas variantes — aqui só padronizamos o que vai ser gravado.
    const phone = ensureBrazilianMobileWhatsappDigits(rawPhone.replace(/\D/g, ""));
    if (!phone || phone.length < 10) {
      invalid.push({ line: lineNumber, raw: line.slice(0, 120), reason: "telefone_invalido" });
      return;
    }

    if (seen.has(phone)) {
      duplicatesInFile++;
      return;
    }
    seen.add(phone);
    contacts.push({ name: rawName || null, phone });
  });

  return { contacts, invalid, duplicatesInFile, truncated };
}
