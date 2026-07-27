"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Trash2, Users } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { PanelSelect as Select } from "@/components/panel/ui/PanelSelect";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import type { ClientSession } from "@/lib/client-auth";
import { CRM_LEAD_SEM_OWNER_LABEL, getDashboardDataset } from "@/lib/dashboard-data";
import {
  getPlanCollaboratorCapsForSession,
  getPlanMaxCollaboratorsTotalForSession,
  normalizeClientPlan,
} from "@/lib/plan-limits";
import { canActorTargetEmployeeForAdminActions } from "@/lib/organization-hierarchy";
import { cn } from "@/lib/utils";
import { refreshTeamEmployeesFromApi } from "@/lib/team-employees-client-cache";
import { applyClientSideCleanupAfterEmployeeRemoval } from "@/lib/team-employees-client-cleanup";
import {
  TEAM_EMPLOYEE_DELETE_CONFIRM_PHRASE,
  TEAM_EMPLOYEES_UPDATED_EVENT,
  canAddTeamEmployeeOfRole,
  creatableHierarchyRolesForSession,
  countTeamEmployeesByRole,
  loadTeamEmployees,
  previewRemovalCascadeFromList,
  validateTeamEmployeeInput,
  validateTeamEmployeeUpdate,
  type TeamEmployee,
  type TeamHierarchyRole,
} from "@/lib/team-employees-storage";

const ROLE_LABEL: Record<TeamHierarchyRole, string> = {
  director: "Diretor",
  manager: "Gerente",
  seller: "Vendedor",
};

