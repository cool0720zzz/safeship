# SafeShip Monetization Research

How developer tools make money, and what it means for **SafeShip** — an OSS-leaning `npx` local tool giving non-developer "vibe coders" a Git-safety + pre-deploy checklist + cost/secret guard before they deploy.

**Central insight up front:** Creation tools (Cursor, Lovable, v0, Bolt) monetize **AI inference / credits** — you pay per generation. Safety/scanning tools (GitGuardian, Snyk, Socket) monetize **continuous protection + teams + compliance** — you pay to keep watching, across many repos, with an audit trail. **SafeShip is a guardrail, not a creation tool, so it should copy the safety-tool playbook, not the creation-tool one.**

---

## GROUP 1 — The tools the user named (creation tools)

### Cursor (AI code editor)
Subscription + usage-based AI billing. Moved from request-count to a **usage-pool** model (June 2025).
- **Free (Hobby):** limited Agent use, limited Tab completions, trial of Pro features.
- **Pro — $20/mo** (~$16/mo annual): unlimited Tab, extended Agent limits, frontier models, plus a **$20/mo credit pool** for premium model usage (roughly ~225 Claude Sonnet / ~550 Gemini / ~650 GPT-4.1 requests at median). "Auto" model usage is effectively unlimited. Overages billed usage-based.
- **Pro+ / Ultra — ~$60–$200/mo:** bigger usage pools for heavy users.
- **Business/Teams — $40/seat/mo:** Pro-level AI + admin controls, central billing, shared team rules, SSO, privacy mode. (Mid-2026 split usage into first-party "Composer" pool vs third-party API pool.)
- **What they charge for:** access to AI model inference. The IDE is free; the tokens are the product.

### VS Code (Microsoft) — the loss-leader ecosystem play
VS Code is free & open-source (MIT). Microsoft does **not** monetize the editor directly. It's a funnel / platform:
- **GitHub Copilot** — the real money-maker. Per-seat: Free (limited), **Pro $10/mo**, Pro+ ~$39/mo, **Business $19/user/mo**, **Enterprise $39/user/mo**. VS Code is the default surface that drives Copilot attach.
- **Azure** — VS Code steers cloud dev workflows (Dev Containers, Azure extensions, remote SSH) toward Azure consumption.
- **Enterprise / GitHub** — VS Code + GitHub + Copilot bundled into org seats.
- **Marketplace** — Microsoft controls the extension distribution channel and telemetry (strategic lock-in, not direct revenue).
- **Takeaway for SafeShip:** give away a genuinely useful free tool to own the workflow surface, then attach a paid layer (cloud/team) on top. Free tool = distribution; the paid product sits adjacent.

### Lovable (AI app builder)
Credit/message-based subscription; hosting bundled.
- **Free — $0:** 5 daily credits (up to ~30/mo), public projects.
- **Pro — $25/mo:** 100 monthly credits + 150 daily credits; includes Cloud build/host grants; private projects, custom domains.
- **Business — $50/mo:** team features, SSO, data opt-out, more seats.
- **What a credit buys:** one AI message/build action. Cost flexes with complexity (~0.5 credit for a styling tweak, ~1.2 for adding auth). **You pay per generation** — same inference-metered logic as Cursor.

### Close comparables (brief)
| Tool | Core money model |
|---|---|
| **Replit** | Subscription (Core ~$20–25/mo) + **usage-based "compute/Agent" credits** + hosting/deployments. Metered inference + metered infra. |
| **v0 (Vercel)** | Credit/token subscription (~$20/mo Premium tiers) for AI UI generation; funnels into Vercel hosting. |
| **Bolt.new (StackBlitz)** | Token-based subscription (~$20/mo+), pay for AI generation tokens; overages buy more tokens. |
| **GitHub Copilot** | Per-seat SaaS ($10 Pro → $19/$39 Business/Enterprise). Pure inference-as-a-seat. |
| **Vercel / Netlify** | **Usage-based infra**: free hobby tier, then metered bandwidth/build-minutes/functions + per-seat team ($20–25/member/mo). Pay for what you ship/serve. |

