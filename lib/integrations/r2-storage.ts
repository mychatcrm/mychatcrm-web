/**
 * r2-storage.ts
 * Cliente Cloudflare R2 (S3-compatible) para armazenamento de mídias do WhatsApp.
 * Usado como camada de archiving entre o download da mídia e o envio à IA.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

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
  });
}

// Singleton — módulo é carregado uma vez por instância serverless
const r2Client = createR2Client();
const BUCKET = process.env.R2_BUCKET?.trim() ?? "mychatcrm-media";

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
