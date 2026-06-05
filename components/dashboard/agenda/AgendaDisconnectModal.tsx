"use client";

import { Modal } from "@/components/ui/Modal";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";

export function AgendaDisconnectModal({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Desconectar Google Calendar">
      <p className="text-sm text-content-muted">Deseja desligar a sincronização com o Google Calendar?</p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={loading} className="w-full sm:w-auto" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={loading}
          className="w-full border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100 sm:w-auto"
          onClick={onConfirm}
        >
          Desconectar
        </Button>
      </div>
    </Modal>
  );
}
