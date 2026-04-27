"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type LeadCaptureModalProps = {
  open: boolean;
  mode: "agendamento" | "email";
  onClose: () => void;
  onSubmit: (payload: {
    nome: string;
    email: string;
    telefone?: string;
    plano?: string;
    mensagem?: string;
  }) => void;
};

export function LeadCaptureModal({
  open,
  mode,
  onClose,
  onSubmit,
}: LeadCaptureModalProps) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [plano, setPlano] = useState("Master");
  const [mensagem, setMensagem] = useState("");
  const [horario, setHorario] = useState("");

  const title =
    mode === "agendamento" ? "Agendar demonstração" : "Receber contato por email";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => {
              if (!nome.trim() || !email.trim()) return;
              onSubmit({
                nome: nome.trim(),
                email: email.trim(),
                telefone: telefone.trim() || undefined,
                plano,
                mensagem:
                  mode === "agendamento"
                    ? `Melhor horário: ${horario || "não informado"}`
                    : mensagem.trim() || undefined,
              });
              setNome("");
              setEmail("");
              setTelefone("");
              setPlano("Master");
              setMensagem("");
              setHorario("");
            }}
          >
            Enviar
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label htmlFor="lead-name" className="text-xs text-content-muted">
            Nome*
          </label>
          <Input
            id="lead-name"
            className="mt-1"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Seu nome"
          />
        </div>
        <div>
          <label htmlFor="lead-email" className="text-xs text-content-muted">
            E-mail*
          </label>
          <Input
            id="lead-email"
            className="mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com.br"
          />
        </div>
        <div>
          <label htmlFor="lead-phone" className="text-xs text-content-muted">
            Telefone
          </label>
          <Input
            id="lead-phone"
            className="mt-1"
            value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            placeholder="(62) 99999-9999"
          />
        </div>
        <div>
          <label htmlFor="lead-plan" className="text-xs text-content-muted">
            Plano de interesse
          </label>
          <select
            id="lead-plan"
            className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-surface-deep px-4 py-2 text-sm text-content focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/20"
            value={plano}
            onChange={(e) => setPlano(e.target.value)}
          >
            <option value="Profissional">Profissional</option>
            <option value="Master">Master</option>
            <option value="Não definido">Não definido</option>
          </select>
        </div>
        {mode === "agendamento" ? (
          <div>
            <label htmlFor="lead-time" className="text-xs text-content-muted">
              Melhor horário
            </label>
            <Input
              id="lead-time"
              className="mt-1"
              value={horario}
              onChange={(e) => setHorario(e.target.value)}
              placeholder="Ex: amanhã às 15h"
            />
          </div>
        ) : (
          <div>
            <label htmlFor="lead-message" className="text-xs text-content-muted">
              Mensagem
            </label>
            <textarea
              id="lead-message"
              className="mt-1 min-h-[120px] w-full rounded-xl border border-line bg-surface-deep px-4 py-3 text-sm text-content focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/20"
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Conte um pouco do que você precisa..."
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
