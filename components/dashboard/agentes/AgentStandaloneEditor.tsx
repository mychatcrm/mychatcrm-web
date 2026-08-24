"use client";

import { useRouter } from "next/navigation";
import { agentFromWizardDraftUpdate, type AgentWizardDraft } from "@/lib/agents";
import type { Agent } from "@/lib/types";
import { AgentFormCompact } from "./AgentFormCompact";

async function updateAgent(agent: Agent): Promise<void> {
  const response = await fetch(`/api/client/agentes/${encodeURIComponent(agent.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(agent),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as { error?: unknown };
  throw new Error(typeof body.error === "string" ? body.error : "Não foi possível atualizar o agente.");
}

export function AgentStandaloneEditor({ agent }: { agent: Agent }) {
  const router = useRouter();
  return (
    <AgentFormCompact
      mode="edit"
      initialAgent={agent}
      onSubmit={async (draft: AgentWizardDraft) => {
        await updateAgent(agentFromWizardDraftUpdate(agent, draft));
        router.replace("/dashboard/agentes");
        router.refresh();
      }}
    />
  );
}

