const checkMeta = {
  checkedOn: "2026-06-19",
  project: "dannydiaz04s-projects/finance-tracker",
  source: "vercel env list production --no-color",
};

const platformVariables = [
  "AUTH_GOOGLE_ID",
  "AUTH_GOOGLE_SECRET",
  "AUTH_SECRET",
  "BIGQUERY_LOCATION",
  "BIGQUERY_PROJECT_ID",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "GOOGLE_CLOUD_CREDENTIALS_BASE64",
  "GOOGLE_CLOUD_PROJECT",
  "NEON_AUTH_BASE_URL",
  "NEON_PROJECT_ID",
  "OPENAI_API_KEY",
  "OPENAI_CATEGORIZATION_MODEL",
  "OPENAI_MODEL",
  "PGDATABASE",
  "PGHOST",
  "PGHOST_UNPOOLED",
  "PGPASSWORD",
  "PGUSER",
  "PLAID_CLIENT_ID",
  "PLAID_ENV",
  "PLAID_REDIRECT_URI",
  "PLAID_SECRET",
  "PLAID_WEBHOOK_URL",
  "POSTGRES_DATABASE",
  "POSTGRES_HOST",
  "POSTGRES_PASSWORD",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NO_SSL",
  "POSTGRES_URL_NON_POOLING",
  "POSTGRES_USER",
  "VITE_NEON_AUTH_URL",
];

