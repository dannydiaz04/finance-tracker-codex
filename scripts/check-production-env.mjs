import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), false);

const requiredKeys = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "BIGQUERY_PROJECT_ID",
  "BIGQUERY_LOCATION",
  "GOOGLE_CLOUD_PROJECT",
  "PLAID_CLIENT_ID",
  "PLAID_SECRET",
  "PLAID_ENV",
  "PLAID_WEBHOOK_URL",
  "PLAID_REDIRECT_URI",
];

const requiredGroups = [
  {
    name: "Google Cloud credentials",
    keys: [
      "GOOGLE_CLOUD_CREDENTIALS_JSON",
      "GOOGLE_CLOUD_CREDENTIALS_BASE64",
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "GOOGLE_APPLICATION_CREDENTIALS_BASE64",
    ],
  },
  {
    name: "Warehouse landing root",
    keys: [
      "WAREHOUSE_LANDING_BUCKET",
      "WAREHOUSE_LANDING_URI",
      "WAREHOUSE_LANDING_ROOT",
    ],
  },
];

const optionalKeys = [
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_CATEGORIZATION_MODEL",
];

const GOOGLE_OAUTH_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
const GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/callback/google";
const MIN_AUTH_SECRET_LENGTH = 32;
const MIN_GOOGLE_CLIENT_SECRET_LENGTH = 16;

let googleOAuthCallbackUrl = null;

function unwrapEnvValue(value = "") {
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

function getValue(key) {
  return unwrapEnvValue(process.env[key] ?? "");
}

function hasValue(key) {
  return Boolean(getValue(key));
}

function validateAuthValues() {
  const errors = [];
  const authSecret = getValue("AUTH_SECRET");
  const authUrl = getValue("AUTH_URL");
  const googleClientId = getValue("AUTH_GOOGLE_ID");
  const googleClientSecret = getValue("AUTH_GOOGLE_SECRET");

  if (authSecret && authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    errors.push("AUTH_SECRET is too short to be a production session secret.");
  }

  if (authUrl) {
    try {
      const parsedAuthUrl = new URL(authUrl);
      const isLocalhost = parsedAuthUrl.hostname === "localhost";

      if (parsedAuthUrl.protocol !== "https:" && !isLocalhost) {
        errors.push("AUTH_URL must use https outside localhost.");
      }

      if (parsedAuthUrl.pathname !== "/") {
        errors.push("AUTH_URL should be an origin only, without a path.");
      }

      googleOAuthCallbackUrl = new URL(
        GOOGLE_OAUTH_CALLBACK_PATH,
        parsedAuthUrl.origin,
      ).toString();
    } catch {
      errors.push("AUTH_URL must be a valid absolute URL.");
    }
  }

  if (googleClientId) {
    if (/\s/.test(googleClientId)) {
      errors.push("AUTH_GOOGLE_ID must not contain whitespace.");
    }

    if (!googleClientId.endsWith(GOOGLE_OAUTH_CLIENT_ID_SUFFIX)) {
      errors.push(
        `AUTH_GOOGLE_ID must end with ${GOOGLE_OAUTH_CLIENT_ID_SUFFIX}.`,
      );
    }
  }

  if (googleClientSecret) {
    if (/\s/.test(googleClientSecret)) {
      errors.push("AUTH_GOOGLE_SECRET must not contain whitespace.");
    }

    if (googleClientSecret.length < MIN_GOOGLE_CLIENT_SECRET_LENGTH) {
      errors.push("AUTH_GOOGLE_SECRET is too short to be a valid secret.");
    }
  }

  return errors;
}

function validateGoogleCredentials() {
  const json =
    getValue("GOOGLE_CLOUD_CREDENTIALS_JSON") ||
    getValue("GOOGLE_APPLICATION_CREDENTIALS_JSON");
  const base64 =
    getValue("GOOGLE_CLOUD_CREDENTIALS_BASE64") ||
    getValue("GOOGLE_APPLICATION_CREDENTIALS_BASE64");

  if (!json && !base64) {
    return [];
  }

  let raw = json;

  if (!raw && base64) {
    raw = Buffer.from(base64, "base64").toString("utf8");
  }

  try {
    const parsed = JSON.parse(raw);

    if (
      typeof parsed?.client_email !== "string" ||
      typeof parsed?.private_key !== "string"
    ) {
      return [
        "Google Cloud credentials must include client_email and private_key.",
      ];
    }
  } catch (error) {
    return [
      `Google Cloud credentials must be valid service account JSON: ${
        error instanceof Error ? error.message : "invalid JSON"
      }`,
    ];
  }

  return [];
}

const missingKeys = requiredKeys.filter((key) => !hasValue(key));
const missingGroups = requiredGroups.filter(
  (group) => !group.keys.some((key) => hasValue(key)),
);
const validationErrors = [
  ...validateAuthValues(),
  ...validateGoogleCredentials(),
];

if (
  missingKeys.length === 0 &&
  missingGroups.length === 0 &&
  validationErrors.length === 0
) {
  console.log("Production environment contract: OK");
  console.log(`Required keys present: ${requiredKeys.length}`);
  console.log(`Required groups present: ${requiredGroups.length}`);
  console.log(
    `Optional keys present: ${optionalKeys.filter((key) => hasValue(key)).length}/${optionalKeys.length}`,
  );
  if (googleOAuthCallbackUrl) {
    console.log(`Google OAuth callback URI: ${googleOAuthCallbackUrl}`);
  }
  process.exit(0);
}

if (missingKeys.length > 0) {
  console.error("Missing required production env keys:");
  for (const key of missingKeys) {
    console.error(`- ${key}`);
  }
}

if (missingGroups.length > 0) {
  console.error("Missing required production env groups:");
  for (const group of missingGroups) {
    console.error(`- ${group.name}: one of ${group.keys.join(", ")}`);
  }
}

if (validationErrors.length > 0) {
  console.error("Invalid production env values:");
  for (const error of validationErrors) {
    console.error(`- ${error}`);
  }
}

process.exit(1);
