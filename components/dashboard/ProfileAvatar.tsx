"use client";

import { useCallback, useLayoutEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { Bird, Bot, Cat, Flame, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const PROFILE_AVATAR_STORAGE_KEY = "mychatcrm.dashboard.profile-avatar";
const PROFILE_AVATAR_EVENT = "mychatcrm:dashboard-profile-avatar-updated";

type AvatarMode = "initials" | "preset" | "upload";

export interface ProfileAvatarPreset {
  id: string;
  label: string;
  Icon: LucideIcon;
  className: string;
}

interface StoredProfileAvatar {
  mode: AvatarMode;
  presetId?: string;
  imageDataUrl?: string;
}

type ResolvedAvatar =
  | { kind: "initials"; initials: string }
  | { kind: "preset"; preset: ProfileAvatarPreset }
  | { kind: "upload"; src: string; alt: string };

export const profileAvatarPresets: ProfileAvatarPreset[] = [
  { id: "sun", label: "Sol", Icon: Sun, className: "bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500" },
  { id: "fox", label: "Raposa", Icon: Flame, className: "bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-400" },
  { id: "cat", label: "Gato", Icon: Cat, className: "bg-gradient-to-br from-fuchsia-500 via-pink-500 to-rose-500" },
  { id: "owl", label: "Coruja", Icon: Bird, className: "bg-gradient-to-br from-[#1a3552] via-[#2c4a6e] to-[#0e1d2f]" },
  { id: "robot", label: "Robô", Icon: Bot, className: "bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600" },
  { id: "ninja", label: "Ninja", Icon: Moon, className: "bg-gradient-to-br from-slate-600 via-zinc-700 to-neutral-900" },
];

function readStoredAvatar(): StoredProfileAvatar | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(PROFILE_AVATAR_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredProfileAvatar;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.mode === "upload" && typeof parsed.imageDataUrl === "string") return parsed;
    if (parsed.mode === "preset" && typeof parsed.presetId === "string") return parsed;
    if (parsed.mode === "initials") return parsed;
    return null;
  } catch {
    return null;
  }
}

function resolveAvatar(avatar: StoredProfileAvatar | null, initials: string, displayName: string): ResolvedAvatar {
  if (!avatar) return { kind: "initials", initials };
  if (avatar.mode === "upload" && avatar.imageDataUrl) {
    return { kind: "upload", src: avatar.imageDataUrl, alt: `Foto de ${displayName}` };
  }
  if (avatar.mode === "preset" && avatar.presetId) {
    const preset = profileAvatarPresets.find((item) => item.id === avatar.presetId);
    if (preset) return { kind: "preset", preset };
  }
  return { kind: "initials", initials };
}

export function useDashboardProfileAvatar(initials: string, displayName: string) {
  const [storedAvatar, setStoredAvatar] = useState<StoredProfileAvatar | null>(null);

  /** useLayoutEffect: lê localStorage antes do 1.º paint (evita flash iniciais → preset/foto). */
  useLayoutEffect(() => {
    const sync = () => setStoredAvatar(readStoredAvatar());
    sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === PROFILE_AVATAR_STORAGE_KEY) sync();
    };
    const onAvatarUpdate = () => sync();
    window.addEventListener("storage", onStorage);
    window.addEventListener(PROFILE_AVATAR_EVENT, onAvatarUpdate);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PROFILE_AVATAR_EVENT, onAvatarUpdate);
    };
  }, []);

  const save = useCallback((next: StoredProfileAvatar) => {
    setStoredAvatar(next);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PROFILE_AVATAR_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(PROFILE_AVATAR_EVENT));
  }, []);

  const clear = useCallback(() => {
    setStoredAvatar({ mode: "initials" });
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(PROFILE_AVATAR_STORAGE_KEY);
    window.dispatchEvent(new Event(PROFILE_AVATAR_EVENT));
  }, []);

  const avatar = useMemo(
    () => resolveAvatar(storedAvatar, initials, displayName),
    [storedAvatar, initials, displayName],
  );

  return {
    avatar,
    storedAvatar,
    setInitialsAvatar: clear,
    setPresetAvatar: (presetId: string) => save({ mode: "preset", presetId }),
    setUploadedAvatar: (imageDataUrl: string) => save({ mode: "upload", imageDataUrl }),
  };
}

export function ProfileAvatar({
  avatar,
  size = 40,
  className,
  textClassName,
}: {
  avatar: ResolvedAvatar;
  size?: number;
  className?: string;
  textClassName?: string;
}) {
  const dimensionStyle = { width: size, height: size };
  const sharedClassName = cn("flex shrink-0 items-center justify-center rounded-full", className);

  if (avatar.kind === "upload") {
    return (
      <div style={dimensionStyle} className={cn(sharedClassName, "relative overflow-hidden border border-line")}>
        <Image src={avatar.src} alt={avatar.alt} fill sizes={`${size}px`} unoptimized className="object-cover" />
      </div>
    );
  }

  if (avatar.kind === "preset") {
    return (
      <div
        style={dimensionStyle}
        className={cn(sharedClassName, avatar.preset.className)}
        role="img"
        aria-label={`Avatar ${avatar.preset.label}`}
      >
        <avatar.preset.Icon className={cn("h-5 w-5 text-white/95", textClassName)} strokeWidth={1.85} aria-hidden />
      </div>
    );
  }

  return (
    <div style={dimensionStyle} className={cn(sharedClassName, "bg-gradient-primary text-white")} aria-hidden>
      <span className={cn("text-xs font-bold", textClassName)}>{avatar.initials}</span>
    </div>
  );
}
