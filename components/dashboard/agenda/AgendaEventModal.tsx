"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Toggle } from "@/components/ui/Toggle";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import type { ClientAgendaEvent } from "@/lib/agenda/client-event";
import { AGENDA_EVENT_COLORS, DEFAULT_EVENT_COLOR } from "./agenda-constants";
import { toDatetimeLocalValue } from "./agenda-date-utils";

export type AgendaEventFormState = {
  title: string;
  startAt: string;
  endAt: string;
  description: string;
  location: string;
  meetLink: string;
  attendeeEmail: string;
  color: string;
  notifyWa: boolean;
};

function defaultForm(seed?: Partial<AgendaEventFormState>): AgendaEventFormState {
  const start = seed?.startAt ? new Date(seed.startAt) : new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = seed?.endAt ? new Date(seed.endAt) : new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: seed?.title ?? "",
    startAt: seed?.startAt ?? toDatetimeLocalValue(start),
    endAt: seed?.endAt ?? toDatetimeLocalValue(end),
    description: seed?.description ?? "",
    location: seed?.location ?? "",
    meetLink: seed?.meetLink ?? "",
    attendeeEmail: seed?.attendeeEmail ?? "",
    color: seed?.color ?? DEFAULT_EVENT_COLOR,
    notifyWa: seed?.notifyWa ?? false,
  };
}

function fromEvent(ev: ClientAgendaEvent): AgendaEventFormState {
  const meet = ev.description?.includes("Link:") ? ev.description.split("Link:")[1]?.trim() ?? "" : "";
  const desc = ev.description?.replace(/\n?Link:[\s\S]*$/, "").trim() ?? "";
  return defaultForm({
    title: ev.title,
    startAt: toDatetimeLocalValue(new Date(ev.startISO)),
    endAt: toDatetimeLocalValue(new Date(ev.endISO)),
    description: desc,
    location: ev.location ?? "",
    meetLink: meet,
    attendeeEmail: ev.attendeeEmail ?? "",
    color: ev.color ?? DEFAULT_EVENT_COLOR,
    notifyWa: false,
  });
}

export function AgendaEventModal({
  open,
  onClose,
  onSave,
  editing,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (form: AgendaEventFormState) => Promise<void>;
  editing?: ClientAgendaEvent | null;
  initial?: Partial<AgendaEventFormState>;
}) {
  const [form, setForm] = useState<AgendaEventFormState>(() => defaultForm(initial));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) setForm(fromEvent(editing));
    else setForm(defaultForm(initial));
  }, [open, editing, initial]);

  const submit = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Editar evento" : "Novo evento"}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-content-secondary">Título</label>
          <Input className="mt-1" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} autoFocus />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-content-secondary">Início</label>
            <Input type="datetime-local" className="mt-1" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-medium text-content-secondary">Fim</label>
            <Input type="datetime-local" className="mt-1" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Descrição</label>
          <textarea
            className="mt-1 min-h-[72px] w-full rounded-xl border border-line bg-surface-elevated/35 px-3 py-2 text-sm"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Localização</label>
          <Input className="mt-1" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Link Meet / Zoom</label>
          <Input className="mt-1" value={form.meetLink} onChange={(e) => setForm({ ...form, meetLink: e.target.value })} placeholder="https://..." />
        </div>
        <div>
          <label className="text-xs font-medium text-content-secondary">Convidado (e-mail)</label>
          <Input type="email" className="mt-1" value={form.attendeeEmail} onChange={(e) => setForm({ ...form, attendeeEmail: e.target.value })} />
        </div>
        <div>
          <p className="text-xs font-medium text-content-secondary">Cor do evento</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {AGENDA_EVENT_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-label={c.id}
                onClick={() => setForm({ ...form, color: c.hex })}
                className="size-7 rounded-full border-2 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c.hex,
                  borderColor: form.color === c.hex ? "#202124" : "transparent",
                }}
              />
            ))}
          </div>
        </div>
        <Toggle id="agenda-notify-wa" checked={form.notifyWa} onChange={(v) => setForm({ ...form, notifyWa: v })} label="Notificar via WhatsApp" />
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" variant="gradient" disabled={saving || !form.title.trim()} onClick={() => void submit()}>
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
