import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), false);

const requiredKeys = [
  "DATABASE_URL",
  "AUTH_SECRET",
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

function hasValue(key) {
  return Boolean(process.env[key]?.trim());
}

function validateGoogleCredentials() {
  const json =
    process.env.GOOGLE_CLOUD_CREDENTIALS_JSON?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  const base64 =
    process.env.GOOGLE_CLOUD_CREDENTIALS_BASE64?.trim() ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64?.trim();

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
const validationErrors = validateGoogleCredentials();

if (missingKeys.length === 0 && missingGroups.length === 0 && validationErrors.length === 0) {
  console.log("Production environment contract: OK");
  console.log(`Required keys present: ${requiredKeys.length}`);
  console.log(`Required groups present: ${requiredGroups.length}`);
  console.log(
    `Optional keys present: ${optionalKeys.filter((key) => hasValue(key)).length}/${optionalKeys.length}`,
  );
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
