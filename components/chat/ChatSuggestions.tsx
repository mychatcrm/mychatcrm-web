"use client";

import { motion } from "framer-motion";

type ChatSuggestionsProps = {
  suggestions: string[];
  onSelect: (value: string) => void;
  disabled?: boolean;
};

export function ChatSuggestions({ suggestions, onSelect, disabled }: ChatSuggestionsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map((suggestion, index) => (
        <motion.button
          key={suggestion}
          type="button"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 * index }}
          className="rounded-full border border-line bg-surface-card px-3 py-2 text-xs text-content-secondary transition hover:border-primary hover:text-content disabled:opacity-50"
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          aria-label={`Sugestão rápida: ${suggestion}`}
        >
          {suggestion}
        </motion.button>
      ))}
    </div>
  );
}
