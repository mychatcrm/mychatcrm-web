import "server-only";

import { generateAIResponse } from "@/lib/ai/gateway";
import { normalizeLandingVersionContent } from "@/lib/landing/blocks";
import { buildLandingTemplateContent, findLandingTemplate } from "@/lib/landing/templates";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { LandingVersionContent } from "@/lib/landing/types";

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Geração da página a partir do que o tenant já configurou no agente.
 *
 * Este é o ponto que nenhuma ferramenta de site consegue copiar: a página não
 * nasce de um briefing em branco, nasce da mesma fonte que o agente usa para
 * atender. Quem clicar no anúncio lê exatamente a promessa que a IA vai
 * cumprir no WhatsApp minutos depois — e isso, hoje, ninguém entrega, porque a
 * página é feita numa ferramenta e o atendimento em outra.
 *
 * Nada aqui é específico de nicho. O contexto vem do tenant; o prompt só sabe
 * pedir estrutura de página de captura.
 */

export type LandingAgentContext = {
  businessName: string;
  proposition: string;
  desiredAction: string;
  city: string | null;
  /** Instruções do agente, recortadas. É a melhor descrição do negócio que existe. */
  agentInstructions: string | null;
};

export async function loadLandingAgentContext(params: {
  tenantId: string;
  agentId?: string | null;
  client?: SupabaseServiceClient;
}): Promise<LandingAgentContext> {
  const sb = params.client ?? createSupabaseServiceClient();
  const fallback: LandingAgentContext = {
    businessName: "",
    proposition: "",
    desiredAction: "falar com a nossa equipa",
    city: null,
    agentInstructions: null,
  };

  const { data: tenantRow } = await sb
    .from("tenants")
    .select("name")
    .eq("id", params.tenantId)
    .maybeSingle();

  const businessName =
    typeof (tenantRow as Record<string, unknown> | null)?.name === "string"
      ? String((tenantRow as Record<string, unknown>).name)
      : "";

  let query = sb
    .from("tenant_agents")
    .select("agent_id, name, instructions, active")
    .eq("tenant_id", params.tenantId)
    .eq("active", true)
    .limit(1);
  if (params.agentId) query = query.eq("agent_id", params.agentId);

  const { data: agentRows } = await query;
  const agent = Array.isArray(agentRows) ? (agentRows[0] as Record<string, unknown> | undefined) : undefined;
  const instructions =
    typeof agent?.instructions === "string" ? agent.instructions.slice(0, 4000) : null;

  return {
    ...fallback,
    businessName,
    agentInstructions: instructions,
  };
}

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["seo", "blocks"],
  properties: {
    seo: {
      type: "object",
      additionalProperties: false,
      required: ["title", "description"],
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
    },
    blocks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["kind"],
        properties: { kind: { type: "string" } },
      },
    },
  },
};

const SYSTEM_PROMPT = [
  "Você escreve páginas de captura de leads para tráfego pago.",
  "Responda SOMENTE com JSON no formato pedido, sem comentários e sem markdown.",
  "",
  "Regras de escrita:",
  "- Português do Brasil, segunda pessoa, frases curtas.",
  "- Nada de promessa que o negócio não possa cumprir, nada de número inventado, nada de depoimento fictício com nome real.",
  "- O título diz o que o negócio faz e para quem, não é slogan vago.",
  "- Cada benefício descreve algo concreto que a pessoa recebe.",
  "- Perguntas frequentes respondem objeção de verdade (preço, prazo, compromisso).",
  "- Não escreva HTML. Só texto puro em cada campo.",
  "",
  "Tipos de bloco válidos: hero, benefits, proof, faq, form, cta, footer.",
  "hero: headline, subheadline, ctaLabel, eyebrow.",
  "benefits: title, items[{title, description}].",
  "proof: title, items[{quote, author}].",
  "faq: title, items[{question, answer}].",
  "form: title, description, submitLabel, successMessage, consentText.",
  "cta: headline, description, ctaLabel.",
  "footer: businessName, legalLine.",
  "",
  "A página TEM de conter exatamente um bloco form.",
  "Só inclua o bloco proof se o contexto trouxer prova real; caso contrário, omita.",
].join("\n");

