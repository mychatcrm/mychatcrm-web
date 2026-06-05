"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Bot, MessageCircle } from "lucide-react";
import { ChatBubble } from "./ChatBubble";
import { ChatHeader } from "./ChatHeader";
import { ChatHandoff } from "./ChatHandoff";
import { ChatInput } from "./ChatInput";
import { ChatSuggestions } from "./ChatSuggestions";
import { ChatTypingIndicator } from "./ChatTypingIndicator";
import { LeadCaptureModal } from "./LeadCaptureModal";
import {
  CHATBOT_CONVERSATIONS_KEY,
  ChatMessage,
  ChatSessionRecord,
  HandoffReason,
  createMessage,
  createSessionId,
  detectFrustration,
  detectHotLead,
  detectHumanRequest,
  getDefaultHandoffMessage,
  hasOpenedChatBefore,
  inferIntent,
  DEFAULT_CHATBOT_SETTINGS,
  loadChatbotSettings,
  markChatAsOpened,
  saveConversationRecord,
  saveLead,
  summarizeConversation,
  type ChatIntent,
  type ChatbotSettings,
} from "@/lib/chatbot";

const SESSION_STORAGE_KEY = "mychatcrm_chatbot_session_id";

function readChatSettingsSafe(): ChatbotSettings {
  try {
    return loadChatbotSettings();
  } catch {
    return DEFAULT_CHATBOT_SETTINGS;
  }
}

function shouldRender(pathname: string | null) {
  return pathname === "/" || pathname === "/planos";
}

