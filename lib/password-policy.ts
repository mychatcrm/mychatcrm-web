/**
 * Password policy — single source of truth for both server validation and
 * client-side UI feedback. Import on the server (API routes) and on the
 * client (React components) without additional dependencies.
 */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordStrength = "empty" | "weak" | "fair" | "strong";

export interface PasswordValidationResult {
  valid: boolean;
  /** Human-readable reason, only set when valid === false. */
  reason?: string;
  strength: PasswordStrength;
}

/**
 * Validates a password against the product policy.
 * Server-authoritative: the API always calls this; the UI mirrors it.
 */
export function validatePassword(password: string): PasswordValidationResult {
  const pwd = password ?? "";

  if (pwd.length === 0) {
    return { valid: false, reason: "A palavra-passe é obrigatória.", strength: "empty" };
  }

  if (pwd.length < PASSWORD_MIN_LENGTH) {
    return {
      valid: false,
      reason: `A palavra-passe deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
      strength: "weak",
    };
  }

  const strength = scorePassword(pwd);
  return { valid: true, strength };
}

/** Rough strength heuristic — no strict enforcement beyond minimum length. */
function scorePassword(pwd: string): PasswordStrength {
  let score = 0;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;

  if (score >= 3) return "strong";
  if (score >= 1) return "fair";
  return "weak";
}

/** Colour class for the strength indicator (Tailwind-compatible). */
export const STRENGTH_COLOR: Record<PasswordStrength, string> = {
  empty: "text-content-muted",
  weak: "text-red-600",
  fair: "text-amber-500",
  strong: "text-green-600",
};

/** Human-readable label for the strength indicator. */
export const STRENGTH_LABEL: Record<PasswordStrength, string> = {
  empty: "",
  weak: "Fraca",
  fair: "Razoável",
  strong: "Forte",
};