**Pattern across Group 1:** the meter is either AI tokens/credits or infra consumption. This is the *wrong* meter for a guardrail — SafeShip doesn't generate anything and doesn't host anything.

---

## GROUP 2 — The apt analogs (safety / scanning tools)

These are the real template for SafeShip.

### GitGuardian (secret scanning)
- **Free (Starter):** up to 25 developers, unlimited real-time scanning, up to 500 historical detections, 350+ secret types. Generous free tier is the adoption engine; OSS repos free.
- **Teams — ~$45/developer/mo:** full incident management, remediation workflows, collaboration.
- **Business:** custom detectors, **CI/CD pipeline scanning**, SIEM/ticketing integrations, SSO, priority support (mid-market, 25–200 devs).
- **Enterprise:** self-hosted option, advanced API, compliance reporting, dedicated CS, 24/7 support (quote-based).
- **How they price:** **per active contributor** (anyone with a commit in the last 90 days). Free CLI/pre-commit scanner (`ggshield`) drives grassroots adoption → paid **continuous cloud monitoring + team incident workflows + compliance**.

### Snyk (security scanning)
- **Free:** unlimited contributors but **capped tests/month** (e.g. SCA ~200, SAST ~100); OSS/public repos don't count toward billing.
- **Team — $25/contributing-dev/mo:** removes test caps, adds collaboration; capped at 10 seats before you must talk to sales.
- **Business / Enterprise:** custom pricing, often $48k–$84k/yr for ~50 devs; SSO, reporting, governance, premium support.
- **How they price:** **per contributing developer** (commit to a private monitored repo in last 90 days). Free tier for individuals/OSS, paid tiers unlock **volume + continuous monitoring + compliance/governance**.

