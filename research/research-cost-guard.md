# Cost-Guard Knowledge Base: How Vibe-Coded Apps Rack Up Surprise Bills (and How to Prevent Each)

This is a detection-and-prevention ruleset for a tool that scans an AI-built project before deploy and warns non-developers about cost risks. Every section gives: how the bill detonates, real horror patterns, repo-scan detection signals, and the exact steps to cap spend.

---

## 0. The Two Rules Everything Reduces To

1. **"Alert" != "Cap."** Almost every provider's default "budget" is a *notification*, not a hard stop. Billing keeps accruing after the email lands. Only a few services offer a true hard cap (Supabase spend cap, Google Maps QPD quota, OpenAI *per-project* budget, Anthropic tier cap, Gemini project spend cap). Where no native hard cap exists (Firebase, Vercel Pro, AWS), the only real cap is an **automated kill-switch** (budget -> Pub/Sub -> function that disables billing).
2. **A key that reaches the browser or a public repo is a key someone else can spend.** This is the single highest-severity, highest-frequency finding for vibe-coded apps.

---

## 1. General Prevention Playbook (applies to every service)

| Control | What it does | Repo-scan detection signal |
|---|---|---|
| **Hard cap vs soft alert** | Hard cap stops requests; soft alert only emails. Flag any provider where the user has only an alert on a service that *can* runaway. | Provider SDK present + no evidence of quota/cap config |
| **Secret never in client bundle** | Server-side keys must stay server-side. | Env vars prefixed `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`, `PUBLIC_` (SvelteKit), `GATSBY_`, `VUE_APP_` that hold an API key; keys hardcoded in `src/`, `.env` committed (not in `.gitignore`), keys in any file shipped to `/public` or client bundle |
| **Secret never committed** | Public repo = harvested in minutes by bots (EleKtra-Leak scans GitHub in real time). | High-entropy strings / known key prefixes in tracked files: `sk-` (OpenAI), `sk-ant-` (Anthropic), `AIza` (Google), `AKIA` (AWS), `r8_` (Replicate), `SG.` (SendGrid), `AC`+32hex (Twilio SID) |
| **Rate limiting** | Caps requests-per-user so a bug/attack/viral spike can't multiply cost. | No rate-limit middleware (`express-rate-limit`, `@upstash/ratelimit`, Vercel/Cloudflare WAF rules) around any paid API route |
| **Caching** | Serve repeat/identical calls from cache instead of paying per call. | Paid API called inside a request handler with no cache layer (no Redis/Upstash/`unstable_cache`/CDN headers); LLM/image calls with no memoization |
| **Retries with backoff (bounded)** | Prevents a retry storm that multiplies paid calls. | Retry loops with no max attempts / no exponential backoff around paid API calls |
| **Free-tier "surprise upgrade" trap** | Enabling billing (e.g. Firebase Blaze, adding a card to Supabase/Vercel) silently removes the hard ceiling the free tier gave you. | Presence of a paid-plan requirement (Cloud Functions need Blaze; Vercel Pro features) without a corresponding cap configured |

**Rule of thumb the tool should print:** "Set the cap at the provider *first*; treat your own rate-limiting/caching as a second line of defense, not the only one."

