import { LAB_MAX_UPLOAD_BYTES } from "./contracts";

/** Browser-only recorder. No upload and no WhatsApp send occurs here. */
export function createLabAudioRecorder(callbacks: { file: (file: File) => void; error: (code: string) => void; stopped: () => void }) {
  let recorder: MediaRecorder | null = null, stream: MediaStream | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let discarded = false, started = false, bytes = 0;
  const chunks: Blob[] = [];
  const release = () => { if (timer) clearTimeout(timer); timer = null; stream?.getTracks().forEach(track => track.stop()); };
  const stop = () => { if (recorder?.state === "recording") recorder.stop(); release(); };
  return {
    async start() {
      if (started) throw new Error("recording_already_started");
      started = true;
      try {
        if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) throw new Error("recording_unsupported");
        const format = [{ mime: "audio/webm;codecs=opus", ext: "webm" }, { mime: "audio/ogg;codecs=opus", ext: "ogg" }, { mime: "audio/mp4", ext: "m4a" }]
          .find(type => MediaRecorder.isTypeSupported(type.mime));
        if (!format) throw new Error("recording_unsupported");
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (discarded) { release(); return; }
        recorder = new MediaRecorder(stream, { mimeType: format.mime, audioBitsPerSecond: 64000 });
        recorder.ondataavailable = event => {
          bytes += event.data.size;
          if (bytes > LAB_MAX_UPLOAD_BYTES) { discarded = true; stop(); callbacks.error("recording_too_large"); }
          else if (!discarded && event.data.size) chunks.push(event.data);
        };
        recorder.onerror = () => { discarded = true; stop(); callbacks.error("recording_failed"); };
        recorder.onstop = () => {
          release(); callbacks.stopped();
          if (!discarded && bytes > 0) callbacks.file(new File(chunks, `recording.${format.ext}`, { type: format.mime }));
          else if (!discarded) callbacks.error("recording_empty");
          chunks.length = 0;
        };
        recorder.start(1000);
        timer = setTimeout(stop, 60000);
      } catch (error) {
        release();
        if (!discarded) { callbacks.stopped(); callbacks.error(error instanceof Error && error.message === "recording_unsupported" ? error.message : "microphone_unavailable"); }
      }
    },
    stop,
    cancel() { discarded = true; stop(); chunks.length = 0; },
  };
}
