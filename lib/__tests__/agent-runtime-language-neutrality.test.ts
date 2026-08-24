import { describe, expect, it } from "vitest";
import { structuredAgendaSuccessText } from "@/lib/server/agent-cta-scheduler";
import { localizedAttachmentIntro } from "@/lib/ai/language-detect";

describe("language-neutral deterministic runtime output", () => {
  it("localizes confirmed agenda facts for a supported BCP-47 language", () => {
    expect(
      structuredAgendaSuccessText(
        "scheduled",
        { type: "schedule", date: "20/09/2026", time: "14:00", location: "Room A" },
        "en-GB",
      ),
    ).toBe("All set, the appointment is confirmed for 20/09/2026 at 14:00, at Room A.");
  });

  it.each(["ja-JP", "ar-EG", "ko-KR"])(
    "uses language-free confirmed facts instead of forcing a language for %s",
    (languageTag) => {
      const text = structuredAgendaSuccessText(
        "rescheduled",
        { type: "schedule", date: "20/09/2026", time: "14:30", location: "A-7" },
        languageTag,
      );
      expect(text).toBe("✅ 🔄 📅 2026-09-20 · 🕒 14:30 · 📍 A-7");
      expect(text).not.toMatch(/pronto|agendado|appointment|confirmed/i);
    },
  );

  it("uses a language-free cancellation fact and attachment marker for unknown languages", () => {
    expect(structuredAgendaSuccessText("cancelled", { type: "cancel", eventId: null }, "hi-IN"))
      .toBe("✅ 🚫 📅");
    expect(localizedAttachmentIntro("zh-Hant")).toBe("📎");
    expect(localizedAttachmentIntro("es-419")).toBe("Aquí está el archivo solicitado.");
  });
});
