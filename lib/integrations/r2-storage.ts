/**
 * r2-storage.ts
 * Cliente Cloudflare R2 (S3-compatible) para armazenamento de mídias do WhatsApp.
 * Usado como camada de archiving entre o download da mídia e o envio à IA.
 */
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
  if (!r2Client) throw new Error("[r2-storage] cliente não configurado");
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