const envContract = [
  {
    name: "DATABASE_URL",
    status: "ready",
    launch: true,
    role: "Postgres runtime",
    note: "Required by Auth.js and Drizzle-backed app tables.",
    value: "Encrypted in Vercel production via Neon integration.",
    source: "Already provisioned in the linked Vercel project.",
    command: "",
  },
  {
    name: "AUTH_SECRET",
    status: "missing",
    launch: true,
    role: "Auth.js session secret",
    note: "Required before public sign-in is exposed.",
    value: "Generate a new production-only secret.",
    source: "Run `npx auth secret` or `npm exec auth secret` locally.",
    command: "vercel env add AUTH_SECRET production --sensitive",
  },
  {
    name: "AUTH_GOOGLE_ID",
    status: "missing",
    launch: true,
    role: "Google OAuth client ID",
    note: "Pairs with the production callback URL.",
    value: "OAuth web client ID.",
    source: "Google Cloud Console > APIs & Services > Credentials.",
    command: "vercel env add AUTH_GOOGLE_ID production",
  },
  {
    name: "AUTH_GOOGLE_SECRET",
    status: "missing",
    launch: true,
    role: "Google OAuth client secret",
    note: "Store as a sensitive Vercel env var.",
    value: "OAuth web client secret.",
    source: "Google Cloud Console > APIs & Services > Credentials.",
    command: "vercel env add AUTH_GOOGLE_SECRET production --sensitive",
  },
  {
    name: "BIGQUERY_PROJECT_ID",
    status: "missing",
    launch: true,
    role: "Warehouse project",
    note: "Used by BigQuery dashboard and import queries.",
    value: "Production Google Cloud project ID. Candidate: `finance-tracker-cdx`.",
    source: "Google Cloud project selector.",
    command: "vercel env add BIGQUERY_PROJECT_ID production",
  },
  {
    name: "BIGQUERY_LOCATION",
    status: "missing",
    launch: true,
    role: "BigQuery region",
    note: "Must match the datasets.",
    value: "`US` per `.env.example`, unless the production datasets use another location.",
    source: "BigQuery dataset details.",
    command: "vercel env add BIGQUERY_LOCATION production",
  },
  {
    name: "GOOGLE_CLOUD_PROJECT",
    status: "missing",
    launch: true,
    role: "Google client project",
    note: "Used by Google Cloud client libraries.",
    value: "Usually the same value as `BIGQUERY_PROJECT_ID`.",
    source: "Google Cloud project selector.",
    command: "vercel env add GOOGLE_CLOUD_PROJECT production",
  },
  {
    name: "GOOGLE_CLOUD_CREDENTIALS_BASE64",
    status: "missing",
    launch: true,
    role: "Google service account",
    note: "JSON alternatives are supported, but base64 is preferred for Vercel.",
    value: "Base64-encoded service-account JSON.",
    source: "Google Cloud IAM > Service Accounts > Keys.",
    command: "vercel env add GOOGLE_CLOUD_CREDENTIALS_BASE64 production --sensitive",
  },
  {
    name: "PLAID_CLIENT_ID",
    status: "missing",
    launch: true,
    role: "Plaid production client",
    note: "Use production credentials only after Plaid approval.",
    value: "Plaid production client ID.",
    source: "Plaid Dashboard > API Keys.",
    command: "vercel env add PLAID_CLIENT_ID production --sensitive",
  },
  {
    name: "PLAID_SECRET",
    status: "missing",
    launch: true,
    role: "Plaid production secret",
    note: "Sandbox secret should not be promoted.",
    value: "Plaid production secret.",
    source: "Plaid Dashboard > API Keys.",
    command: "vercel env add PLAID_SECRET production --sensitive",
  },
  {
    name: "PLAID_ENV",
    status: "missing",
    launch: true,
    role: "Plaid environment",
    note: "Controls Plaid API target.",
    value: "`production`.",
    source: "Literal value after production access is approved.",
    command: "vercel env add PLAID_ENV production",
  },
  {
    name: "PLAID_WEBHOOK_URL",
    status: "missing",
    launch: true,
    role: "Plaid webhook endpoint",
    note: "Depends on the final Vercel production domain.",
    value: "`https://<production-domain>/api/plaid/webhook`.",
    source: "Use the production deployment URL or custom domain.",
    command: "vercel env add PLAID_WEBHOOK_URL production",
  },
  {
    name: "PLAID_REDIRECT_URI",
    status: "missing",
    launch: true,
    role: "Plaid OAuth redirect",
    note: "Must be registered in Plaid and match the app route.",
    value: "`https://<production-domain>/connections`.",
    source: "Use the production deployment URL or custom domain.",
    command: "vercel env add PLAID_REDIRECT_URI production",
  },
  {
    name: "WAREHOUSE_LANDING_BUCKET",
    status: "missing",
    launch: true,
    role: "GCS landing bucket",
    note: "`WAREHOUSE_LANDING_URI` can be used as an alternate.",
    value: "Bucket name. Candidate: `finance-tracker-cdx-etl-landing`.",
    source: "Google Cloud Storage bucket created for ETL landing files.",
    command: "vercel env add WAREHOUSE_LANDING_BUCKET production",
  },
  {
    name: "OPENAI_API_KEY",
    status: "optional",
    launch: false,
    role: "Assistant and AI enrichment",
    note: "Optional for basic dashboard, required for model-backed features.",
    value: "Production OpenAI API key.",
    source: "OpenAI Platform project API keys.",
    command: "vercel env add OPENAI_API_KEY production --sensitive",
  },
  {
    name: "OPENAI_MODEL",
    status: "optional",
    launch: false,
    role: "Assistant model",
    note: "Only needed when OpenAI-backed assistant is enabled.",
    value: "`gpt-5.2` per `.env.example`, unless we choose another model.",
    source: "App configuration decision.",
    command: "vercel env add OPENAI_MODEL production",
  },
  {
    name: "OPENAI_CATEGORIZATION_MODEL",
    status: "optional",
    launch: false,
    role: "AI categorization model",
    note: "Only needed when AI enrichment is enabled.",
    value: "`gpt-5.2` per `.env.example`, unless we choose another model.",
    source: "App configuration decision.",
    command: "vercel env add OPENAI_CATEGORIZATION_MODEL production",
  },
];

const readyVariables = new Set(platformVariables);

for (const item of envContract) {
  if (!readyVariables.has(item.name)) continue;

  item.status = "ready";
  item.value = item.name === "DATABASE_URL"
    ? "Encrypted in Vercel production via Neon integration."
    : "Encrypted in Vercel production.";
  item.source = "Confirmed by the current Vercel production env list.";
  item.command = "";
}

const state = {
  filter: "all",
  query: "",
};

const tableBody = document.querySelector("#env-table-body");
const searchInput = document.querySelector("#search-input");
const segmentButtons = document.querySelectorAll(".segment");

