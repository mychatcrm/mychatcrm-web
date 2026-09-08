/**
 * r2-storage.ts
 * Cliente Cloudflare R2 (S3-compatible) para armazenamento de mídias do WhatsApp.
 * Usado como camada de archiving entre o download da mídia e o envio à IA.
 */
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// ---------------------------------------------------------------------------
// Cliente R2
// ---------------------------------------------------------------------------

function createR2Client(): S3Client | null {
  const endpoint = process.env.R2_ENDPOINT?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    // Cloudflare R2 requer path-style (não virtual-hosted-style)
    forcePathStyle: true,
  });
}

// Singleton — módulo é carregado uma vez por instância serverless
const r2Client = createR2Client();
const BUCKET = process.env.R2_BUCKET?.trim() ?? "mychatcrm-media";

export function getR2BucketName(): string {
  return BUCKET;
}

export function isR2Configured(): boolean {
  return Boolean(r2Client);
}

/** Mensagem amigável quando alguma env R2_* obrigatória está ausente. */
export function getR2ConfigurationError(): string | null {
  if (!process.env.R2_ENDPOINT?.trim()) {
    return "Armazenamento R2 indisponível: configure R2_ENDPOINT na Vercel.";
  }
  if (!process.env.R2_ACCESS_KEY_ID?.trim()) {
    return "Armazenamento R2 indisponível: configure R2_ACCESS_KEY_ID na Vercel.";
  }
  if (!process.env.R2_SECRET_ACCESS_KEY?.trim()) {
    return "Armazenamento R2 indisponível: configure R2_SECRET_ACCESS_KEY na Vercel.";
  }
  if (!process.env.R2_BUCKET?.trim()) {
    return "Armazenamento R2 indisponível: configure R2_BUCKET na Vercel.";
  }
  return null;
}

export function assertR2Configured(): void {
  const error = getR2ConfigurationError();
  if (error) throw new Error(error);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Faz upload de um buffer para o R2 e retorna a key (caminho) do arquivo.
 * Não lança excepção — retorna null em caso de falha para não bloquear o fluxo principal.
 */
export async function uploadMediaToR2(
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<string | null> {
  if (!r2Client) {
    console.warn("[r2-storage] cliente não configurado — variáveis R2_* em falta");
    return null;
  }

  try {
    await r2Client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: filename,
        Body: buffer,
        ContentType: mimetype,
        ContentLength: buffer.byteLength,
      }),
    );
    return filename;
  } catch (e) {
    console.warn("[r2-storage] upload error", e);
    return null;
  }
}

export async function createR2PresignedUploadUrl(params: {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<string> {
  assertR2Configured();
  if (!r2Client) {
    throw new Error(getR2ConfigurationError() ?? "Armazenamento R2 indisponível.");
  }
  return getSignedUrl(
    r2Client,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: params.key,
      ContentType: params.contentType,
    }),
    { expiresIn: params.expiresInSeconds ?? 900 },
  );
}

/** URL HTTPS temporária para leitura pública da Evolution (GET presignado R2). */
export async function createR2PresignedGetUrl(params: {
  key: string;
  expiresInSeconds?: number;
}): Promise<string> {
  assertR2Configured();
  if (!r2Client) {
    throw new Error(getR2ConfigurationError() ?? "Armazenamento R2 indisponível.");
  }
  return getSignedUrl(
    r2Client,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: params.key,
    }),
    { expiresIn: params.expiresInSeconds ?? 3600 },
  );
}

export async function headR2Object(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null> {
  if (!r2Client) throw new Error("[r2-storage] cliente não configurado");
  try {
    const res = await r2Client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return {
      sizeBytes: Number(res.ContentLength ?? 0),
      contentType: res.ContentType ?? null,
    };
  } catch {
    return null;
  }
}

export async function deleteR2Object(key: string): Promise<void> {
  if (!r2Client) throw new Error("[r2-storage] cliente não configurado");
  await r2Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// ---------------------------------------------------------------------------
// Multipart upload
//
// Gravação longa não pode virar um PUT único: a aba pode morrer, o 4G pode
// cair, e o usuário perderia a reunião inteira. Com multipart, cada parte já
// confirmada fica no R2, e o objeto final é montado pelo próprio R2 — byte a
// byte idêntico a uma gravação contínua.
//
// Isso importa mais do que parece para áudio: em WebM/Opus só o PRIMEIRO chunk
// do MediaRecorder carrega o cabeçalho do container. Subir chunks como objetos
// separados produziria arquivos que ninguém consegue decodificar. Partes de um
// mesmo multipart são fatias de bytes do mesmo stream, então o resultado é
// sempre válido.
// ---------------------------------------------------------------------------

/** Mínimo de 5 MB por parte imposto pelo protocolo S3 (a última parte é isenta). */
export const R2_MIN_PART_BYTES = 5 * 1024 * 1024;
/** Teto do protocolo S3. */
export const R2_MAX_PARTS = 10_000;

export async function createR2MultipartUpload(params: {
  key: string;
  contentType: string;
}): Promise<string> {
  assertR2Configured();
  if (!r2Client) throw new Error(getR2ConfigurationError() ?? "Armazenamento R2 indisponível.");

  const res = await r2Client.send(
    new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: params.key,
      ContentType: params.contentType,
    }),
  );
  if (!res.UploadId) throw new Error("[r2-storage] multipart sem UploadId");
  return res.UploadId;
}

