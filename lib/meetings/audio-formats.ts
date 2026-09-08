/**
 * Formatos de audio aceitos, do gravador e do upload.
 *
 * Compartilhado entre browser e servidor: a mesma lista valida o seletor de
 * arquivos e a rota que reserva o upload. Duas listas divergentes seriam a
 * forma classica de o usuario conseguir enviar algo que o pipeline recusa
 * depois.
 */

/** Extensao canonica gravada no R2 para cada tipo. */
const MIME_TO_EXTENSION: Record<string, string> = {
  // Gravacao no navegador
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a", // Safari (iOS e macOS) grava fMP4/AAC
  // Upload
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/aac": "aac",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/amr": "amr", // gravador nativo de muitos Android
  "audio/3gpp": "3gp",
  // Contêineres de video: aceitos porque a pessoa grava a call e sobe o arquivo
  // inteiro. O provedor extrai a faixa de audio.
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

export const MEETING_ACCEPTED_MIME_TYPES: readonly string[] = Object.keys(MIME_TO_EXTENSION);

/** Valor pronto para o atributo `accept` de um `<input type="file">`. */
export const MEETING_FILE_ACCEPT_ATTRIBUTE = [
  ...MEETING_ACCEPTED_MIME_TYPES,
  ".mp3",
  ".m4a",
  ".wav",
  ".aac",
  ".ogg",
  ".opus",
  ".webm",
  ".flac",
  ".amr",
  ".mp4",
  ".mov",
].join(",");

/** Normaliza `audio/webm;codecs=opus` para `audio/webm`. */
export function normalizeAudioMimeType(mimeType: string): string {
  return (mimeType.split(";")[0] ?? "").trim().toLowerCase();
}

export function isAcceptedAudioMimeType(mimeType: string): boolean {
  return normalizeAudioMimeType(mimeType) in MIME_TO_EXTENSION;
}

/**
 * Extensao para a chave do R2. Nunca deriva do nome enviado pelo usuario: o
 * nome do arquivo e entrada nao confiavel e nao pode influenciar o caminho no
 * storage.
 */
export function audioExtensionFor(mimeType: string): string | null {
  return MIME_TO_EXTENSION[normalizeAudioMimeType(mimeType)] ?? null;
}

/**
 * Ordem de preferencia do `MediaRecorder`.
 *
 * Opus primeiro (melhor qualidade por bit, e 32 kbps mono ja bastam para fala).
 * `audio/mp4` no fim porque e o unico que o Safari suporta — sem ele, gravar no
 * iPhone simplesmente nao acontece.
 */
export const MEDIA_RECORDER_MIME_PREFERENCE: readonly string[] = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/**
 * 32 kbps mono e o ponto de equilibrio para fala: 14,4 MB por hora, upload
 * viavel em 4G, e nenhuma perda perceptivel de precisao na transcricao.
 */
export const MEETING_RECORDER_AUDIO_BITS_PER_SECOND = 32_000;

/**
 * Constraints da captura.
 *
 * `noiseSuppression` e `echoCancellation` ficam DESLIGADOS de proposito: os
 * dois foram feitos para chamada de voz de uma pessoa perto do microfone, e em
 * reuniao presencial cortam justamente quem esta mais longe da mesa — o que
 * degrada a separacao de falantes.
 */
export const MEETING_RECORDER_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: true,
  channelCount: 1,
};

/** Primeiro formato suportado pelo navegador atual, ou `null` se nenhum for. */
export function pickSupportedRecorderMimeType(
  isSupported: (mimeType: string) => boolean,
): string | null {
  return MEDIA_RECORDER_MIME_PREFERENCE.find((type) => isSupported(type)) ?? null;
}
