import Google from "next-auth/providers/google";

const GOOGLE_OAUTH_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
const MIN_GOOGLE_CLIENT_SECRET_LENGTH = 16;

function unwrapEnvValue(value: string) {
  let next = value.trim();

  for (let index = 0; index < 2; index += 1) {
    const first = next.at(0);
    const last = next.at(-1);

    if (
      (first === `"` && last === `"`) ||
      (first === `'` && last === `'`)
    ) {
      next = next.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return next;
}

function readRequiredAuthEnv(key: string) {
  const value = unwrapEnvValue(process.env[key] ?? "");

  if (!value) {
    throw new Error(`${key} is required for Google sign-in.`);
  }

  if (/\s/.test(value)) {
    throw new Error(`${key} must not contain whitespace.`);
  }

  return value;
}

export function getGoogleOAuthProvider() {
  const clientId = readRequiredAuthEnv("AUTH_GOOGLE_ID");

  if (!clientId.endsWith(GOOGLE_OAUTH_CLIENT_ID_SUFFIX)) {
    throw new Error(
      `AUTH_GOOGLE_ID must be a Google OAuth Web client ID ending in "${GOOGLE_OAUTH_CLIENT_ID_SUFFIX}".`,
    );
  }

  const clientSecret = readRequiredAuthEnv("AUTH_GOOGLE_SECRET");

  if (clientSecret.length < MIN_GOOGLE_CLIENT_SECRET_LENGTH) {
    throw new Error("AUTH_GOOGLE_SECRET is too short to be a valid secret.");
  }

  return Google({ clientId, clientSecret });
}
