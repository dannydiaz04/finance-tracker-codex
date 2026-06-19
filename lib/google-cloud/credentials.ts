type GoogleCloudCredentials = {
  client_email: string;
  private_key: string;
};

function readEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

function parseCredentialsJson(rawValue: string, source: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(
      `${source} must contain valid Google service account JSON: ${
        error instanceof Error ? error.message : "invalid JSON"
      }`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Partial<GoogleCloudCredentials>).client_email !== "string" ||
    typeof (parsed as Partial<GoogleCloudCredentials>).private_key !== "string"
  ) {
    throw new Error(
      `${source} must include client_email and private_key fields.`,
    );
  }

  return parsed as GoogleCloudCredentials;
}

function parseBase64Credentials(rawValue: string, source: string) {
  let decoded: string;

  try {
    decoded = Buffer.from(rawValue, "base64").toString("utf8");
  } catch (error) {
    throw new Error(
      `${source} must be base64-encoded Google service account JSON: ${
        error instanceof Error ? error.message : "invalid base64"
      }`,
    );
  }

  return parseCredentialsJson(decoded, source);
}

export function getGoogleCloudCredentials() {
  const jsonValue = readEnvValue(
    "GOOGLE_CLOUD_CREDENTIALS_JSON",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
  );

  if (jsonValue) {
    return parseCredentialsJson(jsonValue, "GOOGLE_CLOUD_CREDENTIALS_JSON");
  }

  const base64Value = readEnvValue(
    "GOOGLE_CLOUD_CREDENTIALS_BASE64",
    "GOOGLE_APPLICATION_CREDENTIALS_BASE64",
  );

  if (base64Value) {
    return parseBase64Credentials(
      base64Value,
      "GOOGLE_CLOUD_CREDENTIALS_BASE64",
    );
  }

  return null;
}

export function getGoogleCloudClientOptions(projectId: string | null) {
  const credentials = getGoogleCloudCredentials();

  return {
    ...(projectId ? { projectId } : {}),
    ...(credentials ? { credentials } : {}),
  };
}
