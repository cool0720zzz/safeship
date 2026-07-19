# Deploy Pre-Flight Cockpit — Platform Knowledge Base (2026)

A machine-checkable rules reference for detecting a repo's target deploy platform and running an environment-specific pre-deploy checklist. Limits verified July 2026; treat all free-tier numbers as volatile and re-verify against the cited primary docs.

## 0. Detection precedence (how the scanner should decide)

Scan in this order; first strong signal wins, but collect all so the tool can flag conflicts (e.g. both `vercel.json` and `netlify.toml` present = ambiguous, ask user).

| Priority | Signal type | Examples |
|---|---|---|
| 1 (strongest) | Platform config file at repo root | `vercel.json`, `netlify.toml`, `render.yaml`, `fly.toml`, `firebase.json`, `wrangler.toml`/`wrangler.jsonc`, `amplify.yml`, `.github/workflows/*pages*` |
| 2 | Platform lockfile/dir | `.vercel/`, `.netlify/`, `.firebase/`, `.wrangler/`, `.amplify/` |
| 3 | Framework fingerprint (package.json deps + config) | `next` → `next.config.*`; `astro`; `vite`; `@sveltekit`; `nuxt`; `remix`; `gatsby` |
| 4 | package.json `scripts` (build/start) + engines | `build`, `start`, `engines.node` |
| 5 | Git remote / CI hints | `git remote -v`, existing `.github/workflows` deploy steps |

---

## 1. Vercel

**Commonly hosts:** Next.js (first-class), plus Vite/React/Vue SPAs, Astro, SvelteKit, Nuxt, Remix, Gatsby, and pure static. Serverless + Edge Functions.

### Detection signals
| Signal | Meaning |
|---|---|
| `vercel.json` at root | Explicit Vercel target (may set `buildCommand`, `outputDirectory`, `functions`, `rewrites`, `regions`) |
| `.vercel/` dir (esp. `.vercel/project.json`) | Linked project — should be gitignored |
| `next.config.js/ts/mjs` + `next` in deps | Next.js → Vercel default preset |
| `@vercel/*` packages, `vercel dev` in scripts | Vercel CLI usage |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| Framework preset matches (Next.js autodetected; SPAs need output dir set) | Blank page / 404 |
| **Output directory correct** (Vite→`dist`, CRA→`build`, Astro→`dist`, Next→managed) | Deploy serves wrong/empty dir |
| Node version pinned (`engines.node` in package.json or Project Settings; Vercel defaults to a current LTS and drops old majors) | Build breaks when Vercel bumps default Node |
| **Env vars set in Vercel dashboard**, not just local `.env` | Runtime crashes; `.env` is not deployed |
| **No secret leaked via `NEXT_PUBLIC_` prefix** — any `NEXT_PUBLIC_*` var is bundled into client JS | Server secret (API keys, DB URLs) shipped to browser |
| Env var scoped to correct environment (Production/Preview/Development) | Preview creds hit prod DB or vice versa |
| Production branch mapping correct (default `main`) | Wrong branch auto-promoted to prod |
| `.vercel/` gitignored | Leaks project/org IDs |
| SPA rewrite/`cleanUrls`/catch-all present for client routing | Deep links 404 |
| `next/image` domains / `remotePatterns` configured | Broken external images or optimization errors |
| Cron/ISR `revalidate` sane | Runaway function invocations |