Sources: [Vite env exposure](https://vite.dev/guide/env-and-mode), [Next.js env vars](https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables), [Sprocket Security - Vite secret leak -> CI/CD compromise](https://www.sprocketsecurity.com/blog/hunting-secrets-in-javascript-at-scale-how-a-vite-misconfiguration-lead-to-full-ci-cd-compromise), [GitGuardian/EleKtra-Leak - 13M leaked keys](https://instatunnel.my/blog/github-secret-leaks-the-13-million-api-credentials-sitting-in-public-repos).

---

## 2. OpenAI API

**How it detonates:** OpenAI **removed enforcing hard limits at the org level** - the org "monthly budget" is now notification-only; the key keeps working past it. Cost scales per-token, so a runaway loop, a chatbot with no per-user limit, or GPT-4-class model on every request explodes fast. Long context + high `max_tokens` multiplies cost per call.

**Horror patterns:** Leaked `sk-` key harvested from a repo/client bundle and used to run other people's workloads on your bill; a retry loop re-calling completions; unbounded conversation history resent every turn.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| No org spend enforcement | Org budget is soft; spend continues | `openai` in package.json; no per-project budget | Use **per-project budgets** (see steps) |
| Expensive model default | GPT-4/o-series on every call | `gpt-4`, `gpt-4o`, `o1`, `o3` literals in code | Pin a cheaper model; cap `max_tokens` |
| Key in client | Anyone spends your money | `sk-` in client bundle / `NEXT_PUBLIC_OPENAI...` | Move to server route; rotate key |
| No per-user limit | One user/bot drains budget | No rate-limit around the OpenAI route | Add rate limiting + project budget |

**Exact cap steps:** Create a **Project** in the OpenAI dashboard, then set a **per-project budget** (Project -> Limits/Budgets): a project budget *does* pause that project's requests when exceeded, unlike the org-level soft budget. Set a **soft alert** threshold plus additional alerts via "Add Alert." Scope each API key to a single project with restricted model access, and set per-project rate limits under Project -> Rate limits.
Links: [Usage limits](https://platform.openai.com/settings/organization/limits), [Managing projects](https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects), [OpenAI removed hard limits - what to do](https://grafient.ai/blog/openai-removed-hard-budget-limits).

---

## 3. Anthropic (Claude) API

**How it detonates:** Pay-as-you-go per-token. Each usage tier (Start/Build/Scale) has a **monthly spend cap** enforced across the org, but within that cap a leaked `sk-ant-` key or runaway agent loop can burn the whole month's budget. Agentic/Claude-Code-style loops with tool use resend large contexts.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Org tier cap too high | Whole monthly cap can be drained | `@anthropic-ai/sdk` / `anthropic` in deps | Set a **custom org spend limit** below tier cap |
| No workspace isolation | One feature drains everything | Single key for all uses | Create per-**Workspace** spend + rate limits |
| Key exposed | Others spend your budget | `sk-ant-` in tracked/client files | Rotate; move server-side |
| Big context / Opus default | High cost per call | `claude-opus` / large `max_tokens` | Use Haiku/Sonnet where possible; prompt caching |

**Exact cap steps:** Console -> **Billing/Limits** shows your tier's monthly spend cap; set a **custom spend limit** below it. Create **Workspaces** and set per-workspace **spend limits** and **rate limits** (Console -> Workspace settings) so each app/environment is boxed in. Use the Rate Limits API to read current limits programmatically.
Links: [Anthropic rate limits & spend limits](https://docs.anthropic.com/en/api/rate-limits), [Claude quota tiers & spend limits guide](https://www.aifreeapi.com/en/posts/claude-api-quota-tiers-limits).

---

## 4. Google Gemini API / Vertex AI

**How it detonates:** Per-token pay-as-you-go once you leave the free tier. Historically no cap; now Gemini supports **monthly spend caps** at both billing-account-tier and project level. A `AIza...` key exposed client-side is a classic abuse target (documented Gemini key-abuse scanning).

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Paid tier, no project cap | Runaway/leaked key spends freely | `@google/generative-ai`, `google-generativeai`, `@google-cloud/vertexai` in deps | Set **project spend cap** in AI Studio |
| Key exposed (very common) | Gemini keys actively harvested/abused | `AIza...` string in repo / `VITE_`/`NEXT_PUBLIC_` Gemini key | Rotate; restrict key; server-side only |
| Vertex/GCP no budget | Same GCP "alert != cap" trap | Vertex SDK + no GCP budget | Cloud Billing budget + quota limits |

**Exact cap steps (Gemini API):** Google AI Studio -> **Spend** page -> **Monthly spend cap -> Edit spend cap**, set a per-project dollar limit (requires editor/owner/admin). This alerts and ultimately **pauses API traffic** when the budget is reached (note ~10-min latency; not available for invoiced accounts). For **Vertex AI/GCP**, set a Cloud Billing **budget + alert** *and* cap per-service **quotas** (only quotas actually stop calls). Restrict the API key to specific APIs/referrers in the Cloud console.
Links: [More control over Gemini API costs](https://blog.google/innovation-and-ai/technology/developers-tools/more-control-over-gemini-api-costs/), [Gemini API billing](https://ai.google.dev/gemini-api/docs/billing), [Introducing Spend Caps](https://cloud.google.com/blog/topics/cost-management/introducing-spend-caps-ai-cost-visibility-next26).

---

## 5. Image-Generation APIs (DALL-E, Replicate, Stability, Fal)

**How it detonates:** Billed **per image** ($0.003-$0.20/image), so cost scales linearly with volume. A gallery that regenerates on every load, a bug in a loop, or a public "generate" button with no per-user limit multiplies fast. Most of these providers **only email alerts and do not auto-pause** (Fal explicitly does not pause by default).

Reference prices: DALL-E 3 ~$0.04/image (1024x1024 standard), ~$0.08 HD; Fal Flux Dev ~$0.025, Flux Pro ~$0.05; FLUX.1 Schnell ~$0.003; SDXL ~$0.005. Bills scale linearly: 10,000 images at $0.02 = $200; at $0.06 = $600.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Per-image cost, no cap | Volume x price with no ceiling | `replicate`, `@fal-ai/*`, `stability`, DALL-E via `openai` `images.generate` in deps/code | Provider spend limit where available; app-side counter |
| Public generate endpoint | Anyone triggers paid gen | Image route with no auth/rate-limit | Auth + per-user daily cap + rate limit |
| HD/large sizes default | 2-4x price per image | `quality:"hd"`, `1792x1024`, high `num_outputs` | Default to standard/small |
| Key exposed | `r8_...` etc. abused | Replicate `r8_` / provider key client-side | Rotate; server-side proxy |

**Exact cap steps:** DALL-E is billed through OpenAI - use the **OpenAI project budget** (section 2). Replicate/Fal/Stability: set any available **spending limit/hard cap** in the provider billing dashboard (Fal/Modal-style spend caps halt generation; Fal alerts only unless a cap is set), and **always** add an app-side per-user/day image counter plus rate limiting because provider auto-pause is unreliable.
Links: [Image API pricing comparison 2026](https://www.digitalapplied.com/blog/ai-image-generation-api-pricing-comparison-2026), [DALL-E pricing](https://tokenmix.ai/blog/dall-e-api-pricing), [Fal pricing](https://fal.ai/pricing).

---

## 6. Firebase (Firestore, Cloud Functions, Storage)

**How it detonates:** This is the #1 vibe-coder bill trap. Cloud Functions require the **Blaze (pay-as-you-go) plan**, and **Blaze has no spending cap by default and Firebase does not support a hard usage cap.** Budget alerts are *only* emails with up to a **multi-day delay**. Firestore bills **per read/write/delete** - an unbounded `onSnapshot` listener, a query with no limit, a recursive/looping function, or a `while` loop that writes docs can generate millions of ops. A misconfigured function can also self-trigger (write triggers a function that writes again).

**Horror patterns:** "Left a listener open on a large collection," "function triggered itself in a loop," "public Firestore rules let anyone hammer reads," "$1000s overnight from a fan-out write."

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Blaze, no cap | Alerts don't stop spend | `firebase`, `firebase-admin`, `firebase-functions` in deps; `.firebaserc`/`firebase.json` present | **Kill-switch** function (below) |
| Unbounded reads | Query with no `.limit()`, broad `onSnapshot` | Firestore queries without `limit()`; listeners on whole collections | Add `limit()`, pagination, App Check |
| Function self-trigger / fan-out | Recursive writes | `onDocumentWritten`/`onWrite` handlers that write back | Guard against re-trigger; set max instances |
| Open security rules | Anyone reads/writes = anyone spends | `allow read, write: if true;` in `firestore.rules` | Lock rules; enable App Check |
| No function concurrency/instance cap | Traffic spike spawns many instances | Functions without `maxInstances` | Set `maxInstances` / memory limits |

**Exact cap steps (the real cap is a kill-switch):**
1. Google Cloud Console -> **Billing -> Budgets & alerts -> Create budget**, set amount + alert thresholds (50/90/100%).
2. On the budget, **connect a Pub/Sub topic**.
3. Deploy a Cloud Function subscribed to that topic that **calls the Cloud Billing API to detach the billing account** (or disables services) when spend >= budget - or install the **"Auto Stop Services" / Firebase Kill-Switch** extension which does exactly this.
4. Also: enable **App Check**, tighten Firestore/Storage security rules, add `.limit()` to queries, and set `maxInstances` on functions.
Links: [Avoid surprise bills](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills), [Firebase pricing plans (no cap on Blaze)](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans), [Advanced billing alerts + Pub/Sub function](https://firebase.google.com/docs/projects/billing/advanced-billing-alerts-logic), [Auto Stop Services extension](https://extensions.dev/extensions/kurtweston/functions-auto-stop-billing), [Firebase Kill-Switch repo](https://github.com/christiangenco/Firebase-Kill-Switch).

---

## 7. Supabase

**How it detonates:** The Pro plan has a **Spend Cap ON by default** - but scaling requires turning it *off*, and once off there is no ceiling. Biggest overage source is **egress** ($0.09/GB uncached beyond 250GB/mo on Pro, $0.03/GB cached), plus **edge function invocations** ($2/M) and **compute add-ons** (Micro $10 to 2XL $470). Critically, **compute add-ons are billed even with the spend cap ON** (they're "opt-in predictable items"), so a user who upsized their DB instance still pays regardless of the cap.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Spend cap turned off | No ceiling on egress/invocations | `@supabase/supabase-js` in deps; large media served from Supabase Storage | Keep **Spend Cap ON** |
| Egress blowup | Serving big files / no CDN caching | Storage downloads without cache headers; images served raw | Cache/CDN; image transforms; cap file sizes |
| Edge function spam | Public function, no rate limit | `supabase/functions/*` with no auth/limit | Auth + rate limit |
| Compute add-on (cap doesn't cover) | Upsized instance always billed | (billing-side, not repo) - warn in copy | Downsize compute; know cap won't stop it |
| Key exposure | `service_role` key bypasses RLS | `service_role` / `SUPABASE_SERVICE_ROLE_KEY` in client/`NEXT_PUBLIC_` | Never ship service_role to client; RLS on |

**Exact cap steps:** Dashboard -> **Organization -> Billing -> Spend Cap** and keep it **ON** (default). Understand it does **not** cover compute add-ons. Enable **Row Level Security** on every table, keep the `service_role` key server-only, and add caching for storage egress.
Links: [Billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase), [Manage egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [Spend cap for vibe coders](https://codenote.net/en/posts/supabase-spend-cap-no-overage-billing/).

---

## 8. Vercel

**How it detonates:** Usage-based bandwidth, edge/serverless invocations, and **image optimization** (each unique transformed image is billed). **Pro tier has no hard spending cap - only spend *notifications*; true spend management/pause is effectively Enterprise.** Going viral or getting DDoSed bills every byte at standard rates. Overage rates are per-unit (e.g., ~$0.15/GB bandwidth, ~$2 per million Edge Requests). Image Optimization is a notorious silent multiplier.

**Horror patterns:** $1,141 bandwidth bill from a Hacker News front-page spike (50,000 visitors/24h; waived as "one-time courtesy"); **$23,000** bill from a DDoS (every attack byte billed at standard rate); $1,477 invoice, ~$1,267 of it bandwidth overage, on Pro.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Viral/DDoS bandwidth | Every byte billed, Pro can't hard-cap | Deployed on Vercel (`vercel.json`, Next.js); large public assets | Set **Spend Management** pause + WAF/rate limit |
| Image Optimization | Per-transform billing balloons | `next/image` with many remote/unoptimized images | Limit sizes; `unoptimized`/self-host; cache |
| Serverless/edge invocations | Bots/loops multiply invocations | API routes with no rate limit | Vercel Firewall rate rules; caching |
| No cache = repeat compute | Every request recomputes | No `revalidate`/`Cache-Control` on routes | Add ISR/cache headers |

**Exact cap steps:** Dashboard -> **Settings -> Billing -> Spend Management**: set a spend amount and **enable the action to pause the project / notify** when the threshold is hit (Pro's pause is the closest thing to a cap; note it may not stop fast spikes in time). Add **Vercel Firewall / Attack Challenge Mode + rate-limiting rules**, cap Image Optimization usage, and add caching. For guaranteed hard caps, Enterprise is required.
Links: [Vercel 2025 pricing & hidden costs](https://flexprice.io/blog/vercel-pricing-breakdown), [$23,000 DDoS bill analysis](https://usagebox.com/articles/vercel-23000-dollar-bill-usage-based-platform-bill-shock-2026), [Bill-shock stories](https://deploybase.app/blog/vercel-bill-shock-1100-bandwidth-costs-alternatives-2026).

---

## 9. Cloudflare (Workers, R2)

**How it detonates:** Generally the most forgiving (generous free tiers, no bandwidth egress fees on R2). Risk comes from **Workers Paid ($5/mo)** usage-based request/CPU billing and R2 **Class A/B operations** on top of storage. Still **alert-only** - budget alerts email you; they don't stop usage.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Workers request/CPU overage | High-traffic worker billed per request | `wrangler.toml`, `@cloudflare/workers-types` in project | Budget alert; Workers has usage-model limits |
| R2 operations | Many small reads/writes = Class A/B ops | R2 bindings in `wrangler.toml`; per-request R2 calls | Cache; batch; budget alert |

**Exact cap steps:** Dashboard -> **Manage Account -> Billing -> Budget alerts** (Pay-as-you-go accounts only): set a dollar threshold to get email when usage-based spend crosses it. There is no native hard cap - pair with Worker-side rate limiting and caching.
Links: [Cloudflare budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

---

## 10. AWS (the classic "left it running / no alarm")

**How it detonates:** No budget by default. A left-running EC2/RDS/NAT Gateway, or an **exposed `AKIA...` key** -> attackers spin up dozens/hundreds of GPU/compute instances to mine crypto. AWS has no hard spend cap; the only automated stop is a **Budget Action** (e.g., apply a restrictive IAM/SCP) triggered by a budget.

**Horror patterns:** AWS keys in a React bundle -> 300 EC2 instances mining Bitcoin -> **$73,000 in 3 days**; JS-bundle key -> 50 instances mining Monero -> $3,000. EleKtra-Leak: bots scan GitHub in real time and launch EC2 across regions within minutes of a key being committed.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| No budget | Runaway service unnoticed for a month | `aws-sdk`/`@aws-sdk/*` in deps; `serverless.yml`, CDK/Terraform AWS | Create **AWS Budget** + alert |
| Key exposed (severe) | Crypto-mining on your account | `AKIA...`/`ASIA...`, `aws_secret_access_key` in tracked/client files | Rotate immediately; IAM least-privilege |
| Left running | Idle EC2/RDS/NAT billed 24/7 | IaC provisioning compute with no auto-stop | Budget Action to stop instances |

**Exact cap steps:** Billing & Cost Management console (https://console.aws.amazon.com/cost-management/) -> **Budgets -> Create budget** -> template **Zero-spend** (alerts on any charge past free tier) or **Monthly cost budget**; set threshold (absolute or %, actual or forecasted) and email/SNS. Then add a **Budget Action** to auto-apply a deny IAM policy/SCP or stop EC2/RDS when exceeded. Add a **CloudWatch billing alarm** for near-real-time. Never embed `AKIA` keys client-side; use least-privilege IAM.
Links: [AWS Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/), [Create a cost budget](https://docs.aws.amazon.com/cost-management/latest/userguide/create-cost-budget.html), [Configure a budget action](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html), [Exposed-key crypto-mining cases](https://rafter.so/blog/api-keys/api-key-leaks).

---

## 11. Twilio / SendGrid (SMS, voice, email)

**How it detonates:** Pay-per-message/minute. **SMS pumping / toll fraud** - attackers hit an unprotected send-OTP/send-SMS endpoint to pump traffic to premium numbers - is the classic runaway. Twilio auto-recharges by default, so a drained balance just re-tops-up. No hard cap; the control is **Usage Triggers** (alerts) + disabling auto-recharge.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Public SMS/OTP endpoint | SMS pumping to premium numbers | `twilio` in deps; send-SMS route with no auth/rate-limit/geo-restriction | Rate limit + geo permissions + usage trigger |
| Auto-recharge on | Balance keeps refilling silently | (billing-side) warn in copy | Disable/lower auto-recharge |
| Email volume | Overage past plan credits | `@sendgrid/mail` in deps | SendGrid usage alert |
| Key exposed | `SG.` / `AC...` abused | SendGrid `SG.`, Twilio SID/token in repo/client | Rotate; server-side only |

**Exact cap steps:** Twilio Console -> set **Usage Triggers** (`trigger-by = price`, daily/monthly) to alert/act when cost crosses a value; enable **Geographic Permissions** to block high-fraud destinations; lower or disable **auto-recharge**; add rate limiting + Verify service protections on OTP endpoints. SendGrid -> **Settings -> Alerts** -> usage alert at e.g. 90% of credits.
Links: [Twilio usage triggers / fraud protection](https://support.twilio.com/hc/en-us/articles/223132387-Protect-your-Twilio-project-from-Fraud-with-Usage-Triggers), [Twilio UsageTrigger API](https://www.twilio.com/docs/usage/api/usage-trigger), [SendGrid alerts](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/alerts).

---

## 12. Google Maps Platform

**How it detonates:** Pay-per-load, $2-$30 per 1,000 requests. As of **March 1, 2025**, the flat **$200/mo credit was replaced with per-SKU free caps** (Essentials 10k, Pro 5k, Enterprise 1k free events/mo) - many apps that "fit under $200" now overflow. A map that reloads on every render, or an exposed `AIza` Maps key on a public site, gets scraped and racks up loads.

| Risk | How it detonates | Repo-scan detection signal | How to cap it |
|---|---|---|---|
| Per-load, key exposed (unavoidable client-side) | Scrapers/bots trigger paid loads | `@react-google-maps/api`, `@googlemaps/js-api-loader`, Maps script tag; `AIza` key in client | **Set QPD quota cap** + restrict key to HTTP referrers |
| Map reloads each render | Multiplies loads | Map component re-mounting; key in `useEffect` without memo | Memoize; load map once |
| Autocomplete per keystroke | Places calls per keystroke | Places Autocomplete without debounce/session tokens | Debounce + session tokens |

**Exact cap steps:** Cloud Console -> **APIs & Services -> [each Maps API] -> Quotas** -> set **Queries Per Day (QPD)** limits (this *actually* stops calls with HTTP 403 `OVER_QUERY_LIMIT`; a budget alert does **not**). Restrict the Maps API key to specific **HTTP referrers** and only the APIs you use. Add a Cloud Billing budget alert as a secondary signal.
Links: [Manage Google Maps costs](https://developers.google.com/maps/billing-and-pricing/manage-costs), [Maps pricing/free caps (Mar 2025)](https://developers.google.com/maps/billing-and-pricing/pricing), [Maps JS usage & billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing).

---

## 13. Any third-party paid API with no rate limit or cache

Generic rule the scanner should apply to *any* SDK it recognizes as metered (weather, geocoding, LLM proxies, scraping APIs, email validation, etc.):

| Risk | Repo-scan detection signal | How to cap it |
|---|---|---|
| Called per-request, no cache | Paid SDK call inside a route/handler with no cache wrapper | Wrap in Redis/Upstash/`unstable_cache`/in-memory memo |
| No rate limit on the route | Public route calling paid API, no `express-rate-limit`/`@upstash/ratelimit`/WAF | Add per-IP/per-user rate limit |
| Retry storm | `retry`/`while` loop with no max/backoff around paid call | Bounded retries + exponential backoff + circuit breaker |
| Key exposed | Any known key prefix or `.env` committed / `PUBLIC_`-prefixed secret | Rotate + move server-side |

---

## 14. Detection Ruleset Summary (for implementation)

**Secret-exposure scan (highest priority):**
- Regex for key prefixes in tracked files: `sk-`, `sk-ant-`, `AIza[0-9A-Za-z_\-]{35}`, `AKIA[0-9A-Z]{16}`, `r8_`, `SG\.`, `AC[0-9a-f]{32}`, generic high-entropy 32+ char strings.
- Flag any of the above (or a generic API key) behind a **client-exposed env prefix**: `NEXT_PUBLIC_`, `VITE_`, `REACT_APP_`, `EXPO_PUBLIC_`, `PUBLIC_`, `GATSBY_`, `VUE_APP_`, `NG_`.
- Flag `.env` / `.env.local` NOT present in `.gitignore` (i.e., committed).
- Flag keys/secrets referenced in files under `public/`, `static/`, or imported into client components.

**Dependency -> provider mapping (package.json / requirements.txt / go.mod):** `openai`->section 2, `@anthropic-ai/sdk`->section 3, `@google/generative-ai`/`@google-cloud/vertexai`->section 4, `replicate`/`@fal-ai/*`/`stability`->section 5, `firebase*`->section 6, `@supabase/supabase-js`->section 7, Vercel deploy config->section 8, `wrangler`/`@cloudflare/*`->section 9, `aws-sdk`/`@aws-sdk/*`->section 10, `twilio`/`@sendgrid/mail`->section 11, Google Maps loaders->section 12.

**Missing-control heuristics:** paid SDK present + (no rate-limit dependency) + (no cache dependency) + (unbounded retry pattern) -> raise "no runaway protection" warning per detected provider, and emit that provider's exact cap steps from the tables above.

**Config-file cross-checks:** `firestore.rules` with `allow ...: if true`; Firestore queries lacking `.limit()`; Cloud Functions without `maxInstances`; `next/image` with unbounded remote patterns; OTP/SMS routes without auth.

---

## Key sources
- OpenAI: [platform.openai.com/settings/organization/limits](https://platform.openai.com/settings/organization/limits) - [Grafient on removed hard limits](https://grafient.ai/blog/openai-removed-hard-budget-limits)
- Anthropic: [docs.anthropic.com/en/api/rate-limits](https://docs.anthropic.com/en/api/rate-limits)
- Gemini/Vertex: [blog.google Gemini cost control](https://blog.google/innovation-and-ai/technology/developers-tools/more-control-over-gemini-api-costs/) - [ai.google.dev billing](https://ai.google.dev/gemini-api/docs/billing)
- Image APIs: [digitalapplied pricing 2026](https://www.digitalapplied.com/blog/ai-image-generation-api-pricing-comparison-2026)
- Firebase: [avoid surprise bills](https://firebase.google.com/docs/projects/billing/avoid-surprise-bills) - [kill-switch extension](https://extensions.dev/extensions/kurtweston/functions-auto-stop-billing)
- Supabase: [billing docs](https://supabase.com/docs/guides/platform/billing-on-supabase)
- Vercel: [usagebox $23k bill](https://usagebox.com/articles/vercel-23000-dollar-bill-usage-based-platform-bill-shock-2026)
- Cloudflare: [budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
- AWS: [AWS Budgets](https://aws.amazon.com/aws-cost-management/aws-budgets/) - [budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-action-configure.html)
- Twilio/SendGrid: [usage triggers/fraud](https://support.twilio.com/hc/en-us/articles/223132387-Protect-your-Twilio-project-from-Fraud-with-Usage-Triggers)
- Google Maps: [manage costs](https://developers.google.com/maps/billing-and-pricing/manage-costs)
- Exposed keys: [Rafter key leaks](https://rafter.so/blog/api-keys/api-key-leaks) - [Sprocket Vite leak](https://www.sprocketsecurity.com/blog/hunting-secrets-in-javascript-at-scale-how-a-vite-misconfiguration-lead-to-full-ci-cd-compromise)

---

## Three load-bearing conclusions for the product

1. **"Budget alert" is not a cap** on OpenAI (org level), Firebase, Vercel Pro, AWS, Cloudflare, Twilio, SendGrid, and GCP billing budgets - the tool must not tell users these "cap" their spend. True hard stops exist only via: OpenAI **per-project** budgets, Anthropic tier/workspace spend limits, Gemini AI Studio **project spend cap**, Supabase **spend cap** (except compute add-ons), Google Maps **QPD quota**, and everywhere else an **automated kill-switch** (budget -> Pub/Sub/SNS -> function that disables billing or applies a deny policy).
2. **Exposed-key detection is the highest-value scan** - client-env prefixes (`NEXT_PUBLIC_`/`VITE_`/`REACT_APP_`/`EXPO_PUBLIC_`) holding secrets, committed `.env`, and key-prefix regexes catch the most catastrophic real-world bills ($3k-$73k crypto-mining cases).
3. **Firebase Blaze and Vercel Pro are the two biggest vibe-coder traps** because both look "free/cheap," both silently remove any ceiling once billing/scale is enabled, and neither offers a native hard cap - each needs its specific mitigation (Firebase kill-switch extension; Vercel Spend Management pause + Firewall).