/**
 * URL para o browser enviar UMA parte direto ao R2.
 *
 * O byte do áudio nunca passa pelo servidor Next: sem isso, o limite de payload
 * e a banda da função serverless viravam o gargalo de todo o produto.
 */
export async function createR2PresignedPartUrl(params: {
  key: string;
  uploadId: string;
  partNumber: number;
  expiresInSeconds?: number;
}): Promise<string> {
  assertR2Configured();
  if (!r2Client) throw new Error(getR2ConfigurationError() ?? "Armazenamento R2 indisponível.");
  if (!Number.isInteger(params.partNumber) || params.partNumber < 1 || params.partNumber > R2_MAX_PARTS) {
    throw new Error("[r2-storage] partNumber fora do intervalo");
  }

  return getSignedUrl(
    r2Client,
    new UploadPartCommand({
      Bucket: BUCKET,
      Key: params.key,
      UploadId: params.uploadId,
      PartNumber: params.partNumber,
    }),
    { expiresIn: params.expiresInSeconds ?? 3600 },
  );
}

export type R2CompletedPart = { partNumber: number; etag: string };

export async function completeR2MultipartUpload(params: {
  key: string;
  uploadId: string;
  parts: R2CompletedPart[];
}): Promise<void> {
  assertR2Configured();
  if (!r2Client) throw new Error(getR2ConfigurationError() ?? "Armazenamento R2 indisponível.");
  if (params.parts.length === 0) throw new Error("[r2-storage] multipart sem partes");

  await r2Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: params.key,
      UploadId: params.uploadId,
      MultipartUpload: {
        // A ordem é o que define o arquivo final. Enviar fora de ordem produz
        // áudio embaralhado em vez de erro, então ordenar aqui não é detalhe.
        Parts: [...params.parts]
          .sort((a, b) => a.partNumber - b.partNumber)
          .map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
      },
    }),
  );
}

/** Partes já confirmadas no R2 — base para retomar um upload interrompido. */
export async function listR2MultipartParts(params: {
  key: string;
  uploadId: string;
}): Promise<R2CompletedPart[]> {
  assertR2Configured();
  if (!r2Client) throw new Error(getR2ConfigurationError() ?? "Armazenamento R2 indisponível.");

  const parts: R2CompletedPart[] = [];
  let marker: number | undefined;

  // Paginado: uma reunião longa passa de 1000 partes.
  for (;;) {
    const res = await r2Client.send(
      new ListPartsCommand({
        Bucket: BUCKET,
        Key: params.key,
        UploadId: params.uploadId,
        PartNumberMarker: marker === undefined ? undefined : String(marker),
      }),
    );
    for (const part of res.Parts ?? []) {
      if (typeof part.PartNumber === "number" && typeof part.ETag === "string") {
        parts.push({ partNumber: part.PartNumber, etag: part.ETag });
      }
    }
    if (!res.IsTruncated) break;
    const next = Number(res.NextPartNumberMarker);
    if (!Number.isFinite(next)) break;
    marker = next;
  }

  return parts.sort((a, b) => a.partNumber - b.partNumber);
}

/**
 * Cancela o multipart e libera as partes já enviadas.
 *
 * Multipart abandonado continua ocupando (e custando) espaço sem aparecer na
 * listagem do bucket — por isso a varredura semanal, além desta chamada.
 */
export async function abortR2MultipartUpload(params: {
  key: string;
  uploadId: string;
}): Promise<void> {
  if (!r2Client) return;
  try {
    await r2Client.send(
      new AbortMultipartUploadCommand({
        Bucket: BUCKET,
        Key: params.key,
        UploadId: params.uploadId,
      }),
    );
  } catch (e) {
    console.warn("[r2-storage] abort multipart error", e);
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Baixa um arquivo do R2 pela sua key e retorna o Buffer.
 * Lança excepção em caso de falha (ficheiro não existe, credenciais erradas, etc.).
 */
export async function getMediaBufferFromR2(filename: string): Promise<Buffer> {
  if (!r2Client) throw new Error("[r2-storage] cliente não configurado");

  const res = await r2Client.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: filename }),
  );

  const bytes = await res.Body?.transformToByteArray();
  if (!bytes || bytes.byteLength === 0) throw new Error("[r2-storage] resposta vazia");

  return Buffer.from(bytes);
}
