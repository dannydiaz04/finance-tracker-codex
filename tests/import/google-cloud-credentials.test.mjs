import assert from "node:assert/strict";
import test from "node:test";

import {
  getGoogleCloudClientOptions,
  getGoogleCloudCredentials,
} from "../../lib/google-cloud/credentials.ts";

function withEnv(overrides, callback) {
  const keys = [
    "GOOGLE_CLOUD_CREDENTIALS_JSON",
    "GOOGLE_APPLICATION_CREDENTIALS_JSON",
    "GOOGLE_CLOUD_CREDENTIALS_BASE64",
    "GOOGLE_APPLICATION_CREDENTIALS_BASE64",
  ];
  const previousValues = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    delete process.env[key];
  }

  Object.assign(process.env, overrides);

  try {
    return callback();
  } finally {
    for (const key of keys) {
      const previousValue = previousValues.get(key);

      if (typeof previousValue === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

const credentials = {
  client_email: "finance-tracker@example.iam.gserviceaccount.com",
  private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
};

test("Google Cloud credentials can be read from JSON env", () => {
  withEnv({ GOOGLE_CLOUD_CREDENTIALS_JSON: JSON.stringify(credentials) }, () => {
    assert.deepEqual(getGoogleCloudCredentials(), credentials);
    assert.deepEqual(getGoogleCloudClientOptions("finance-prod"), {
      projectId: "finance-prod",
      credentials,
    });
  });
});

test("Google Cloud credentials can be read from base64 env", () => {
  const encoded = Buffer.from(JSON.stringify(credentials), "utf8").toString(
    "base64",
  );

  withEnv({ GOOGLE_CLOUD_CREDENTIALS_BASE64: encoded }, () => {
    assert.deepEqual(getGoogleCloudCredentials(), credentials);
  });
});

test("Google Cloud credentials reject incomplete JSON", () => {
  withEnv({ GOOGLE_CLOUD_CREDENTIALS_JSON: "{}" }, () => {
    assert.throws(
      () => getGoogleCloudCredentials(),
      /client_email and private_key/,
    );
  });
});
