import type { RefObject } from "react";

export type ComposeFocusReason =
  | "after_send"
  | "after_error"
  | "conversation_switch"
  | "attachment_closed"
  | "emoji_inserted";

export function focusComposeTextarea(
  ref: RefObject<HTMLTextAreaElement | null>,
  reason: ComposeFocusReason,
): void {
  if (typeof window === "undefined") return;
  if (reason === "after_send" || reason === "after_error" || reason === "conversation_switch") {
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.disabled) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  }
}

export function shouldSendOnEnter(event: {
  key: string;
  shiftKey: boolean;
}): boolean {
  return event.key === "Enter" && !event.shiftKey;
}
