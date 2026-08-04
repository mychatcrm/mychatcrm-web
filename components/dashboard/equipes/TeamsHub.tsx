"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { PanelButton as Button } from "@/components/panel/ui/PanelButton";
import { PanelInput as Input } from "@/components/panel/ui/PanelInput";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { usePanelAppearance } from "@/components/panel/PanelAppearance";
import { FunnelAccessPanel } from "./FunnelAccessPanel";
import type { ClientSession } from "@/lib/client-auth";
import { resolveOrganizationRole } from "@/lib/organization-role";
import { refreshTeamEmployeesFromApi } from "@/lib/team-employees-client-cache";
import type { TeamEmployee, TeamHierarchyRole } from "@/lib/team-employees-types";
import {
  planSupportsTeams,
  roleAllowsMultipleTeams,
  TEAM_DELETE_CONFIRM_PHRASE,
  validateTeamInput,
  type Team,
} from "@/lib/teams-types";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<TeamHierarchyRole, string> = {
  director: "Diretor",
  manager: "Gerente",
  seller: "Vendedor",
};

const ROLE_ORDER: TeamHierarchyRole[] = ["director", "manager", "seller"];

type DraftState = { id: string | null; name: string; memberIds: string[] };

const EMPTY_DRAFT: DraftState = { id: null, name: "", memberIds: [] };