export type LandingGenerationResult =
  | { ok: true; content: LandingVersionContent; usedAi: true }
  | { ok: false; content: LandingVersionContent; usedAi: false; reason: string };

/**
 * Gera o conteúdo. Nunca falha para o utilizador: sem IA disponível, devolve o
 * modelo preenchido com o contexto do tenant e sinaliza `usedAi: false` — quem
 * chama usa isso para devolver o crédito em vez de cobrar por meio serviço.
 */
export async function generateLandingContent(params: {
  tenantId: string;
  agentId?: string | null;
  templateId: string;
  context: LandingAgentContext;
  /** Instrução extra do cliente ("foco em orçamento rápido"). */
  brief?: string | null;
  variantOf?: LandingVersionContent | null;
}): Promise<LandingGenerationResult> {
  const template = findLandingTemplate(params.templateId);
  const fallbackContent = buildLandingTemplateContent(params.templateId, {
    businessName: params.context.businessName,
    proposition: params.context.proposition,
    desiredAction: params.context.desiredAction,
    city: params.context.city,
  });

  const userParts = [
    `Negócio: ${params.context.businessName || "não informado"}`,
    params.context.city ? `Cidade: ${params.context.city}` : "",
    `Ação desejada na página: ${params.context.desiredAction}`,
    `Modelo escolhido: ${template.name} — ${template.summary}`,
    `Estrutura de blocos esperada, nesta ordem: ${fallbackContent.blocks
      .map((block) => block.kind)
      .join(", ")}`,
    params.brief ? `Pedido do cliente: ${params.brief.slice(0, 500)}` : "",
    params.context.agentInstructions
      ? `Contexto do negócio (instruções do agente de atendimento):\n${params.context.agentInstructions}`
      : "",
    params.variantOf
      ? [
          "Esta é uma VARIANTE para teste A/B da página abaixo.",
          "Mude o ângulo da promessa e a ordem do argumento — não troque só palavras.",
          JSON.stringify({ blocks: params.variantOf.blocks }).slice(0, 4000),
        ].join("\n")
      : "",
  ].filter(Boolean);

  try {
    const result = await generateAIResponse({
      tenantId: params.tenantId,
      agentId: params.agentId?.trim() || "landing-generator",
      feature: "landing_page_generation",
      temperature: params.variantOf ? 0.8 : 0.5,
      messages: [
        { role: "system", content: SYSTEM_PROMPT, retention: "required", source: "technical_rules" },
        { role: "user", content: userParts.join("\n\n"), retention: "required", source: "current_message" },
      ],
      responseFormat: { name: "landing_page", schema: RESPONSE_SCHEMA },
      metadata: { template: template.id, variant: params.variantOf ? "true" : "false" },
    });

    if (!result.ok || !result.text?.trim()) {
      return { ok: false, content: fallbackContent, usedAi: false, reason: "ai_unavailable" };
    }

    const parsed = safeParseJson(result.text);
    if (!parsed) {
      return { ok: false, content: fallbackContent, usedAi: false, reason: "ai_invalid_json" };
    }

    const content = normalizeLandingVersionContent({
      blocks: parsed.blocks,
      seo: parsed.seo,
      theme: fallbackContent.theme,
      formFields: fallbackContent.formFields,
    });

    // Sem hero ou sem formulário não é página de captura — melhor o modelo.
    const hasHero = content.blocks.some((block) => block.kind === "hero");
    const hasForm = content.blocks.some((block) => block.kind === "form");
    if (!hasHero || !hasForm || content.blocks.length < 3) {
      return { ok: false, content: fallbackContent, usedAi: false, reason: "ai_incomplete" };
    }

    return { ok: true, content, usedAi: true };
  } catch (err) {
    console.error("[landing-generate] falhou", err);
    return { ok: false, content: fallbackContent, usedAi: false, reason: "ai_error" };
  }
}

function safeParseJson(text: string): { blocks?: unknown; seo?: unknown } | null {
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
