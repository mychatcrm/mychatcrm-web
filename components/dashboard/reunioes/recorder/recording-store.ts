/**
 * Buffer local da gravação em IndexedDB.
 *
 * Camada durável imediata: cada trecho de 5 s é gravado aqui no ato, então um
 * refresh, um crash da aba ou uma queda de energia perdem no máximo 5 segundos.
 * As partes de 5 MB que sobem para o R2 são a segunda camada — a 32 kbps, uma
 * parte equivale a ~21 minutos de áudio, espaçado demais para ser a única
 * garantia.
 *
 * API nativa de propósito: `idb` resolveria isto em menos linhas, mas não vale
 * uma dependência para ~120 linhas de código estável.
 */

const DB_NAME = "mychatcrm-meetings";
const DB_VERSION = 1;
const CHUNK_STORE = "chunks";
const SESSION_STORE = "sessions";

export type RecordingSession = {
  meetingId: string;
  mimeType: string;
  startedAt: number;
  /** Última posição confirmada no R2 — retomada começa daqui. */
  uploadedParts: Array<{ partNumber: number; etag: string }>;
  nextPartNumber: number;
  /** Sequência do primeiro chunk que ainda não virou parte enviada. */
  firstPendingSeq: number;
  durationMs: number;
};

type ChunkRow = { key: string; meetingId: string; seq: number; blob: Blob };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHUNK_STORE)) {
        const store = db.createObjectStore(CHUNK_STORE, { keyPath: "key" });
        store.createIndex("byMeeting", "meetingId", { unique: false });
      }
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "meetingId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb_open_failed"));
  });
}

function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T> | null,
): Promise<T | null> {
  return openDatabase().then(
    (db) =>
      new Promise<T | null>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const request = work(store);
        tx.oncomplete = () => {
          db.close();
          resolve(request ? request.result : null);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("indexeddb_tx_failed"));
        };
      }),
  );
}

function chunkKey(meetingId: string, seq: number): string {
  // Zero-padding mantém a ordem lexicográfica igual à numérica no cursor.
  return `${meetingId}:${String(seq).padStart(8, "0")}`;
}

export async function saveChunk(meetingId: string, seq: number, blob: Blob): Promise<void> {
  await runTransaction<IDBValidKey>(CHUNK_STORE, "readwrite", (store) =>
    store.put({ key: chunkKey(meetingId, seq), meetingId, seq, blob } satisfies ChunkRow),
  );
}

/** Chunks a partir de uma sequência, em ordem. */
export async function readChunksFrom(meetingId: string, fromSeq: number): Promise<Blob[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHUNK_STORE, "readonly");
    const store = tx.objectStore(CHUNK_STORE);
    const range = IDBKeyRange.bound(chunkKey(meetingId, fromSeq), chunkKey(meetingId, 99_999_999));
    const blobs: Blob[] = [];
    const cursorRequest = store.openCursor(range);

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        blobs.push((cursor.value as ChunkRow).blob);
        cursor.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(blobs);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("indexeddb_read_failed"));
    };
  });
}

/** Libera os chunks já consolidados numa parte enviada. */
export async function deleteChunksBefore(meetingId: string, beforeSeq: number): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHUNK_STORE, "readwrite");
    const store = tx.objectStore(CHUNK_STORE);
    store.delete(IDBKeyRange.bound(chunkKey(meetingId, 0), chunkKey(meetingId, beforeSeq - 1)));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error("indexeddb_delete_failed"));
    };
  });
}

export async function saveSession(session: RecordingSession): Promise<void> {
  await runTransaction<IDBValidKey>(SESSION_STORE, "readwrite", (store) => store.put(session));
}

export async function readSession(meetingId: string): Promise<RecordingSession | null> {
  const result = await runTransaction<RecordingSession | undefined>(
    SESSION_STORE,
    "readonly",
    (store) => store.get(meetingId) as IDBRequest<RecordingSession | undefined>,
  );
  return result ?? null;
}

/** Sessões interrompidas — alimenta o banner "encontramos uma gravação". */
export async function listSessions(): Promise<RecordingSession[]> {
  const result = await runTransaction<RecordingSession[]>(
    SESSION_STORE,
    "readonly",
    (store) => store.getAll() as IDBRequest<RecordingSession[]>,
  );
  return result ?? [];
}

export async function clearSession(meetingId: string): Promise<void> {
  await runTransaction<undefined>(SESSION_STORE, "readwrite", (store) => {
    store.delete(meetingId);
    return null;
  });
  const db = await openDatabase();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(CHUNK_STORE, "readwrite");
    tx.objectStore(CHUNK_STORE).delete(
      IDBKeyRange.bound(chunkKey(meetingId, 0), chunkKey(meetingId, 99_999_999)),
    );
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

/**
 * Quanto ainda cabe. A gravação vive no IndexedDB até subir, então estourar a
 * cota do navegador no meio de uma reunião é perda real — o aviso precisa vir
 * antes.
 */
export async function estimateStorageUsage(): Promise<{ usedRatio: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!quota) return null;
    return { usedRatio: usage / quota };
  } catch {
    return null;
  }
}