export default function ChatWidget() {
  const pathname = usePathname();
  const canRender = shouldRender(pathname);
  const [settings, setSettings] = useState(readChatSettingsSafe);
  const [open, setOpen] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [leadModal, setLeadModal] = useState<"agendamento" | "email" | null>(null);
  const [handoffReason, setHandoffReason] = useState<HandoffReason | null>(null);
  const [startedAt, setStartedAt] = useState(new Date().toISOString());
  const [lastIntent, setLastIntent] = useState<ChatIntent>("duvida");
  const [sessionId, setSessionId] = useState("");
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const persistedRef = useRef(false);

  const welcomeMessage = useMemo(
    () => createMessage("assistant", settings.welcomeMessage),
    [settings.welcomeMessage],
  );

  useEffect(() => {
    const sync = () => {
      try {
        setSettings(loadChatbotSettings());
      } catch {
        /* localStorage indisponível (ITP, modo privado, políticas) */
      }
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    if (!canRender) return;
    try {
      const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY) || createSessionId();
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, existing);
      setSessionId(existing);
    } catch {
      /* sessionStorage pode falhar ou ser bloqueado */
    }
  }, [canRender]);

  useEffect(() => {
    if (!canRender || hasOpenedChatBefore()) return;
    const timer = window.setTimeout(() => setShowBadge(true), 8000);
    return () => window.clearTimeout(timer);
  }, [canRender]);

  useEffect(() => {
    if (!open || messages.length > 0) return;
    setMessages([welcomeMessage]);
  }, [open, messages.length, welcomeMessage]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, typing, handoffReason]);

  useEffect(() => {
    if (!open) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], textarea, input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [open]);

  useEffect(() => {
    const updateViewport = () => {
      setViewportHeight(window.visualViewport?.height || window.innerHeight);
    };
    updateViewport();
    window.visualViewport?.addEventListener("resize", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      window.visualViewport?.removeEventListener("resize", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  const persistConversation = useCallback(
    (reason?: HandoffReason) => {
      if (!sessionId || persistedRef.current) return;
      const record: ChatSessionRecord = {
        sessionId,
        startedAt,
        finishedAt: new Date().toISOString(),
        messageCount: messages.length,
        handoff: !!reason,
        handoffReason: reason,
        lastIntent,
      };
      saveConversationRecord(record);
      persistedRef.current = true;
    },
    [lastIntent, messages.length, sessionId, startedAt],
  );

  useEffect(() => {
    return () => {
      try {
        if (messages.length > 0) persistConversation(handoffReason || undefined);
      } catch {
        /* não propagar falha de storage ao desmontar / trocar rota */
      }
    };
  }, [handoffReason, messages.length, persistConversation]);

  const openChat = () => {
    setOpen(true);
    setShowBadge(false);
    markChatAsOpened();
    persistedRef.current = false;
  };

  const closeChat = () => {
    setOpen(false);
    if (messages.length > 0) persistConversation(handoffReason || undefined);
  };

  const appendAssistantText = (text: string) => {
    const assistantMessage = createMessage("assistant", text);
    setMessages((current) => [...current, assistantMessage]);
    return assistantMessage;
  };

  const finalizeHandoff = (reason: HandoffReason) => {
    setHandoffReason(reason);
    setTyping(false);
  };

  const handleWhatsApp = () => {
    const number = settings.whatsappNumber || "5562999999999";
    const url = `https://wa.me/${number}?text=${encodeURIComponent(getDefaultHandoffMessage())}`;
    finalizeHandoff("humano");
    appendAssistantText(
      "Perfeito! Nossa equipe entrará em contato em breve. Enquanto isso, você pode explorar nossos planos em /planos. Até logo! 👋",
    );
    window.open(url, "_blank", "noopener,noreferrer");
    persistConversation("humano");
  };

  const handleLeadSubmit = (payload: {
    nome: string;
    email: string;
    telefone?: string;
    plano?: string;
    mensagem?: string;
  }) => {
    const reason = leadModal === "agendamento" ? "agendamento" : "email";
    saveLead({
      id: createSessionId(),
      nome: payload.nome,
      email: payload.email,
      telefone: payload.telefone,
      plano: payload.plano,
      timestamp: new Date().toISOString(),
      resumo_conversa: summarizeConversation(messages),
      handoff_motivo: reason,
    });
    setLeadModal(null);
    finalizeHandoff(reason);
    appendAssistantText(
      "Perfeito! Nossa equipe entrará em contato em breve. Enquanto isso, você pode explorar nossos planos em /planos. Até logo! 👋",
    );
    persistConversation(reason);
  };

  const requestAI = async (nextMessages: ChatMessage[]) => {
    setTyping(true);
    setErrorText(null);
    try {
      const tenantId =
        (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CHAT_TENANT_ID?.trim()) || "public";
      const agentId =
        (typeof process !== "undefined" && process.env.NEXT_PUBLIC_CHAT_AGENT_ID?.trim()) ||
        "marketing_site_assistant";

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          tenantId,
          agentId,
          conversationId: sessionId,
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        const fallback =
          data?.error ||
          (typeof navigator !== "undefined" && !navigator.onLine
            ? "Sem conexão. Verifique sua internet."
            : "Serviço indisponível no momento.");
        appendAssistantText(fallback);
        setErrorText(fallback);
        setTyping(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        appendAssistantText("Demorei para responder. Tente novamente.");
        setTyping(false);
        return;
      }

      const assistantMessage = createMessage("assistant", "");
      setMessages((current) => [...current, assistantMessage]);
      const decoder = new TextDecoder();
      let text = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id ? { ...message, content: text } : message,
          ),
        );
      }
    } catch {
      const fallback =
        typeof navigator !== "undefined" && !navigator.onLine
          ? "Sem conexão. Verifique sua internet."
          : "Demorei para responder. Tente novamente.";
      appendAssistantText(fallback);
      setErrorText(fallback);
    } finally {
      setTyping(false);
    }
  };

  const handleSend = async (value?: string) => {
    const content = (value ?? draft).trim();
    if (!content || typing) return;

    if (messages.length >= 40) {
      appendAssistantText(
        "Já conversamos bastante por aqui. Vou conectar você com nossa equipe para continuar com atenção personalizada.",
      );
      finalizeHandoff("humano");
      return;
    }

    const userMessage = createMessage("user", content);
    const nextMessages = [...messages, userMessage].slice(-40);
    setMessages(nextMessages);
    setDraft("");

    const intent = inferIntent(content);
    setLastIntent(intent);

    if (detectFrustration(content) || detectHumanRequest(content)) {
      finalizeHandoff(detectFrustration(content) ? "frustracao" : "humano");
      return;
    }

    if (detectHotLead(content)) {
      setHandoffReason("lead_quente");
    } else {
      setHandoffReason(null);
    }

    await requestAI(nextMessages);
  };

  if (!canRender || !settings.enabled) return null;

  const panelStyle =
    viewportHeight && window.innerWidth < 640
      ? { height: `${viewportHeight}px` }
      : undefined;

  return (
    <>
      <AnimatePresence>
        {!open ? (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: "spring", stiffness: 240, damping: 18 }}
            className="fixed bottom-[max(1rem,env(safe-area-inset-bottom,0px))] right-4 z-50 sm:bottom-5 sm:right-5"
          >
            <div className="group relative">
              {showBadge ? (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="absolute bottom-16 right-0 max-w-[min(18rem,calc(100vw-2.5rem))] rounded-xl border border-primary/20 bg-surface-card px-4 py-2 text-left text-sm text-content"
                  onClick={openChat}
                >
                  <span className="mr-2 inline-flex h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
                  Olá! Posso ajudar? 👋
                </motion.button>
              ) : null}

              <span className="pointer-events-none absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-[calc(100%+12px)] rounded-lg border border-line bg-surface-card px-3 py-2 text-xs text-content-secondary opacity-0 transition group-hover:opacity-100 md:block">
                Falar com assistente MyChatCRM
              </span>

              <button
                type="button"
                className="flex h-[60px] w-[60px] items-center justify-center rounded-xl bg-primary text-white transition-colors hover:bg-primary-hover"
                onClick={openChat}
                aria-label="Abrir assistente MyChatCRM"
              >
                <MessageCircle className="h-6 w-6" aria-hidden />
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-x-0 bottom-0 z-50 pb-safe sm:inset-auto sm:bottom-5 sm:right-5 sm:pb-0"
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-label="Assistente MyChatCRM"
              style={panelStyle}
              className="flex max-h-[min(92dvh,720px)] w-full flex-col overflow-hidden rounded-t-2xl border border-line bg-surface-deep sm:h-[560px] sm:max-h-[560px] sm:w-[380px] sm:rounded-2xl"
            >
              <ChatHeader assistantName={settings.assistantName} onClose={closeChat} />

              <div ref={messagesRef} className="flex-1 space-y-4 overflow-y-auto bg-surface-deep px-4 py-4">
                {messages.map((message, index) => (
                  <ChatBubble key={message.id} message={message} index={index} />
                ))}

                {messages.length <= 1 && !handoffReason ? (
                  <ChatSuggestions
                    suggestions={settings.suggestions}
                    onSelect={(suggestion) => {
                      const cleaned = suggestion.replace(/^[^A-Za-zÀ-ÿ0-9]+/, "").trim();
                      void handleSend(cleaned);
                    }}
                    disabled={typing}
                  />
                ) : null}

                {typing ? <ChatTypingIndicator /> : null}

                {handoffReason ? (
                  <ChatHandoff
                    reason={handoffReason}
                    onWhatsApp={handleWhatsApp}
                    onSchedule={() => setLeadModal("agendamento")}
                    onEmail={() => setLeadModal("email")}
                  />
                ) : null}

                {errorText ? (
                  <div className="rounded-xl border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                    {errorText}
                  </div>
                ) : null}
              </div>

              <ChatInput value={draft} onChange={setDraft} onSend={() => void handleSend()} disabled={typing} />

              <footer className="border-t border-line bg-surface-card px-4 py-2 text-[11px] text-content-faint">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <span className="min-w-0">Powered by MyChatCRM IA</span>
                  <Link href="/privacidade" className="shrink-0 transition hover:text-primary">
                    Política de privacidade
                  </Link>
                </div>
              </footer>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <LeadCaptureModal
        open={leadModal !== null}
        mode={leadModal || "email"}
        onClose={() => setLeadModal(null)}
        onSubmit={handleLeadSubmit}
      />
    </>
  );
}
