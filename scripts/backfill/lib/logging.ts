import type { SafeLogger } from "./types.ts";

const SECRET_PATTERNS = [
  /BACKFILL_[A-Z0-9_]*PASS(?:WORD)?=[^\s&]*/gi,
  /password[=:]\S+/gi,
  /token[=:]\S+/gi,
  /otp[=:]\S+/gi,
  /[?&]code=[^&\s]+/gi,
];

function redact(message: string): string {
  let sanitized = message;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

export function createSafeLogger(scope: string): SafeLogger {
  const prefix = `[backfill:${scope}]`;

  return {
    info(message: string) {
      console.log(`${prefix} ${redact(message)}`);
    },
    warn(message: string) {
      console.warn(`${prefix} ${redact(message)}`);
    },
    error(message: string) {
      console.error(`${prefix} ${redact(message)}`);
    },
  };
}
