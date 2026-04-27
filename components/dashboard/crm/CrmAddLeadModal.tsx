"use client";

import { useState } from "react";
import type { ClientLead } from "@/lib/dashboard-data";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";

function todayLocalISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CrmAddLeadModal({
  open,
  onClose,
  funilId,
  firstStageId,
  onCreate,
  ownerEmployeeId,
  responsavelLabel,
}: {
  open: boolean;
  onClose: () => void;
  funilId: string;
  firstStageId: string;
  onCreate: (lead: ClientLead) => void;
  /** Quando o utilizador está ligado a um registo de colaborador (hierarquia). */
  ownerEmployeeId?: string;
  /** Texto exibido em «Responsável» no CRM Kanban. */
  responsavelLabel?: string;
}) {
  const [nome, setNome] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [err, setErr] = useState("");

  const submit = () => {
    if (!nome.trim()) {
      setErr("Informe o nome do lead.");
      return;
    }
    const id = `lead-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : String(Date.now())}`;
    const lead: ClientLead = {
      id,
      funilId,
      dataEntradaISO: todayLocalISODate(),
      nome: nome.trim(),
      empresa: empresa.trim() || "—",
      telefone: telefone.trim() || "—",
      email: email.trim() || "—",
      valor: 0,
      status: firstStageId,
      tag: "Novo",
      agenteEntrada: "Agente padrão · Painel",
      agenteAtendendo: "Agente padrão · Painel",
      tags: ["Novo", "Manual"],
      responsavel: responsavelLabel?.trim() || "Equipe",
      ownerEmployeeId: ownerEmployeeId?.trim() || undefined,
      ultimoContato: "Agora",
      proximaAcao: "Qualificar interesse",
      origem: "Entrada manual",
    };
    onCreate(lead);
    setNome("");
    setEmpresa("");
    setEmail("");
    setTelefone("");
    setErr("");
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Novo lead"
      className="max-w-md"
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit}>
            Criar lead
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-content-muted">O lead entra na primeira etapa do funil selecionado no CRM Kanban.</p>
        <div>
          <label className="text-xs text-content-faint">Nome</label>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} className="mt-1" placeholder="Nome completo" />
        </div>
        <div>
          <label className="text-xs text-content-faint">Empresa</label>
          <Input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-xs text-content-faint">Telefone</label>
          <Input value={telefone} onChange={(e) => setTelefone(e.target.value)} className="mt-1" placeholder="(00) 00000-0000" />
        </div>
        <div>
          <label className="text-xs text-content-faint">E-mail</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
        </div>
        {err ? <p className="text-sm text-rose-300">{err}</p> : null}
      </div>
    </Modal>
  );
}
