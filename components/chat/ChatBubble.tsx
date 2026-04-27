"use client";

import { motion } from "framer-motion";
import { Bot } from "lucide-react";
import type { ChatMessage } from "@/lib/chatbot";
import { formatChatTime } from "@/lib/chatbot";

type ChatBubbleProps = {
  message: ChatMessage;
  index: number;
};

export function ChatBubble({ message, index }: ChatBubbleProps) {
  const isBot = message.role === "assistant";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.04 }}
      className={`flex gap-2 ${isBot ? "justify-start" : "justify-end"}`}
    >
      {isBot ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Bot className="h-4 w-4" aria-hidden />
        </div>
      ) : null}

      <div className={`max-w-[82%] min-w-0 ${isBot ? "" : "items-end"} flex flex-col`}>
        <div
          className={
            isBot
              ? "rounded-2xl border border-line bg-surface-card px-4 py-3 text-sm text-content-secondary"
              : "rounded-2xl bg-primary px-4 py-3 text-sm text-white"
          }
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <span className="mt-1 px-1 text-[11px] text-content-faint">
          {formatChatTime(message.createdAt)}
        </span>
      </div>
    </motion.div>
  );
}