function statusLabel(status) {
  if (status === "ready") return "Ready";
  if (status === "optional") return "Optional";
  return "Missing";
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function copyIconButton(command, label = "Copy") {
  if (!command) return "<span class=\"cell-note\">No action needed now.</span>";
  const escaped = escapeHTML(command);
  return `
    <button class="copy-button" type="button" data-copy="${escaped}">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M8 8h10v12H8z"></path>
        <path d="M6 16H4V4h12v2"></path>
      </svg>
      <span data-copy-label>${escapeHTML(label)}</span>
    </button>
  `;
}

function matchesFilter(item) {
  const query = state.query.trim().toLowerCase();
  const inFilter = state.filter === "all" || item.status === state.filter;
  const inSearch =
    !query ||
    [item.name, item.role, item.note, item.value, item.source]
      .join(" ")
      .toLowerCase()
      .includes(query);

  return inFilter && inSearch;
}

function renderSummary() {
  const launchVars = envContract.filter((item) => item.launch);
  const readyLaunch = launchVars.filter((item) => item.status === "ready").length;
  const missingLaunch = launchVars.length - readyLaunch;
  const progress = Math.round((readyLaunch / launchVars.length) * 100);

  document.querySelector("#checked-on").textContent = `Checked ${checkMeta.checkedOn}`;
  document.querySelector("#project-name").textContent = checkMeta.project;
  document.querySelector("#check-source").textContent = checkMeta.source;
  document.querySelector("#launch-ratio").textContent = `${readyLaunch}/${launchVars.length}`;
  document.querySelector("#launch-progress").style.width = `${progress}%`;
  document.querySelector("#launch-note").textContent =
    missingLaunch === 0
      ? "All launch variables are present in production."
      : `${missingLaunch} launch variable${missingLaunch === 1 ? "" : "s"} still missing from production.`;
  document.querySelector("#ready-count").textContent = platformVariables.length;
  document.querySelector("#missing-count").textContent = missingLaunch;
  document.querySelector("#platform-count").textContent =
    `${platformVariables.length} vars`;
}

function renderEnvRows() {
  const rows = envContract.filter(matchesFilter);

  if (!rows.length) {
    tableBody.innerHTML = `<tr><td colspan="6" class="empty-row">No variables match the current filter.</td></tr>`;
    return;
  }

  tableBody.innerHTML = rows
    .map(
      (item) => `
        <tr>
          <td><span class="var-name">${escapeHTML(item.name)}</span></td>
          <td><span class="status-pill status-${item.status}">${statusLabel(item.status)}</span></td>
          <td>
            <span class="role-label">${escapeHTML(item.role)}</span>
            <span class="role-note">${escapeHTML(item.note)}</span>
          </td>
          <td>${escapeHTML(item.value)}</td>
          <td>${escapeHTML(item.source)}</td>
          <td>${copyIconButton(item.command)}</td>
        </tr>
      `
    )
    .join("");
}

function renderPlatformVars() {
  document.querySelector("#platform-list").innerHTML = platformVariables
    .map((name) => `<span class="compact-token">${escapeHTML(name)}</span>`)
    .join("");
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = text;
  fallback.setAttribute("readonly", "");
  fallback.style.position = "fixed";
  fallback.style.left = "-9999px";
  document.body.appendChild(fallback);
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
}

function bindEvents() {
  searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderEnvRows();
  });

  segmentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      segmentButtons.forEach((segment) => segment.classList.remove("is-active"));
      button.classList.add("is-active");
      state.filter = button.dataset.filter;
      renderEnvRows();
    });
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;

    const originalText = button.textContent.trim();
    await copyText(button.dataset.copy);
    const label = button.querySelector("[data-copy-label]");
    label.textContent = "Copied";
    window.setTimeout(() => {
      label.textContent = originalText;
    }, 1200);
  });

  document.querySelector("#copy-verify").addEventListener("click", async () => {
    const command = document.querySelector(".command-block code").textContent;
    await copyText(command);
    const button = document.querySelector("#copy-verify");
    const label = button.querySelector("[data-copy-label]");
    label.textContent = "Copied";
    window.setTimeout(() => {
      label.textContent = "Copy check";
    }, 1200);
  });
}

renderSummary();
renderEnvRows();
renderPlatformVars();
bindEvents();
