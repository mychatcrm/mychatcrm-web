"use client";

import { CalendarDays, Mail, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { HandoffReason } from "@/lib/chatbot";

type ChatHandoffProps = {
  reason: HandoffReason;
  onWhatsApp: () => void;
  onSchedule: () => void;
  onEmail: () => void;
};

export function ChatHandoff({
  reason,
  onWhatsApp,
  onSchedule,
  onEmail,
}: ChatHandoffProps) {
  const title =
    reason === "lead_quente"
      ? "Vamos conectar você com vendas! 🚀"
      : "Vamos conectar você com nossa equipe! 🚀";

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
      <h3 className="text-sm font-semibold text-content">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-content-secondary">
        Identificamos que você precisa de atenção personalizada. Nossa equipe está pronta
        para te ajudar agora.
      </p>

      <div className="mt-4 grid gap-2">
        <Button type="button" onClick={onWhatsApp} className="w-full justify-start sm:w-auto">
          <MessageCircle className="h-4 w-4" aria-hidden />
          💬 WhatsApp agora
        </Button>
        <Button type="button" variant="secondary" onClick={onSchedule} className="w-full justify-start sm:w-auto">
          <CalendarDays className="h-4 w-4" aria-hidden />
          📅 Agendar demonstração
        </Button>
        <Button type="button" variant="outline" onClick={onEmail} className="w-full justify-start sm:w-auto">
          <Mail className="h-4 w-4" aria-hidden />
          ✉️ Receber contato por email
        </Button>
      </div>
    </div>
  );
}
