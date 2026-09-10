"use client";
import { useEffect, useRef, useState } from "react";
import { createLabAudioRecorder } from "@/lib/agent-test-lab/audio-recorder";
import { uploadLabFile } from "@/lib/agent-test-lab/upload-client";

export function AgentTestLabRecorder({ disabled, onAttachment }: { disabled: boolean; onAttachment: (asset: { id: string; filename: string }) => void }) {
  const recorder = useRef<ReturnType<typeof createLabAudioRecorder> | null>(null);
  const mounted = useRef(true);
  const [recording, setRecording] = useState(false), [uploading, setUploading] = useState(false);
  const [clip, setClip] = useState<File | null>(null), [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; recorder.current?.cancel(); }; }, []);
  useEffect(() => { if (disabled) { recorder.current?.cancel(); setRecording(false); } }, [disabled]);
  useEffect(() => { if (!clip) { setUrl(""); return; } const next = URL.createObjectURL(clip); setUrl(next); return () => URL.revokeObjectURL(next); }, [clip]);
  const start = () => {
    if (disabled || recording || uploading) return;
    setClip(null); setError(""); setRecording(true);
    recorder.current = createLabAudioRecorder({
      file: file => { if (mounted.current) setClip(file); },
      stopped: () => { if (mounted.current) setRecording(false); },
      error: code => { if (mounted.current) { setRecording(false); setError(code); } },
    });
    void recorder.current.start();
  };
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    <button type="button" className="rounded-xl border border-white/15 px-3 py-2 disabled:opacity-40" disabled={disabled || uploading}
      onClick={() => recording ? recorder.current?.stop() : start()}>{recording ? "Parar gravação" : "Gravar áudio (até 60 s)"}</button>
    {recording && <span role="status">Gravando — para automaticamente em 60 segundos.</span>}
    {clip && !recording && <>
      <audio controls src={url} aria-label="Ouvir áudio gravado antes de anexar" />
      <button type="button" disabled={disabled || uploading} className="underline disabled:opacity-40" onClick={async () => {
        setUploading(true); setError("");
        try { const asset = await uploadLabFile(clip); if (mounted.current) { onAttachment(asset); setClip(null); } }
        catch { if (mounted.current) setError("audio_upload_failed"); }
        finally { if (mounted.current) setUploading(false); }
      }}>{uploading ? "Anexando…" : "Usar este áudio"}</button>
      <button type="button" disabled={uploading} className="underline" onClick={() => setClip(null)}>Descartar</button>
    </>}
    {error && <span role="alert" className="text-amber-400">Não foi possível preparar o áudio ({error}). Você também pode anexar um arquivo.</span>}
  </div>;
}