### Socket.dev & Gitleaks (OSS → revenue)
- **Gitleaks:** MIT-licensed CLI secret scanner. Pure OSS, no direct revenue — monetized indirectly (the maintainer's sponsorships/consulting; and it seeds the category GitGuardian/others sell into). Shows the risk of *no* commercial layer.
- **Socket.dev:** open-source-friendly supply-chain/dependency scanner. **Open-core + freemium SaaS**: free for open source and small teams (free GitHub app), paid tiers for orgs (per-seat/per-repo) adding org-wide dashboards, policy enforcement, and CI gates. The OSS CLI + free GitHub app are the funnel; the **hosted continuous org dashboard + policy** is paid.

### Dependabot & Renovate (OSS + hosted)
- **Dependabot:** free, built into GitHub — monetized indirectly as a GitHub platform feature that increases GitHub/Advanced-Security stickiness (GitHub Advanced Security is the paid layer).
- **Renovate:** OSS self-hostable **+ Mend.io hosted/enterprise** ("Mend Renovate"). Classic **open-core**: the engine is free and self-hostable; Mend sells the managed multi-repo dashboard, org policy, dependency governance, and support.

**Pattern across Group 2:** free (often OSS) local/CLI scanner for adoption → **paid = continuous cloud monitoring, multi-repo/org dashboards, CI/CD gating, policy enforcement, SSO, and compliance/audit** → **per-contributor or per-repo seat pricing**, usually sales-assisted at the top.

---

## Master comparison table

| Tool | Model | Free tier | Paid tiers / price | What they charge for |
|---|---|---|---|---|
| **Cursor** | Sub + usage pool | Hobby (limited) | Pro $20/mo (+$20 usage pool); Business $40/seat/mo; Ultra to ~$200 | AI model inference (tokens) |
| **VS Code** | Free OSS (loss leader) | Entire editor free | $0 — monetized via Copilot/Azure/GitHub | Nothing directly; funnels to Copilot seats + Azure |
| **GitHub Copilot** | Per-seat SaaS | Free (limited) | Pro $10; Business $19; Enterprise $39/user/mo | AI inference as a seat |
| **Lovable** | Credit sub | Free (5 credits/day) | Pro $25/mo (100 credits); Business $50/mo | AI generation credits + hosting |
| **Replit** | Sub + usage credits | Free (limited) | Core ~$20–25/mo + compute/Agent credits | Inference + compute/hosting |
| **v0 (Vercel)** | Credit sub | Free (limited) | ~$20/mo+ | AI UI-generation tokens → Vercel hosting |
| **Bolt.new** | Token sub | Free (limited) | ~$20/mo+ | AI generation tokens |
| **Vercel / Netlify** | Usage-based infra | Hobby free | Pro ~$20–25/member/mo + metered usage | Bandwidth, builds, functions, seats |
| **GitGuardian** | Freemium → per-contributor SaaS | ≤25 devs, unlimited real-time scan | Teams ~$45/dev/mo; Business & Enterprise quote | Continuous cloud monitoring, incident workflows, CI/CD, compliance |
| **Snyk** | Freemium → per-contributor SaaS | Unlimited devs, capped tests | Team $25/dev/mo (≤10 seats); Ent custom | Removing test caps, continuous monitoring, governance/compliance |
| **Socket.dev** | Open-core + freemium | Free for OSS/small teams | Paid org tiers (per-seat/repo) | Org dashboard, policy enforcement, CI gates |
| **Gitleaks** | Pure OSS | Everything free | — | Nothing (sponsorship/indirect) |
| **Dependabot** | Free platform feature | Free in GitHub | — | Indirect (GitHub Advanced Security) |
| **Renovate / Mend** | Open-core | OSS self-host free | Mend hosted/enterprise (custom) | Managed multi-repo dashboard, policy, support |

*Sources listed at bottom.*

---

## SYNTHESIS for SafeShip

### Monetization archetypes — pros/cons for THIS product & audience
Audience = **non-developer "vibe coders"** (low tolerance for config, won't self-host, scared of breaking things) **+ agencies onboarding many client repos** (the real wallet).

| Archetype | Fit for SafeShip | Pros | Cons |
|---|---|---|---|
| **Open-core** (free CLI, paid hosted engine) | High | OSS = trust + viral `npx` adoption; matches GitGuardian/Renovate/Socket | Must keep a clear free/paid line; risk of free tier being "enough" |
| **Freemium SaaS** (free local, paid cloud) | **Highest** | Local scan free → paid continuous cloud monitoring is a natural upgrade; recurring revenue | Requires building/operating a cloud backend |
| **Per-seat team** | High (esp. agencies) | Agencies managing many client repos = clean multi-seat/multi-repo value; predictable ARPU | Solo vibe coders resist "seats"; better as per-repo for them |
| **Usage-based** | **Low** | — | SafeShip generates nothing and hosts nothing — no natural token/compute meter. Avoid as primary. |
| **Managed cloud / continuous monitoring** | **Highest-value paid layer** | This is *the* thing safety tools charge for; scans on every push, alerts, spend/secret dashboards | Ongoing infra cost; needs integrations (GitHub, hosts, cloud billing APIs) |
| **Marketplace** (GitHub App / template store) | Medium | Distribution channel (like Socket's GitHub App); low friction install | Not a revenue center on its own; a funnel |

### Recommended path

**Model: Open-core + freemium SaaS with a per-repo/per-seat cloud layer.** Free local tool is the adoption engine; money is in **continuous cloud protection + multi-repo team management + compliance/gating** — exactly the GitGuardian/Snyk/Socket pattern, adapted for non-devs and agencies.

**FREE (adoption engine — must be genuinely great):**
- `npx safeship` local run: pre-deploy checklist, Git-safety checks (uncommitted changes, wrong branch, force-push guard, `.gitignore` sanity), **secret scanning of the local repo**, one-shot cost/config sanity check (e.g. flags exposed API keys, public buckets, unbounded serverless).
- Local pre-commit / pre-deploy hook.
- OSS core (MIT or similar) — this is what earns trust with a skeptical, non-technical crowd and gets word-of-mouth in vibe-coder communities.

**PAID — "SafeShip Cloud" (the recurring product):**
1. **Continuous cloud monitoring** — SafeShip keeps watching after the one-time local scan: every push/deploy re-scanned for new secrets, risky config, and Git mishaps. (This is the single most important paid feature — the difference between a one-off CLI and a subscription.)
2. **Real-time spend / cost guard dashboard** — connect cloud billing (Vercel/Netlify/AWS/Supabase) and alert on cost spikes, runaway functions, and "you're about to get a $5k bill" moments. This is SafeShip's *unique* wedge vs. GitGuardian/Snyk and speaks directly to vibe-coder fear.
3. **Team / multi-repo** — one dashboard across many repos; **the agency killer feature** (onboard 30 client repos, monitor all, per-client reports).
4. **CI/CD deploy gate** — block a deploy if checks fail; policy rules; integrates into GitHub Actions / host deploy hooks.
5. **Desktop app / one-click GUI** — for non-devs who won't live in a terminal; a "green light to ship" button. Strong paid or premium-free hook for the vibe-coder persona.

**Rough price points (anchored to comps):**
- **Free** — local CLI + 1 connected repo, community support.
- **Pro (solo vibe coder) — ~$12–20/mo** — continuous monitoring + spend dashboard + desktop app, up to ~3–5 repos. (Priced like Copilot Pro / Cursor Pro so it feels normal to this crowd.)
- **Team / Agency — ~$25–45 per seat or ~$8–15 per monitored repo/mo** — multi-repo dashboard, CI/CD gate, client reports, SSO. Per-**repo** pricing likely converts agencies better than per-seat (they think in client projects, not developers). Anchor near Snyk's $25/dev and GitGuardian's $45/dev.
- **Business/Enterprise — custom** — SSO, audit logs, self-host/on-prem, compliance reporting, dedicated support.

### Why this shape (the key insight, restated)
- Cursor/Lovable/Replit charge for **inference and hosting they provide** — SafeShip provides neither, so **usage/credit billing does not fit** and would cap adoption of a tool whose whole value is being run freely and often.
- GitGuardian/Snyk/Socket charge for **continuous protection, multi-repo scale, and team/compliance** — SafeShip is exactly that category. So: **give the scan away, charge for the watching.**
- SafeShip's differentiated wedge vs. the incumbents is (a) **built for non-developers** (GUI, plain-English "why this is dangerous," one-click safe deploy) and (b) the **cost/spend guard**, which the security incumbents don't do. The **agency multi-repo** motion is where recurring revenue concentrates — design the paid tier around per-repo/per-client management from day one.

---

## Sources (current 2026 pricing)
- Cursor: https://www.cursor.com/pricing ; https://www.eesel.ai/blog/cursor-pricing ; https://www.nocode.mba/articles/cursor-pricing
- Lovable: https://lovable.dev/pricing ; https://docs.lovable.dev/introduction/credits-and-usage ; https://www.nocode.mba/articles/lovable-pricing
- GitHub Copilot: https://github.com/features/copilot/plans
- Replit: https://replit.com/pricing
- v0 / Vercel: https://v0.app/pricing ; https://vercel.com/pricing
- Bolt.new: https://bolt.new/pricing
- Netlify: https://www.netlify.com/pricing/
- GitGuardian: https://www.gitguardian.com/pricing
- Snyk: https://snyk.io/plans/
- Socket.dev: https://socket.dev/pricing
- Gitleaks: https://github.com/gitleaks/gitleaks
- Renovate / Mend: https://www.mend.io/renovate/ ; Dependabot: https://github.com/features/security