export function TeamsHub({ session }: { session: ClientSession }) {
  const { isLight } = usePanelAppearance();
  const isOwner = resolveOrganizationRole(session) === "owner";
  const planAllowsTeams = planSupportsTeams(session.plan);

  const [teams, setTeams] = useState<Team[]>([]);
  const [employees, setEmployees] = useState<TeamEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [teamsRes, employeeList] = await Promise.all([
        fetch("/api/teams", { credentials: "same-origin", cache: "no-store" }),
        refreshTeamEmployeesFromApi(session.tenantId),
      ]);
      const json = (await teamsRes.json()) as { teams?: Team[]; error?: string };
      if (!teamsRes.ok) throw new Error(json.error ?? "Falha ao carregar equipes");
      setTeams(json.teams ?? []);
      setEmployees(employeeList.filter((e) => e.ativo && !e.accountSuspended));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar equipes");
    } finally {
      setLoading(false);
    }
  }, [session.tenantId]);

  useEffect(() => {
    if (planAllowsTeams) void refresh();
    else setLoading(false);
  }, [planAllowsTeams, refresh]);

  const employeeById = useMemo(
    () => new Map(employees.map((e) => [e.id, e] as const)),
    [employees],
  );

  /** Gerente/vendedor já vinculado a outra equipe não pode ser escolhido de novo. */
  const lockedEmployeeIds = useMemo(() => {
    const locked = new Map<string, string>();
    for (const team of teams) {
      if (draft?.id && team.id === draft.id) continue;
      for (const member of team.members) {
        const employee = employeeById.get(member.employeeId);
        if (!employee || roleAllowsMultipleTeams(employee.hierarchyRole)) continue;
        locked.set(member.employeeId, team.name);
      }
    }
    return locked;
  }, [teams, draft?.id, employeeById]);

  const openCreate = useCallback(() => {
    setDraft({ ...EMPTY_DRAFT });
    setFormError(null);
  }, []);

  const openEdit = useCallback((team: Team) => {
    setDraft({ id: team.id, name: team.name, memberIds: team.members.map((m) => m.employeeId) });
    setFormError(null);
  }, []);

  const submitDraft = useCallback(async () => {
    if (!draft) return;
    const invalid = validateTeamInput(
      { name: draft.name, memberIds: draft.memberIds },
      { employees, teams, teamId: draft.id ?? undefined },
    );
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/teams", {
        method: draft.id ? "PATCH" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(draft.id ? { id: draft.id } : {}),
          name: draft.name.trim(),
          memberIds: draft.memberIds,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Falha ao gravar equipe");
      setDraft(null);
      await refresh();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Erro ao gravar equipe");
    } finally {
      setSaving(false);
    }
  }, [draft, employees, teams, refresh]);

  const submitDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/teams", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id, confirm: deleteConfirm.trim() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Falha ao apagar equipe");
      setDeleteTarget(null);
      setDeleteConfirm("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao apagar equipe");
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleteConfirm, refresh]);

  if (!planAllowsTeams) {
    return (
      <section className="rounded-xl border border-line/80 bg-surface-card/80 p-6">
        <h2 className="font-display text-lg font-bold text-content">Equipes</h2>
        <p className="mt-2 text-sm text-content-secondary">
          O plano Solo é individual e não usa equipes. Para separar leads, conversas e agenda entre
          times, faça upgrade para Equipa ou Escala.
        </p>
        <Link
          href="/dashboard/configuracoes"
          className="mt-4 inline-flex text-sm font-semibold text-primary underline-offset-2 hover:underline"
        >
          Ver planos
        </Link>
      </section>
    );
  }

  if (!isOwner) {
    return (
      <section className="rounded-xl border border-line/80 bg-surface-card/80 p-6">
        <h2 className="font-display text-lg font-bold text-content">Equipes</h2>
        <p className="mt-2 text-sm text-content-secondary">
          Somente o titular da conta pode criar e editar equipes.
        </p>
      </section>
    );
  }

  return (
    <section
      className={cn(
        "min-w-0 rounded-xl border p-5 sm:p-6",
        isLight ? "border-slate-200/80 bg-surface-deep" : "border-line/80 bg-surface-card/80",
      )}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-bold tracking-tight text-content sm:text-lg">
            Equipes
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-content-muted">
            Cada equipe enxerga apenas os próprios leads, conversas e agendamentos. Um diretor pode
            estar em várias equipes; gerente e vendedor, em apenas uma.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" aria-hidden />
          Nova equipe
        </Button>
      </div>

      {error ? (
        <p className="mb-4 flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-content-muted">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Carregando…
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line/70 py-12 text-center">
          <Users className="mx-auto h-8 w-8 text-content-faint" aria-hidden />
          <p className="mt-3 text-sm text-content-secondary">Nenhuma equipe criada ainda.</p>
          <p className="mt-1 text-xs text-content-muted">
            Leads sem equipe ficam visíveis apenas para você.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {teams.map((team) => {
            const byRole = ROLE_ORDER.map((role) => ({
              role,
              members: team.members
                .filter((m) => m.roleInTeam === role)
                .map((m) => employeeById.get(m.employeeId))
                .filter((e): e is TeamEmployee => Boolean(e)),
            })).filter((group) => group.members.length > 0);

            return (
              <li
                key={team.id}
                className={cn(
                  "rounded-xl border p-4",
                  isLight ? "border-slate-200/70 bg-white/60" : "border-line/70 bg-surface-deep/40",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-bold text-content">{team.name}</p>
                    <p className="mt-0.5 text-xs text-content-muted">
                      {team.members.length === 0
                        ? "Sem colaboradores"
                        : `${team.members.length} colaborador${team.members.length > 1 ? "es" : ""}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 px-2 text-[11px]"
                      onClick={() => openEdit(team)}
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                      Editar
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-8 px-2 text-[11px]"
                      onClick={() => {
                        setDeleteTarget(team);
                        setDeleteConfirm("");
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Apagar
                    </Button>
                  </div>
                </div>

                {byRole.length > 0 ? (
                  <dl className="mt-3 grid gap-2 border-t border-line/40 pt-3 text-xs sm:grid-cols-3">
                    {byRole.map((group) => (
                      <div key={group.role}>
                        <dt className="text-content-muted">{ROLE_LABEL[group.role]}</dt>
                        <dd className="mt-0.5 space-y-0.5 font-medium text-content">
                          {group.members.map((employee) => (
                            <p key={employee.id} className="truncate">
                              {employee.nome}
                            </p>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <FunnelAccessPanel employees={employees} />

      {draft ? (
        <Modal
          open
          onClose={() => setDraft(null)}
          title={draft.id ? "Editar equipe" : "Nova equipe"}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="button" variant="outline" onClick={() => void submitDraft()} isLoading={saving}>
                {draft.id ? "Guardar" : "Criar equipe"}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-content-muted">
                Nome da equipe
              </label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                placeholder="Ex.: Comercial Centro"
                autoFocus
              />
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Colaboradores da equipe
              </p>
              {employees.length === 0 ? (
                <p className="text-xs text-content-muted">
                  Nenhum colaborador ativo. Cadastre em{" "}
                  <Link href="/dashboard/colaboradores" className="text-primary hover:underline">
                    Colaboradores
                  </Link>
                  .
                </p>
              ) : (
                <div className="space-y-1">
                  {ROLE_ORDER.flatMap((role) =>
                    employees
                      .filter((e) => e.hierarchyRole === role)
                      .map((employee) => {
                        const checked = draft.memberIds.includes(employee.id);
                        const lockedIn = lockedEmployeeIds.get(employee.id);
                        const disabled = Boolean(lockedIn) && !checked;
                        return (
                          <label
                            key={employee.id}
                            className={cn(
                              "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                              disabled
                                ? "cursor-not-allowed border-line/40 opacity-60"
                                : "cursor-pointer border-line/60 hover:border-line",
                              checked && !disabled ? "border-primary bg-primary/5" : "",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              disabled={disabled}
                              onChange={() =>
                                setDraft((d) =>
                                  d
                                    ? {
                                        ...d,
                                        memberIds: checked
                                          ? d.memberIds.filter((id) => id !== employee.id)
                                          : [...d.memberIds, employee.id],
                                      }
                                    : d,
                                )
                              }
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-content">{employee.nome}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <Badge className="border-line/60 bg-surface-elevated/60 text-[10px] text-content-muted">
                                  {ROLE_LABEL[employee.hierarchyRole]}
                                </Badge>
                                {lockedIn ? (
                                  <span className="text-[10px] text-content-muted">
                                    já está em &quot;{lockedIn}&quot;
                                  </span>
                                ) : null}
                              </span>
                            </span>
                          </label>
                        );
                      }),
                  )}
                </div>
              )}
            </div>

            {formError ? (
              <p className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {formError}
              </p>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          open
          onClose={() => setDeleteTarget(null)}
          title={`Apagar "${deleteTarget.name}"`}
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => void submitDelete()}
                isLoading={deleting}
                disabled={deleteConfirm.trim() !== TEAM_DELETE_CONFIRM_PHRASE}
              >
                Apagar equipe
              </Button>
            </div>
          }
        >
          <p className="text-sm text-content-secondary">
            Os leads, conversas e agendamentos desta equipe <strong className="text-content">não são
            apagados</strong> — voltam para &quot;sem equipe&quot; e ficam visíveis apenas para você,
            até serem atribuídos a outra equipe.
          </p>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-content-muted">
            Escreva {TEAM_DELETE_CONFIRM_PHRASE} para confirmar
          </label>
          <Input
            className="mt-1.5"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={TEAM_DELETE_CONFIRM_PHRASE}
          />
        </Modal>
      ) : null}
    </section>
  );
}
