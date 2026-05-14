"use client";

import { Modal } from "@/components/ui/Modal";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";

export function AgendaDisconnectModal({
  open,
  onClose,
  onKeepEvents,
  onClearEvents,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onKeepEvents: () => void;
  onClearEvents: () => void;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Desconectar Google Calendar">
      <p className="text-sm text-[#5f6368]">O que deseja fazer com os eventos já sincronizados?</p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          variant="gradient"
          disabled={loading}
          className="w-full sm:flex-1"
          onClick={onKeepEvents}
        >
          Desconectar e manter eventos
        </Button>
        <Button
          type="button"
          disabled={loading}
          className="w-full border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 sm:flex-1"
          onClick={onClearEvents}
        >
          Desconectar e limpar agenda sincronizada
        </Button>
        <Button type="button" variant="outline" disabled={loading} className="w-full sm:w-auto" onClick={onClose}>
          Cancelar
        </Button>
      </div>
      <p className="mt-3 text-xs text-[#80868b]">
        Limpar remove apenas eventos vindos do Google. Eventos criados manualmente no MyChatCRM são mantidos.
      </p>
    </Modal>
  );
}
