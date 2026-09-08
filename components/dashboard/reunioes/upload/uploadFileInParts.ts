"use client";

/**
 * Envio de um arquivo já existente, em partes.
 *
 * Mesmo protocolo da gravação ao vivo, sem o IndexedDB: aqui o arquivo já está
 * no disco do usuário, então a única camada necessária é a remota. Se a rede
 * cair no meio, as partes confirmadas ficam no R2 e o envio continua de onde
 * parou pela rota de status.
 */

const PART_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_PART_RETRIES = 4;

export type UploadProgress = {
  sentBytes: number;
  totalBytes: number;
  partNumber: number;
  totalParts: number;
};

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const parsed = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof parsed.error === "string" ? parsed.error : `http_${response.status}`);
  }
  return parsed as T;
}

export async function uploadFileInParts(params: {
  meetingId: string;
  file: File;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const base = `/api/client/reunioes/${encodeURIComponent(params.meetingId)}/uploads`;
  await postJson(`${base}/start`);

  // Retomada: o que já está no R2 não sobe de novo.
  const status = await fetch(`${base}/status`)
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const alreadyUploaded: Array<{ partNumber: number; etag: string }> =
    (status?.uploadedParts as Array<{ partNumber: number; etag: string }>) ?? [];
  const doneNumbers = new Set(alreadyUploaded.map((part) => part.partNumber));

  const totalParts = Math.max(1, Math.ceil(params.file.size / PART_SIZE_BYTES));
  const parts: Array<{ partNumber: number; etag: string }> = [...alreadyUploaded];
  let sentBytes = alreadyUploaded.length * PART_SIZE_BYTES;

  for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
    if (params.signal?.aborted) throw new Error("upload_aborted");
    if (doneNumbers.has(partNumber)) continue;

    const start = (partNumber - 1) * PART_SIZE_BYTES;
    const slice = params.file.slice(start, Math.min(start + PART_SIZE_BYTES, params.file.size));

    let uploaded = false;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= MAX_PART_RETRIES && !uploaded; attempt += 1) {
      try {
        const { urls } = await postJson<{ urls: Array<{ partNumber: number; url: string }> }>(
          `${base}/part-urls`,
          { partNumbers: [partNumber] },
        );
        const target = urls.find((entry) => entry.partNumber === partNumber);
        if (!target) throw new Error("part_url_missing");

        const response = await fetch(target.url, {
          method: "PUT",
          body: slice,
          signal: params.signal,
        });
        if (!response.ok) throw new Error(`part_upload_http_${response.status}`);

        // ETag opcional: quem confirma as partes no fim e o proprio R2.
        parts.push({ partNumber, etag: response.headers.get("etag")?.replaceAll('"', "") ?? "" });
        uploaded = true;
        sentBytes += slice.size;
        params.onProgress?.({ sentBytes, totalBytes: params.file.size, partNumber, totalParts });
      } catch (error) {
        lastError = error;
        if (params.signal?.aborted) throw new Error("upload_aborted");
        await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 500 * 2 ** attempt)));
      }
    }

    if (!uploaded) {
      throw lastError instanceof Error ? lastError : new Error("part_upload_failed");
    }
  }

  await postJson(`${base}/complete`, { parts, recordedAt: new Date(params.file.lastModified).toISOString() });
}
