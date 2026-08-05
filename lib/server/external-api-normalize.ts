import "server-only";

import type { ExternalApiNormalizedRecord, ExternalApiNormalizedResult, ExternalApiResponseMapping } from "@/lib/external-api/types";

const MAX_RECORDS = 20;
const MAX_STRING = 1000;
const MAX_MEDIA = 10;

function valueAt(input: unknown, path?: string): unknown {
  if (!path) return undefined;
  let current = input;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function scalar(value: unknown): string | number | boolean | null {
  if (typeof value === "string") return value.slice(0, MAX_STRING);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return null;
}

function stringValue(value: unknown): string | null {
  const safe = scalar(value);
  return typeof safe === "string" ? safe : typeof safe === "number" || typeof safe === "boolean" ? String(safe) : null;
}

function normalizeRecord(row: unknown, mapping: ExternalApiResponseMapping): ExternalApiNormalizedRecord {
  const attributes: ExternalApiNormalizedRecord["attributes"] = {};
  for (const [label, path] of Object.entries(mapping.attributes ?? {})) {
    attributes[label] = scalar(valueAt(row, path));
  }
  const mediaValue = valueAt(row, mapping.media);
  const media = (Array.isArray(mediaValue) ? mediaValue : mediaValue == null ? [] : [mediaValue])
    .map(stringValue)
    .filter((item): item is string => Boolean(item))
    .slice(0, MAX_MEDIA);
  return {
    id: stringValue(valueAt(row, mapping.id)),
    title: stringValue(valueAt(row, mapping.title)),
    availability: scalar(valueAt(row, mapping.availability)),
    price: scalar(valueAt(row, mapping.price)) as string | number | null,
    currency: stringValue(valueAt(row, mapping.currency)),
    link: stringValue(valueAt(row, mapping.link)),
    media,
    attributes,
  };
}

export function normalizeExternalApiResponse(
  payload: unknown,
  mapping: ExternalApiResponseMapping,
): ExternalApiNormalizedResult {
  const selected = mapping.itemsPath ? valueAt(payload, mapping.itemsPath) : payload;
  const rows = Array.isArray(selected) ? selected : selected == null ? [] : [selected];
  return {
    records: rows.slice(0, MAX_RECORDS).map((row) => normalizeRecord(row, mapping)),
    truncated: rows.length > MAX_RECORDS,
  };
}
