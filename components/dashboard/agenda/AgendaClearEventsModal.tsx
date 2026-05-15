"use client";

import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";

export function AgendaClearEventsModal({
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
    <Modal open={open} onClose={onClose} title="Limpar agenda sincronizada">
      <p className="text-sm text-[#5f6368]">
        Todos os eventos importados do Google Calendar serão removidos da sua agenda no MyChatCRM.
      </p>
      <p className="mt-2 text-sm text-[#5f6368]">
        Eventos criados manualmente <span className="font-medium text-[#3c4043]">não serão afetados</span>. Sua conexão com o Google permanece ativa.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={loading} className="w-full sm:w-auto" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          type="button"
          disabled={loading}
          className="inline-flex w-full items-center justify-center gap-2 border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 sm:w-auto"
          onClick={onConfirm}
        >
          <Trash2 className="size-3.5 shrink-0" />
          <span className="text-center leading-tight">Limpar agenda sincronizada</span>
        </Button>
      </div>
    </Modal>
  );
}