function EyeIcon({ off }: { off?: boolean }) {
  if (off) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="text-content-muted">
        <path
          d="M3 3l18 18M10.5 10.5a3 3 0 004 4M9.9 5.1A10.4 10.4 0 0112 5c4 0 7.5 2.5 10 7-1 1.8-2.2 3.3-3.5 4.5M6.3 6.3C4.5 7.9 3 10 2 12c2.5 4.5 6 7 10 7 1.2 0 2.4-.2 3.5-.6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden className="text-content-muted">
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function TeamEmployeesHub({ session }: { session: ClientSession }) {
  const tenantId = session.tenantId;
  const planNorm = normalizeClientPlan(session.plan);
  const collabCaps = useMemo(() => getPlanCollaboratorCapsForSession(session), [session]);
  const maxCollaboratorsTotal = useMemo(() => getPlanMaxCollaboratorsTotalForSession(session), [session]);
  const { isLight } = usePanelAppearance();
  const [list, setList] = useState<TeamEmployee[]>([]);
  const [rev, setRev] = useState(0);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [funcao, setFuncao] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const creatable = useMemo(() => creatableHierarchyRolesForSession(session), [session]);
  const [hierarchyRole, setHierarchyRole] = useState<TeamHierarchyRole>(() => {
    const allowed = creatableHierarchyRolesForSession(session);
    return allowed[0] ?? "seller";
  });
  const [reportsToId, setReportsToId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<TeamEmployee | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [addModalOpen, setAddModalOpen] = useState(false);

  const [editTarget, setEditTarget] = useState<TeamEmployee | null>(null);
  const [editNome, setEditNome] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editFuncao, setEditFuncao] = useState("");
  const [editNewPassword, setEditNewPassword] = useState("");
  const [editShowPassword, setEditShowPassword] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [suspendTarget, setSuspendTarget] = useState<TeamEmployee | null>(null);

  useEffect(() => {
    setReportsToId("");
  }, [hierarchyRole]);

  useEffect(() => {
    if (!editTarget) return;
    setEditNome(editTarget.nome);
    setEditEmail(editTarget.email);
    setEditFuncao(editTarget.funcao);
    setEditNewPassword("");
    setEditShowPassword(false);
    setEditError(null);
  }, [editTarget]);

  useEffect(() => {
    if (creatable.length && !creatable.includes(hierarchyRole)) {
      setHierarchyRole(creatable[0]!);
    }
  }, [creatable, hierarchyRole]);

  const refresh = useCallback(async () => {
    await refreshTeamEmployeesFromApi(tenantId);
    setList(loadTeamEmployees(tenantId));
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh, rev]);

  useEffect(() => {
    const on = () => setRev((n) => n + 1);
    window.addEventListener(TEAM_EMPLOYEES_UPDATED_EVENT, on);
    return () => window.removeEventListener(TEAM_EMPLOYEES_UPDATED_EVENT, on);
  }, []);

  const cascadePreview = useMemo(() => {
    if (!deleteTarget) return [];
    return previewRemovalCascadeFromList(list, deleteTarget.id);
  }, [deleteTarget, list]);

  const directors = useMemo(() => list.filter((e) => e.hierarchyRole === "director"), [list]);
  const managers = useMemo(() => list.filter((e) => e.hierarchyRole === "manager"), [list]);

  const nDir = countTeamEmployeesByRole(list, "director");
  const nMgr = countTeamEmployeesByRole(list, "manager");
  const nSel = countTeamEmployeesByRole(list, "seller");
  const count = list.length;

  const canLinkDirector = hierarchyRole === "manager";
  const canLinkManager = hierarchyRole === "seller";

  const atCapForSelectedRole = !canAddTeamEmployeeOfRole(list, hierarchyRole, session.plan, session.operationalLimits);
  const atTotalCap = count >= maxCollaboratorsTotal;

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (creatable.length === 0) {
      setError("O seu papel não permite criar colaboradores aqui.");
      return;
    }
    if (atTotalCap) {
      setError(`Limite total de ${maxCollaboratorsTotal} colaboradores atingido para o seu plano.`);
      return;
    }
    if (atCapForSelectedRole) {
      setError(
        hierarchyRole === "director"
          ? `Limite de ${collabCaps.maxDirectors} diretores atingido.`
          : hierarchyRole === "manager"
            ? `Limite de ${collabCaps.maxManagers} gerentes atingido.`
            : `Limite de ${collabCaps.maxSellers} vendedores atingido.`,
      );
      return;
    }

    const payload = {
      nome,
      email,
      funcao,
      initialPassword,
      hierarchyRole,
      reportsToId: hierarchyRole === "director" ? undefined : reportsToId || undefined,
    };

    const validation = validateTeamEmployeeInput(list, payload);
    if (validation) {
      setError(validation);
      return;
    }

    const res = await fetch("/api/team-employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error ?? "Não foi possível guardar.");
      return;
    }
    setNome("");
    setEmail("");
    setFuncao("");
    setInitialPassword("");
    setReportsToId("");
    window.dispatchEvent(new Event(TEAM_EMPLOYEES_UPDATED_EVENT));
    await refresh();
    setAddModalOpen(false);
  };

  const onEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    if (!editTarget) return;

    const pwd = editNewPassword.trim();
    const validation = validateTeamEmployeeUpdate(list, editTarget.id, {
      nome: editNome,
      email: editEmail,
      funcao: editFuncao,
      initialPassword: pwd || undefined,
    });
    if (validation) {
      setEditError(validation);
      return;
    }

    const payload: { id: string; nome: string; email: string; funcao: string; initialPassword?: string } = {
      id: editTarget.id,
      nome: editNome,
      email: editEmail,
      funcao: editFuncao,
    };
    if (pwd) payload.initialPassword = pwd;

    const res = await fetch("/api/team-employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setEditError(data.error ?? "Não foi possível guardar.");
      return;
    }
    setEditTarget(null);
    window.dispatchEvent(new Event(TEAM_EMPLOYEES_UPDATED_EVENT));
    await refresh();
  };

  const runConfirmedSuspend = async () => {
    if (!suspendTarget) return;
    const res = await fetch("/api/team-employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: suspendTarget.id, accountSuspended: true }),
    });
    if (!res.ok) return;
    setSuspendTarget(null);
    window.dispatchEvent(new Event(TEAM_EMPLOYEES_UPDATED_EVENT));
    await refresh();
  };

  const toggleReativar = async (emp: TeamEmployee) => {
    const res = await fetch("/api/team-employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: emp.id, accountSuspended: false }),
    });
    if (!res.ok) return;
    window.dispatchEvent(new Event(TEAM_EMPLOYEES_UPDATED_EVENT));
    await refresh();
  };

  const confirmDeleteEnabled = deleteConfirmText.trim() === TEAM_EMPLOYEE_DELETE_CONFIRM_PHRASE;

  const runConfirmedDelete = async () => {
    if (!deleteTarget || !confirmDeleteEnabled) return;
    const fallbackLeads = getDashboardDataset(session).leads.map((l) => ({ ...l }));
    const res = await fetch("/api/team-employees", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ id: deleteTarget.id, confirmPhrase: deleteConfirmText.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      removedIds?: string[];
      removedProfiles?: TeamEmployee[];
    };
    if (!res.ok) {
      setError(data.error ?? "Não foi possível remover.");
      return;
    }
    if (data.removedIds?.length && data.removedProfiles) {
      applyClientSideCleanupAfterEmployeeRemoval(tenantId, data.removedProfiles, new Set(data.removedIds), fallbackLeads);
    }
    setDeleteTarget(null);
    setDeleteConfirmText("");
    window.dispatchEvent(new Event(TEAM_EMPLOYEES_UPDATED_EVENT));
    await refresh();
  };

  const cardClass = useMemo(
    () =>
      cn(
        "min-w-0 rounded-xl border p-5 sm:p-6",
        isLight
          ? "border-slate-200/80 bg-surface-deep text-content"
          : "border-line/80 bg-surface-card text-content",
      ),
    [isLight],
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-1 py-2 sm:px-2">
      {planNorm === "solo" ? (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 text-sm leading-relaxed",
            isLight
              ? "border-info/30 bg-info/10 text-content"
              : "border-info/30 bg-info/10 text-info",
          )}
        >
          <p>
            <strong className="font-semibold">Plano Solo:</strong> não inclui contas de diretor, gerente ou vendedor — é
            pensado para quem trabalha sozinho. Para hierarquia comercial,{" "}
            <Link href="/planos" className="font-semibold text-primary underline-offset-2 hover:underline">
              veja os planos Equipa ou Escala
            </Link>
            .
          </p>
        </div>
      ) : null}
      {planNorm !== "solo" && planNorm !== "enterprise" && count >= maxCollaboratorsTotal - 1 ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm",
            isLight ? "border-amber-200 bg-amber-50 text-amber-950" : "border-amber-500/35 bg-amber-500/10 text-amber-50",
          )}
        >
          <p className="min-w-0 flex-1">
            Está perto do limite de colaboradores do plano. Pode{" "}
            <Link href="/planos" className="font-semibold text-primary underline-offset-2 hover:underline">
              aumentar vagas ou fazer upgrade
            </Link>
            .
          </p>
        </div>
      ) : null}
      <section className={cardClass}>
        <div className="flex flex-wrap items-start gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
              isLight ? "bg-primary/10 text-primary" : "bg-primary/15 text-primary",
            )}
          >
            <Users className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-bold tracking-tight text-content">Colaboradores</h1>
            <p className="mt-1 text-sm leading-relaxed text-content-secondary">
              Hierarquia de <strong className="font-semibold text-content">diretor</strong>,{" "}
              <strong className="font-semibold text-content">gerente</strong> e{" "}
              <strong className="font-semibold text-content">vendedor</strong>, com vínculo hierárquico opcional e
              dentro dos limites do seu plano (
              <strong className="font-semibold text-content">
                {collabCaps.maxDirectors} diretores · {collabCaps.maxManagers} gerentes · {collabCaps.maxSellers}{" "}
                vendedores
              </strong>
              , até {maxCollaboratorsTotal} no total). Use estes registos nas regras de distribuição de leads.
            </p>
            <p className="mt-2 text-xs text-content-muted">
              Somente o <strong className="text-content-secondary">titular da conta</strong> pode acessar esta página e
              gerir a equipe. Gerentes podem ficar sem diretor e vendedores podem ficar sem gerente; o vínculo é
              opcional e pode ser definido quando fizer sentido para a operação.
            </p>
            <p className="mt-2 text-xs text-content-muted">
              Os campos marcados com * são <strong className="text-content-secondary">obrigatórios</strong>, incluindo a
              senha inicial. O vínculo com diretor ou gerente é opcional. O colaborador poderá alterar a senha nas{" "}
              <strong className="text-content-secondary">configurações da conta</strong> depois de entrar.
            </p>
            <p className="mt-2 text-xs text-content-muted">
              Depois, em{" "}
              <Link href="/dashboard/integracoes-leads" className="font-semibold text-primary underline-offset-2 hover:underline">
                Integrações de Leads
              </Link>
              , escolha como cada regra encaminha contactos para colaboradores ou para agentes de IA.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line/70 bg-surface-deep/20 px-3 py-2 text-sm text-content-secondary">
          <span className="font-medium text-content">{count}</span>
          <span>no total</span>
          <span className="text-content-muted">·</span>
          <span>
            {nDir}/{collabCaps.maxDirectors} diretores
          </span>
          <span className="text-content-muted">·</span>
          <span>
            {nMgr}/{collabCaps.maxManagers} gerentes
          </span>
          <span className="text-content-muted">·</span>
          <span>
            {nSel}/{collabCaps.maxSellers} vendedores
          </span>
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-content">Adicionar colaborador</h2>
        {creatable.length === 0 ? (
          <p className="mt-3 text-sm text-content-muted">
            {planNorm === "solo"
              ? "O plano Solo não inclui colaboradores hierárquicos. Faça upgrade para adicionar diretores, gerentes e vendedores."
              : "Apenas o titular da conta pode criar e gerir colaboradores aqui."}
          </p>
        ) : (
          <div className="mt-4">
            <Button type="button" className="min-h-[44px]" onClick={() => setAddModalOpen(true)}>
              Adicionar colaborador
            </Button>
          </div>
        )}
      </section>

      <Modal
        open={addModalOpen && creatable.length > 0}
        onClose={() => {
          setAddModalOpen(false);
          setError(null);
        }}
        title="Adicionar colaborador"
        className="max-w-xl sm:max-w-2xl"
      >
        <form className="space-y-3" onSubmit={onAdd}>
          <div>
            <label className="text-xs font-medium text-content-muted" htmlFor="emp-papel">
              Papel na hierarquia <span className="text-primary">*</span>
            </label>
            <Select
              id="emp-papel"
              className="mt-1"
              value={hierarchyRole}
              onChange={(e) => setHierarchyRole(e.target.value as TeamHierarchyRole)}
              required
            >
              {creatable.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </div>

          {canLinkDirector ? (
            <div>
              <label className="text-xs font-medium text-content-muted" htmlFor="emp-diretor">
                Diretor responsável <span className="text-content-faint">(opcional)</span>
              </label>
              <Select
                id="emp-diretor"
                className="mt-1"
                value={reportsToId}
                onChange={(e) => setReportsToId(e.target.value)}
              >
                <option value="">Sem diretor responsável</option>
                {directors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-content-muted">
                Pode deixar este gerente sem vínculo com um diretor.
              </p>
            </div>
          ) : null}

          {canLinkManager ? (
            <div>
              <label className="text-xs font-medium text-content-muted" htmlFor="emp-gerente">
                Gerente responsável <span className="text-content-faint">(opcional)</span>
              </label>
              <Select
                id="emp-gerente"
                className="mt-1"
                value={reportsToId}
                onChange={(e) => setReportsToId(e.target.value)}
              >
                <option value="">Sem gerente responsável</option>
                {managers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[11px] text-content-muted">
                Pode deixar este vendedor sem vínculo com um gerente.
              </p>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-content-muted" htmlFor="emp-nome">
                Nome completo <span className="text-primary">*</span>
              </label>
              <Input
                id="emp-nome"
                className="mt-1 h-11 rounded-xl"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: João Silva"
                autoComplete="name"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-content-muted" htmlFor="emp-email">
                Email <span className="text-primary">*</span>
              </label>
              <Input
                id="emp-email"
                type="email"
                className="mt-1 h-11 rounded-xl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="joao@empresa.com"
                autoComplete="email"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-content-muted" htmlFor="emp-funcao">
                Função / equipa <span className="text-primary">*</span>
              </label>
              <Input
                id="emp-funcao"
                className="mt-1 h-11 rounded-xl"
                value={funcao}
                onChange={(e) => setFuncao(e.target.value)}
                placeholder="Ex.: Comercial, Suporte"
                autoComplete="organization-title"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs font-medium text-content-muted" htmlFor="emp-senha">
                Senha inicial <span className="text-primary">*</span>
              </label>
              <p className="mt-0.5 text-[11px] text-content-muted">
                Mínimo de 5 caracteres. O colaborador pode alterar esta senha nas configurações da conta após o login.
              </p>
              <div className="relative mt-1">
                <Input
                  id="emp-senha"
                  type={showPassword ? "text" : "password"}
                  className="h-11 rounded-xl pr-12"
                  value={initialPassword}
                  onChange={(e) => setInitialPassword(e.target.value)}
                  placeholder="Defina uma senha inicial"
                  autoComplete="new-password"
                  required
                  minLength={6}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-content-muted outline-none transition hover:text-content-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-deep"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  <EyeIcon off={showPassword} />
                </button>
              </div>
            </div>
          </div>
          {error ? <p className={cn("text-xs font-medium", isLight ? "text-amber-800" : "text-amber-200")}>{error}</p> : null}
          <Button type="submit" className="min-h-[44px]" disabled={atTotalCap || atCapForSelectedRole}>
            {atCapForSelectedRole || atTotalCap ? "Limite atingido" : "Guardar colaborador"}
          </Button>
        </form>
      </Modal>

      <Modal
        open={Boolean(editTarget)}
        onClose={() => {
          setEditTarget(null);
          setEditError(null);
        }}
        title="Editar colaborador"
        className="max-w-xl sm:max-w-2xl"
      >
        {editTarget ? (
          <form className="space-y-3" onSubmit={onEditSubmit}>
            <div className="rounded-xl border border-line/70 bg-surface-deep/15 px-3 py-2 text-sm text-content-secondary">
              <span className="text-content-muted">Papel na hierarquia: </span>
              <span className="font-medium text-content">{ROLE_LABEL[editTarget.hierarchyRole]}</span>
              <span className="text-content-muted"> (não pode ser alterado aqui)</span>
            </div>
            <div>
              <label className="text-xs font-medium text-content-muted" htmlFor="edit-emp-nome">
                Nome completo <span className="text-primary">*</span>
              </label>
              <Input
                id="edit-emp-nome"
                className="mt-1 h-11 rounded-xl"
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
                autoComplete="name"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-muted" htmlFor="edit-emp-email">
                Email <span className="text-primary">*</span>
              </label>
              <Input
                id="edit-emp-email"
                type="email"
                className="mt-1 h-11 rounded-xl"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-muted" htmlFor="edit-emp-funcao">
                Função / equipa <span className="text-primary">*</span>
              </label>
              <Input
                id="edit-emp-funcao"
                className="mt-1 h-11 rounded-xl"
                value={editFuncao}
                onChange={(e) => setEditFuncao(e.target.value)}
                autoComplete="organization-title"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-content-muted" htmlFor="edit-emp-senha">
                Nova senha inicial <span className="text-content-muted">(opcional)</span>
              </label>
              <p className="mt-0.5 text-[11px] text-content-muted">
                Deixe em branco para manter a senha atual. Mínimo de 5 caracteres se alterar.
              </p>
              <div className="relative mt-1">
                <Input
                  id="edit-emp-senha"
                  type={editShowPassword ? "text" : "password"}
                  className="h-11 rounded-xl pr-12"
                  value={editNewPassword}
                  onChange={(e) => setEditNewPassword(e.target.value)}
                  placeholder="Manter senha atual"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setEditShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-content-muted outline-none transition hover:text-content-secondary focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-deep"
                  aria-label={editShowPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  <EyeIcon off={editShowPassword} />
                </button>
              </div>
            </div>
            {editError ? <p className={cn("text-xs font-medium", isLight ? "text-amber-800" : "text-amber-200")}>{editError}</p> : null}
            <Button type="submit" className="min-h-[44px]">
              Guardar alterações
            </Button>
          </form>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(suspendTarget)}
        onClose={() => setSuspendTarget(null)}
        title="Suspender colaborador"
        footer={
          <>
            <Button
              variant="outline"
              className={cn(
                "min-h-[44px] font-semibold",
                isLight &&
                  "border-line/80 bg-surface-deep text-content hover:border-line",
              )}
              onClick={() => setSuspendTarget(null)}
            >
              Cancelar
            </Button>
            <Button variant="primary" className="min-h-[44px] font-semibold" onClick={() => void runConfirmedSuspend()}>
              Suspender
            </Button>
          </>
        }
      >
        {suspendTarget ? (
          <p className="text-sm leading-relaxed text-content-secondary">
            Tem certeza de que deseja suspender{" "}
            <strong className="text-content">{suspendTarget.nome}</strong>? O acesso ao painel será bloqueado até
            reativar a conta.
          </p>
        ) : null}
      </Modal>

      <section className={cardClass}>
        <h2 className="text-sm font-semibold text-content">Lista ({count})</h2>
        {list.length === 0 ? (
          <p className="mt-4 text-sm text-content-muted">
            Ainda não há colaboradores. Adicione a hierarquia para usar distribuição para equipa humana nas regras de
            leads.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line/70">
            {list.map((emp) => (
              <li key={emp.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="font-medium text-content">
                    {emp.nome}
                    {emp.accountSuspended ? (
                      <span className={cn("ml-2 text-xs font-semibold", isLight ? "text-rose-600" : "text-rose-300")}> · suspenso</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-content-muted">
                    <span className="font-medium text-content-secondary">{ROLE_LABEL[emp.hierarchyRole]}</span>
                    {" · "}
                    {[emp.email, emp.funcao].filter(Boolean).join(" · ")}
                  </p>
                  <p className="mt-0.5 text-[10px] text-content-faint">
                    {emp.hasInitialPassword ?? Boolean(emp.initialPassword?.trim())
                      ? "Senha inicial definida (não mostrada)"
                      : "Sem senha definida (registo antigo)"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canActorTargetEmployeeForAdminActions(session, list, emp) ? (
                    <button
                      type="button"
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line px-2.5 py-1.5 text-xs font-medium text-content-secondary transition hover:bg-surface-elevated/50"
                      onClick={() => setEditTarget(emp)}
                    >
                      <Pencil className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                      Editar
                    </button>
                  ) : null}
                  {canActorTargetEmployeeForAdminActions(session, list, emp) ? (
                    <button
                      type="button"
                      className="rounded-xl border border-line px-2.5 py-1.5 text-xs font-medium text-content-secondary transition hover:bg-surface-elevated/50"
                      onClick={() => {
                        if (emp.accountSuspended) {
                          void toggleReativar(emp);
                        } else {
                          setSuspendTarget(emp);
                        }
                      }}
                    >
                      {emp.accountSuspended ? "Reativar" : "Suspender"}
                    </button>
                  ) : null}
                  {canActorTargetEmployeeForAdminActions(session, list, emp) ? (
                    <button
                      type="button"
                      className={cn("inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-line text-content-muted transition hover:border-rose-400/50 hover:bg-rose-500/10", isLight ? "hover:text-rose-700" : "hover:text-rose-200")}
                      aria-label={`Apagar ${emp.nome}`}
                      onClick={() => {
                        setDeleteConfirmText("");
                        setDeleteTarget(emp);
                      }}
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteConfirmText("");
        }}
        title="Apagar colaborador"
        footer={
          <>
            <Button
              variant="outline"
              className={cn(
                "min-h-[44px] font-semibold",
                isLight &&
                  "border-line/80 bg-surface-deep text-content hover:border-line",
              )}
              onClick={() => {
                setDeleteTarget(null);
                setDeleteConfirmText("");
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={!confirmDeleteEnabled}
              onClick={runConfirmedDelete}
              className={cn(
                "min-h-[46px] gap-2 rounded-xl px-6 text-[13px] font-semibold tracking-tight",
                "ring-1 ring-inset ring-white/20",
                "hover:brightness-[1.06]",
                "focus-visible:ring-2 focus-visible:ring-rose-500/55 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card",
                isLight
                  ? "disabled:pointer-events-none disabled:!border disabled:!border-slate-200/95 disabled:!bg-slate-100 disabled:!text-slate-500 disabled:!ring-0 disabled:hover:!brightness-100"
                  : "disabled:pointer-events-none disabled:!border disabled:!border-white/[0.12] disabled:!bg-white/[0.07] disabled:!text-content-muted disabled:!ring-0 disabled:hover:!brightness-100",
                "disabled:!opacity-100",
              )}
            >
              <Trash2 className="h-4 w-4 shrink-0 opacity-95" strokeWidth={2} aria-hidden />
              Apagar definitivamente
            </Button>
          </>
        }
      >
        {deleteTarget ? (
          <div className="space-y-4 text-sm text-content-secondary">
            <p>
              Esta ação remove <strong className="text-content">todos os dados deste colaborador</strong> nesta conta
              (e de subordinados em cascata, se aplicável).{" "}
              <strong className="text-content">Os leads no CRM Kanban não são apagados</strong>: ficam guardados com
              responsável <strong className="font-mono text-content">{CRM_LEAD_SEM_OWNER_LABEL}</strong> para o dono da conta
              redistribuir manualmente.
            </p>
            {cascadePreview.length > 1 ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-content">
                <p className={cn("font-semibold", isLight ? "text-amber-950" : "text-amber-100")}>
                  Serão removidos {cascadePreview.length} registos (inclui hierarquia abaixo de {deleteTarget.nome}):
                </p>
                <ul className="mt-2 list-inside list-disc text-content-secondary">
                  {cascadePreview.map((e) => (
                    <li key={e.id}>
                      {e.nome} ({ROLE_LABEL[e.hierarchyRole]})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="text-xs text-content-muted">
              Para confirmar, escreva em maiúsculas:{" "}
              <strong className="font-mono text-content">{TEAM_EMPLOYEE_DELETE_CONFIRM_PHRASE}</strong>
            </p>
            <div>
              <label className="text-xs font-medium text-content-muted" htmlFor="delete-confirm-input">
                Confirmação
              </label>
              <Input
                id="delete-confirm-input"
                className="mt-1 h-11 rounded-xl font-mono text-sm"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={TEAM_EMPLOYEE_DELETE_CONFIRM_PHRASE}
                autoComplete="off"
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
