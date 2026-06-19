# Production Runtime

## Runtime Decision

The first production target is Vercel running the standard Next.js server
deployment.

Rationale:

- The app is a Next.js App Router application with Route Handlers, Auth.js,
  `proxy.ts`, Postgres, BigQuery, Plaid, and OpenAI integration points.
- It cannot be deployed as a static export because core behavior depends on
  server runtime features.
- Vercel auto-detects Next.js and maps server-rendered routes and API routes to
  its Node.js runtime without a custom server.

## Node.js Version

Production Node.js is pinned to `24.x`.

Repo markers:

- `package.json` has `engines.node = "24.x"`.
- `.nvmrc` is set to `24`.

Vercel supports overriding the project Node major through
`package.json#engines.node`, and Next.js 16 requires Node.js `20.9` or newer.

## Vercel Configuration

`vercel.json` makes the deployment target explicit:

- Framework preset: `nextjs`
- Install command: `npm ci`
- Build command: `npm run build`

No custom output directory or start command is configured. Vercel owns the
production server runtime for deployed Next.js apps.

## Local Production Check

Use this before creating or promoting a deployment:

```bash
npm ci
npm run build
npm run start
```

Then open:

```text
http://localhost:3000
```

## Deployment Commands

After the Vercel project is linked and production environment variables are set:

```bash
npx vercel deploy --prod
```

Preview deployments should be created before production promotion:

```bash
npx vercel deploy
```

Milestone 7 will add CI/CD gates before deploys. Until then, run the milestone
checks manually before production deploys:

```bash
npm run lint
npm run typecheck
npm run test:imports
npm run build
npm run dataform:compile
npm audit --omit=dev
```

## Rollback

Primary rollback path:

1. Use Vercel Instant Rollback from the dashboard to point production domains
   back to a previous production deployment.
2. Verify auth, dashboard load, Plaid webhook receipt, and warehouse-backed
   reads after rollback.

CLI rollback path:

```bash
npx vercel rollback
```

Rollback does not roll back external systems such as Postgres, BigQuery,
Dataform outputs, Plaid state, or OpenAI-side behavior. Schema and warehouse
changes need their own rollback or forward-fix plan.

## Open Runtime Decisions

- Choose production function region after Postgres and BigQuery access paths are
  finalized.
- Decide whether ETL jobs run on Vercel Cron, Cloud Run/Cloud Scheduler, or a
  separate worker host. This belongs to Milestone 6.
- Decide whether production deploys should use Vercel Git integration, CLI
  deployment, or CI-triggered deployments. This belongs to Milestone 7.

## References

- Next.js deployment options:
  https://nextjs.org/docs/app/getting-started/deploying
- Vercel supported Node.js versions:
  https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- Vercel project configuration:
  https://vercel.com/docs/project-configuration
- Vercel rollback:
  https://vercel.com/docs/instant-rollback