### Free tier (Hobby) & cost traps
- **100 GB bandwidth/mo** (edge+origin, image optimization counts against it); **1,000 source images/mo** for Image Optimization (then billed); function max duration **10s** on Hobby. Hobby is **non-commercial only**. ([Hobby docs](https://vercel.com/docs/plans/hobby), [Limits](https://vercel.com/docs/limits))
- **Cost balloons:** Image Optimization overages, high function GB-hours (fat serverless functions / frequent ISR revalidation), bandwidth spikes from a viral post, and accidentally putting a commercial project on Hobby (ToS forces Pro at $20/seat).

---

## 2. Netlify

**Commonly hosts:** Static + Jamstack — Vite/React, Astro, Hugo/Eleventy, Gatsby, Next.js (via adapter), SvelteKit. Netlify Functions (AWS Lambda) + Edge Functions (Deno).

### Detection signals
| Signal | Meaning |
|---|---|
| `netlify.toml` at root | Explicit target — `[build]` `command`/`publish`, `[functions]`, `[[redirects]]`, `[context.*]` |
| `netlify/functions/` or `functions/` dir | Serverless functions |
| `_redirects` / `_headers` files | Netlify redirect/header syntax |
| `@netlify/*` deps, `netlify dev` in scripts | CLI usage |
| `.netlify/` dir | Linked state (gitignore) |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| **`publish` dir matches framework output** (Vite→`dist`, CRA→`build`, Astro→`dist`, Hugo→`public`) | Empty deploy |
| Build command correct in `netlify.toml` (overrides UI) | Wrong artifact deployed |
| SPA fallback redirect present: `/* /index.html 200` | Client-route deep links 404 |
| Node version pinned (`NODE_VERSION` env, `.nvmrc`, or `netlify.toml`) | Build drift |
| **Env vars in Netlify UI/`[build.environment]`**, not just `.env` | Missing-at-runtime crashes |
| No secret exposed via client build (Vite `VITE_*` / build-time inlining) | Secret in bundle |
| Netlify **Secrets Scanning** won't fail build (it scans build output for leaked env values) | Build fails if a secret value appears in output |
| Correct branch → production; branch/deploy previews configured | Wrong prod publish |
| Functions bundler (esbuild) + `included_files` for assets | Function 500s on missing files |
| Framework adapter installed for Next/SvelteKit (`@netlify/plugin-nextjs`) | SSR routes break |

### Free tier & cost traps (credit model as of 2026)
- New accounts use a **credit-based Free plan (~300 credits/mo)**: production deploys ~15 credits, compute 10 credits/GB-hr, bandwidth 20 credits/GB. **Hitting the cap pauses ALL projects on the account until next cycle.** Legacy pre-Sept-2025 accounts still have the old 100 GB bandwidth / 300 build-min split. ([Pricing](https://www.netlify.com/pricing/), [credit-based plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/))
- **Cost balloons:** bandwidth from large media, frequent full rebuilds burning build credits, background/scheduled functions compute, one busy project pausing everything.

---

## 3. Cloudflare Pages / Workers

**Commonly hosts:** Static sites, Vite/React SPAs, Astro, Next.js/SvelteKit/Remix via adapters (`@cloudflare/next-on-pages` or OpenNext), Hono/Workers APIs. Cloudflare is consolidating Pages into **Workers (Static Assets)**.

### Detection signals
| Signal | Meaning |
|---|---|
| `wrangler.toml` / `wrangler.jsonc` | Workers/Pages config — `main`, `compatibility_date`, `[[kv_namespaces]]`, `[[d1_databases]]`, `[assets]` |
| `functions/` dir (Pages Functions) | File-based Workers routing |
| `_routes.json`, `_redirects`, `_headers` | Pages config files |
| `@cloudflare/*`, `wrangler` in devDeps; `wrangler deploy`/`pages deploy` scripts | CLI usage |
| `.dev.vars` file | Local Workers secrets (gitignore!) |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| **`compatibility_date` set and recent** in wrangler config | Runtime behaves differently than expected |
| `nodejs_compat` flag if using Node APIs | `Cannot find module`/runtime error |
| Build output dir matches (`dist`, `.svelte-kit/cloudflare`, `.vercel/output/static` for next-on-pages) | Blank deploy |
| **Secrets via `wrangler secret put` / dashboard**, NOT `[vars]` in committed config | Secrets committed to git in `wrangler.toml` |
| `.dev.vars` gitignored | Local secret leak |
| Bindings (KV, D1, R2, Durable Objects) declared and created in the account | Runtime binding-undefined error |
| **File count under 20,000** (Free Pages limit) | Deploy rejected |
| Individual asset ≤ 25 MB | Upload rejected |
| Client router SPA fallback / `_routes.json` excludes correct paths | 404s or functions invoked on static assets |
| Next.js on Edge runtime (`export const runtime = 'edge'`) where required by adapter | Build/runtime failure |

### Free tier & cost traps
- **Workers Free: 100,000 requests/day** (resets midnight UTC; Pages Functions requests count toward this), **10 ms CPU/request**, ≤50 subrequests. **Pages Free: 20,000 files/site**, unlimited static requests/bandwidth, **500 builds/month**. Paid Workers starts $5/mo (no daily cap, up to 5 min CPU). ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/))
- **Cost balloons:** exceeding 100k Worker requests/day (dynamic apps), KV/D1/R2 read-write and storage overages, Durable Objects duration. Static hosting itself is famously cheap/free (unmetered bandwidth).

---

## 4. Render

**Commonly hosts:** Node/Express/Fastify, Python/Django/FastAPI, Go, Ruby, Docker containers; static sites; managed Postgres/Redis. Long-running servers (not just serverless).

### Detection signals
| Signal | Meaning |
|---|---|
| `render.yaml` (Blueprint) at root | Explicit — `services:` with `type`, `env`, `buildCommand`, `startCommand`, `healthCheckPath` |
| `Dockerfile` + no other platform config | Likely Render/Railway/Fly container target |
| `Procfile` | Process definition (Render/Heroku-style) |
| package.json `start` script binding to `process.env.PORT` | Server app |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| **App binds to `0.0.0.0` and `process.env.PORT`** | Health check fails → deploy marked unhealthy |
| `buildCommand` and `startCommand` correct (`npm ci && npm run build` / `npm start`) | Build/boot failure |
| `healthCheckPath` returns 200 | Zero-downtime deploy hangs/rolls back |
| Node/runtime version pinned (`engines.node`, `.nvmrc`, or `runtime`) | Version drift |
| **Env vars + secret files set in Render dashboard/`envVars`** | Runtime crash |
| DB connection uses Render **internal** URL + SSL where required | Connection refused / slow egress |
| Free web service **spin-down** acknowledged (sleeps after 15 min idle, ~1 min cold start) | "Slow first load" surprise; not for prod |
| Migrations run in build or predeploy, not on every boot | DB race / repeated migrations |
| Persistent disk declared if app writes files | Data lost on redeploy (ephemeral FS) |

### Free tier & cost traps
- **750 free instance-hours/workspace/month**, **100 GB bandwidth/mo**; free web services **spin down after 15 min idle**, ~1 min cold start; exhausting hours suspends free services until next month; bandwidth overage **$30/100 GB**. One 24/7 app ≈ 720 hrs (fits); two can't both run 24/7. Free Postgres expires after a set period. ([Render free docs](https://render.com/docs/free))
- **Cost balloons:** upgrading a spinning service to always-on ($7+/mo/service), paid Postgres after free DB expiry, bandwidth overage, multiple services each metered.

---

## 5. Railway

**Commonly hosts:** Node, Python, Go, Ruby, Docker, Postgres/Redis/Mongo — full-stack apps and databases. Nixpacks auto-build.

### Detection signals
| Signal | Meaning |
|---|---|
| `railway.json` / `railway.toml` | Explicit config (build/deploy/`healthcheckPath`/`restartPolicy`) |
| `nixpacks.toml` | Nixpacks build customization (Railway default builder) |
| `Procfile` + no Heroku signals | Possible Railway |
| `.railway/` refs / `railway up` in docs | CLI usage |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| App binds `0.0.0.0:$PORT` (Railway injects `PORT`) | 502 / no healthy target |
| Start command detected or set (`railway.json` `deploy.startCommand`) | Wrong process starts |
| **Env/service variables set in Railway**, use reference vars (`${{Postgres.DATABASE_URL}}`) | DB URL missing at runtime |
| `healthcheckPath` set for zero-downtime | Deploy flaps |
| Build works under Nixpacks or provide Dockerfile | Build detection failure |
| Volume attached if persistent storage needed | Data loss on redeploy |
| No secret in committed config | Leak |

### Free tier & cost traps
- **No perpetual free hosting.** One-time **$5 trial credit (30-day expiry)**; then services pause. **Hobby $5/mo includes $5 usage credit** (you always pay the $5 base; overage billed by CPU/RAM/egress). Free plan post-trial gives ~$1 credit/mo (no rollover). ([Railway pricing](https://railway.com/pricing), [plans docs](https://docs.railway.com/pricing/plans))
- **Cost balloons:** usage is metered by resource-second — idle-but-running services, memory-hungry apps, egress, and databases quietly consume credit; no hard cap means real overage charges past $5.

---

## 6. Fly.io

**Commonly hosts:** Dockerized apps (any language), Node, Elixir/Phoenix, Go, Rust, Postgres; global multi-region VMs ("Machines").

### Detection signals
| Signal | Meaning |
|---|---|
| `fly.toml` at root | Explicit — `app`, `[build]`, `[http_service]` `internal_port`, `[[vm]]`, `[env]`, `[mounts]` |
| `Dockerfile` alongside `fly.toml` | Fly build |
| `.fly/` refs, `flyctl`/`fly deploy` | CLI usage |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| **`internal_port` in `[http_service]` matches app listen port**, bind `0.0.0.0` | No response / health fail |
| `[http_service]` health checks defined | Bad deploy stays live |
| **Secrets via `fly secrets set`**, not `[env]` in committed `fly.toml` | Secret committed |
| `auto_stop_machines` / `min_machines_running` configured intentionally | Either always-on cost or cold starts |
| Volume `[mounts]` declared for stateful data; region pinned | Data loss / cross-region latency |
| Correct primary region + DB colocation | Slow queries, egress |
| Memory sized (OOM kills small default VMs) | Machine crashes/restarts |

### Free tier & cost traps
- **No free tier in 2026** (removed for new users in 2024). New users get a trial capped at **~2 VM-hours or 7 days**; then a card is required. Pay-as-you-go: a minimal `shared-cpu-1x`/256 MB ≈ **$1.94/mo always-on**; **egress metered** ($0.02/GB NA-EU, up to $0.12/GB Africa/India). Machines **bill by the second even if you forget to stop them**. ([Fly pricing](https://fly.io/pricing/), [free trial](https://fly.io/docs/about/free-trial/))
- **Cost balloons:** forgotten running Machines, over-provisioned RAM/CPU, multi-region replicas each billed, egress on media-heavy apps, Postgres Machines.

---

## 7. Heroku

**Commonly hosts:** Node/Express, Python/Django, Ruby/Rails, Go, Java; buildpack or container. Classic PaaS.

### Detection signals
| Signal | Meaning |
|---|---|
| `Procfile` at root (`web: ...`) | Canonical Heroku signal |
| `app.json` | Heroku app manifest / Review Apps |
| `.buildpacks` / `heroku/` buildpack refs, `heroku.yml` (container) | Heroku build |
| `engines` in package.json + Procfile | Node on Heroku |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| `Procfile` `web:` binds `$PORT` | R10 boot timeout / crash |
| Runtime version pinned (`engines.node`, `.python-version`/`runtime.txt`) | Build uses unexpected version |
| **Config Vars set in dashboard/`heroku config`**, not `.env` | Missing env crash |
| Build/`heroku-postbuild` produces assets; `NODE_ENV=production` | Missing build step |
| DB via `DATABASE_URL` add-on with SSL | Connection failure |
| Release-phase migrations (`release:` in Procfile) | Schema drift |
| Eco dyno **sleep after 30 min idle** acknowledged | Cold start; not for always-on |
| Worker/web split correct | Background jobs don't run |

### Free tier & cost traps
- **No free tier** (removed Nov 28, 2022). **Eco: $5/mo for 1,000 dyno-hours shared** across Eco dynos (sleep after 30 min idle). **Basic: $7/mo/dyno always-on.** Postgres/Redis add-ons cost extra; realistic hobby app w/ DB ≈ **$10–12/mo**. Two Eco apps 24/7 exceed the 1,000-hr pool. ([Heroku pricing](https://www.heroku.com/pricing/), [dyno tiers](https://devcenter.heroku.com/articles/dyno-tiers))
- **Cost balloons:** always-on dynos, paid add-ons (Postgres, Redis, logging), multiple dynos, overrunning the Eco hour pool.

---

## 8. GitHub Pages

**Commonly hosts:** Static only — plain HTML/CSS/JS, Jekyll (native), and any SSG whose output is committed or built via Actions (Astro, Vite, Hugo, Eleventy, Docusaurus). **No server/SSR, no serverless.**

### Detection signals
| Signal | Meaning |
|---|---|
| `.github/workflows/*.yml` using `actions/deploy-pages` / `upload-pages-artifact` | Actions-based Pages deploy |
| `CNAME` file at root/publish dir | Custom domain for Pages |
| `_config.yml` (Jekyll) | Native Jekyll build |
| `.nojekyll` file | Bypasses Jekyll (needed for Vite/`_`-prefixed dirs) |
| `gh-pages` branch or `docs/` publish dir | Classic Pages source |
| `homepage`/`base` path config in package.json/vite.config | SPA base-path for project pages |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| **Base path set** for project sites (`/repo-name/`) — Vite `base`, Next `basePath`, CRA `homepage` | All assets 404 (broken CSS/JS) |
| `.nojekyll` present when output has `_`-prefixed folders (Vite `_assets`) | Assets stripped by Jekyll → blank page |
| Pages source (branch/Actions) matches where output lands | Nothing published |
| SPA 404 fallback (`404.html` copy of `index.html`) for client routing | Deep-link 404 |
| **No secrets** — everything is public; no server env | Any embedded key is exposed |
| Custom domain: `CNAME` + DNS + "Enforce HTTPS" | Cert/redirect errors |
| Repo public (or Pages allowed for private on paid plan) | Publish blocked |

### Free tier & cost traps
- **Free.** Soft limits: **repo/site ≤ 1 GB**, **soft bandwidth 100 GB/mo**, **soft 10 builds/hr** (Actions workflow builds bypass the 10/hr limit). Exceeding soft limits can trigger throttling or a Support email. ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits))
- **Cost balloons:** essentially none (no metered billing); heavy Actions builds can consume the account's free Actions minutes on private repos.

---

## 9. Firebase Hosting

**Commonly hosts:** Static + SPAs (React/Vue/Angular), SSR frameworks via Cloud Functions/Cloud Run integration (Next.js/Angular web frameworks support), Flutter web. Pairs with Firestore/Auth/Cloud Functions.

### Detection signals
| Signal | Meaning |
|---|---|
| `firebase.json` at root | Explicit — `hosting.public`, `rewrites`, `redirects`, `headers` |
| `.firebaserc` | Project alias mapping |
| `firebase-tools` devDep, `firebase deploy` scripts | CLI |
| `functions/` dir with `firebase-functions` | Cloud Functions |
| `.firebase/` cache dir | Gitignore |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| **`hosting.public` points at build output** (`dist`/`build`) not project root | Deploys source, not built app |
| SPA rewrite `"**" → "/index.html"` | Client routes 404 |
| SSR rewrite to function/Cloud Run configured for Next/Angular | SSR pages fail |
| Correct project selected (`.firebaserc` alias / `firebase use`) | **Deploy to wrong Firebase project** |
| **Client Firebase config is public by design**, but Admin SDK service-account keys must NOT be committed | Full DB compromise if service key leaks |
| Security Rules (Firestore/Storage) not left in open `allow read, write: if true` | Data breach / abuse billing |
| Functions region + runtime pinned; env via `functions.config()`/params | Runtime errors |
| **Blaze plan required for outbound network / many features**; billing alerts set | Surprise pay-as-you-go bill |

### Free tier & cost traps
- **Spark (free):** Hosting **10 GB storage**, **360 MB/day transfer**; hitting 10 GB blocks new deploys. Cloud Functions **2M invocations/mo** on Spark but most real use needs **Blaze (pay-as-you-go)**. ([Firebase pricing](https://firebase.google.com/pricing), [Hosting quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing))
- **Cost balloons (Blaze):** Firestore read/write/delete volume (a bad client loop can rack up millions of reads), Cloud Functions invocations + egress, Storage bandwidth, and **no hard spending cap by default** — set a budget alert. Open Security Rules → abuse → runaway bill is the classic disaster.

---

## 10. Supabase (hosting + Edge Functions)

**Commonly hosts:** Backend for vibe-coded apps — Postgres, Auth, Storage, Realtime, and **Edge Functions (Deno)**. Frontend usually deployed elsewhere (Vercel/Netlify) and talks to Supabase.

### Detection signals
| Signal | Meaning |
|---|---|
| `supabase/` dir with `config.toml` | Supabase CLI project |
| `supabase/functions/*/index.ts` | Edge Functions (Deno) |
| `supabase/migrations/*.sql` | DB migrations |
| `@supabase/supabase-js` in deps | Client SDK |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in `.env` | Credentials |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| **`service_role` key never in client/frontend or `NEXT_PUBLIC_`/`VITE_` vars** — it bypasses RLS | Total DB compromise |
| Only `anon` key exposed client-side | Correct pattern |
| **Row Level Security enabled** on all public tables with real policies | Anyone with anon key reads/writes everything |
| Migrations applied to remote (`supabase db push`) before app relies on schema | Missing tables at runtime |
| Edge Function secrets set (`supabase secrets set`), not committed | Leak |
| Edge Function `verify_jwt` setting intentional | Open/locked endpoint |
| Correct project ref linked (`supabase link`) | Deploy to wrong project |
| **Free-project pause awareness**: paused after 7 days no DB activity | App suddenly 500s until unpaused |
| CORS/allowed origins set for functions | Browser calls blocked |

### Free tier & cost traps
- **Free:** 500 MB database, 1 GB storage, **5 GB egress**, 50k MAU, **500k Edge Function invocations/mo**, **max 2 active projects**, and **projects pause after 7 days inactivity** (no backups/SLA). Pro is $25/mo. ([Supabase pricing](https://supabase.com/pricing), [Functions limits](https://supabase.com/docs/guides/functions/limits))
- **Cost balloons:** egress over 5 GB, DB size growth (spilled into paid compute add-ons), storage, extra projects; on Pro, compute add-ons and egress overages.

---

## 11. AWS Amplify Hosting

**Commonly hosts:** SPAs (React/Vue/Angular), static SSGs, and **Next.js/Nuxt SSR** (managed adapter). Often paired with Amplify Gen 2 backend (Cognito, AppSync, Lambda).

### Detection signals
| Signal | Meaning |
|---|---|
| `amplify.yml` at root | Amplify build spec (`frontend.phases`, `artifacts.baseDirectory`) |
| `amplify/` dir (Gen 1) or `amplify/backend.ts` (Gen 2) | Amplify backend project |
| `aws-amplify` / `@aws-amplify/*` deps | Amplify SDK |
| `amplifyconfiguration.json` / `aws-exports.js` | Generated config (Gen 1) |
| `.amplify/` cache | Gitignore |

### Pre-deploy checklist
| Check | Failure mode |
|---|---|
| **`artifacts.baseDirectory` matches output** (`dist`/`build`/`.next`) | Blank deploy |
| Build spec `preBuild` runs `npm ci`; commands correct | Build fails |
| Node/runtime pinned in build image/`amplify.yml` | Version drift |
| **Env vars in Amplify Console**, and note client-inlined vars (`REACT_APP_`/`VITE_`/`NEXT_PUBLIC_`) leak to browser | Secret in bundle |
| SPA rewrite rule (catch-all non-file paths) `→ /index.html (200)` | Deep-link 404 |
| Branch → environment mapping (each branch = environment) correct | Wrong branch to prod |
| **Prefer SSG/ISR over SSR** to avoid per-request compute billing | Unexpected SSR request charges |
| Backend (Gen 2) deployed and outputs wired | Frontend can't reach API |

### Free tier & cost traps
- **Permanent free tier:** **1,000 build minutes/mo**, **15 GB served/mo**, **5 GB stored/mo**; SSR free allowance **500k requests + 100 GB-hr/mo**. Overages: $0.01/build-min, $0.15/GB served, $0.023/GB stored, SSR $0.0000556/request + $0.00000834/GB-second compute. ([Amplify pricing](https://aws.amazon.com/amplify/pricing/))
- **Cost balloons:** SSR request + compute charges (biggest surprise vs. static), bandwidth over 15 GB, large/frequent builds, and separately-billed backend AWS services (AppSync, Lambda, DynamoDB, Cognito MAU).

---

## 12. Static hosts in general

**Applies to:** GitHub Pages, Cloudflare Pages, Netlify (static), Vercel (static), Firebase Hosting, S3+CloudFront, Surge, Render static, GitLab Pages.

### Detection signals
- Build output is a folder of `index.html` + assets; no server `start` script; SSG deps (`astro`, `@11ty/eleventy`, `hugo`, `vite`+SPA, `gatsby`, `docusaurus`).

### Universal static checklist
| Check | Failure mode |
|---|---|
| **Correct publish/output directory** | Empty/404 deploy |
| **Base path / asset prefix** correct for subpath hosting | Broken CSS/JS (assets 404) |
| SPA history-mode fallback (`404.html` or catch-all → `index.html`) | Deep links 404 |
| Relative vs absolute asset paths consistent | Mixed 404s |
| No server-only secret embedded in client bundle | Secret exposed publicly |
| Trailing-slash / clean-URL behavior matches host | Duplicate/404 routes |
| Case-sensitivity of asset paths (Linux hosts) | Works locally (Win/mac), 404 in prod |
| Custom domain DNS + HTTPS enforced | Cert warnings |

---

## 13. Cross-platform "common pre-deploy" checklist

Apply almost everywhere; run these before any platform-specific rules.

| # | Check | Machine-checkable signal | Why it matters |
|---|---|---|---|
| 1 | **Build passes locally** | Run detected `build` script exit 0 | Broken build = failed/rolled-back deploy |
| 2 | **Lockfile committed** and matches manifest | `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`/`bun.lockb` present; `npm ci` succeeds | Non-reproducible builds; CI uses lockfile-strict installs |
| 3 | **`node_modules` gitignored** | `.gitignore` contains `node_modules` | Bloated repo, deploy conflicts |
| 4 | **`.env` / secret files NOT committed** | No `.env`, `.env.local`, `*.pem`, `serviceAccount*.json`, `.dev.vars` tracked in git; present in `.gitignore` | Secret leak |
| 5 | **No hardcoded secrets in source** | Regex scan for API-key/token patterns, `sk-`, AWS keys, private keys in tracked files | Credential exposure |
| 6 | **Env vars documented** | `.env.example` present listing required keys | Deployer forgets to set vars in dashboard |
| 7 | **Required env vars set on platform**, not only locally | Cross-check `.env.example`/`process.env.*` refs vs platform config (where API available) | Runtime crash on missing var |
| 8 | **Client-exposed vars contain no secrets** | Grep `NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*`, `PUBLIC_*`, `NUXT_PUBLIC_*` for secret-looking values | Secret shipped to browser |
| 9 | **Node/runtime version pinned** | `engines.node` / `.nvmrc` / `runtime.txt` / config | Version drift breaks build |
| 10 | **Build output dir gitignored** but produced by build | `dist`/`build`/`.next`/`.svelte-kit` in `.gitignore` | Stale committed artifacts |
| 11 | **Production branch is intended** | Detected default branch vs platform prod branch | Wrong branch auto-deploys |
| 12 | **Framework config matches deploy target** | Presence + consistency of platform config vs framework | Wrong preset → broken deploy |
| 13 | **DB migrations applied / reversible** | Migration dir present; pending migrations flagged | Schema mismatch at runtime |
| 14 | **`.gitignore` covers platform state dirs** | `.vercel`, `.netlify`, `.firebase`, `.amplify`, `.wrangler`, `.fly` | Leaks project IDs |
| 15 | **Dependencies install cleanly / no critical audit** | `npm ci` + optional `npm audit` | Missing dep breaks prod build |
| 16 | **Free-tier / cost sanity** | Match detected platform to its metered dimensions; warn on SSR/image-opt/always-on/egress patterns | Surprise bills (the product's core promise) |

---

## Key takeaways for rule authoring

- **Strongest single detector = the platform config file at repo root.** Everything else is fallback/corroboration.
- **The three highest-value, universal failure classes** the tool should never miss: (1) wrong output/publish directory, (2) env vars set locally but not on the platform, (3) a secret exposed via a client-side `*_PUBLIC_*`/`VITE_`/`REACT_APP_` prefix or a committed `.env`/service-account/`service_role` key.
- **"Costly deploy" hotspots by platform:** Vercel = image optimization + function GB-hrs + Hobby-commercial ToS; Netlify = credit exhaustion pausing all sites; Cloudflare = 100k Worker req/day cap; Render/Railway/Fly/Heroku = always-on compute + egress + DB add-ons (all have effectively **no free always-on** now except Render's 750 spin-down hours); Firebase/Supabase = open security rules → runaway reads/egress with no default spend cap; Amplify = SSR per-request compute vs. free static.
- **Platforms with NO free tier in 2026:** Fly.io, Heroku, Railway (trial only). Flag these loudly for vibe coders expecting "free."

---

## Sources

Vercel: [Hobby docs](https://vercel.com/docs/plans/hobby), [Limits](https://vercel.com/docs/limits) · Netlify: [Pricing](https://www.netlify.com/pricing/), [Credit plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/) · Cloudflare: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Pages limits](https://developers.cloudflare.com/pages/platform/limits/) · Render: [Free docs](https://render.com/docs/free) · Railway: [Pricing](https://railway.com/pricing), [Plans](https://docs.railway.com/pricing/plans) · Fly.io: [Pricing](https://fly.io/pricing/), [Free trial](https://fly.io/docs/about/free-trial/) · Heroku: [Pricing](https://www.heroku.com/pricing/), [Dyno tiers](https://devcenter.heroku.com/articles/dyno-tiers) · GitHub Pages: [Limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits) · Firebase: [Pricing](https://firebase.google.com/pricing), [Hosting quotas](https://firebase.google.com/docs/hosting/usage-quotas-pricing) · Supabase: [Pricing](https://supabase.com/pricing), [Functions limits](https://supabase.com/docs/guides/functions/limits) · Amplify: [Pricing](https://aws.amazon.com/amplify/pricing/)
