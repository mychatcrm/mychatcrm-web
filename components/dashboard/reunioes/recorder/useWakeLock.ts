"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Mantém a tela acesa durante a gravação.
 *
 * No iPhone, apagar a tela interrompe a captura — não existe API web de
 * gravação em segundo plano. O wake lock não resolve o bloqueio manual nem a
 * troca de app, mas evita o caso mais comum: a tela apagando sozinha no meio da
 * reunião.
 *
 * O sistema solta o bloqueio quando a aba perde visibilidade, então ele é
 * repedido no `visibilitychange`.
 */
export function useWakeLock(active: boolean): { supported: boolean; held: boolean } {
  const [held, setHeld] = useState(false);
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;

  const request = useCallback(async () => {
    if (!supported || sentinelRef.current) return;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      sentinelRef.current = sentinel;
      setHeld(true);
      sentinel.addEventListener("release", () => {
        sentinelRef.current = null;
        setHeld(false);
      });
    } catch {
      // Bateria fraca ou política do sistema. A gravação segue; só a tela pode
      // apagar — e o aviso permanente na interface já cobre isso.
      setHeld(false);
    }
  }, [supported]);

  useEffect(() => {
    if (!active) {
      void sentinelRef.current?.release().catch(() => undefined);
      sentinelRef.current = null;
      setHeld(false);
      return;
    }

    void request();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void request();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinelRef.current?.release().catch(() => undefined);
      sentinelRef.current = null;
    };
  }, [active, request]);

  return { supported, held };
}
