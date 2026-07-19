# Git Safety Layer — Detection & Secret-Scan Ruleset

*Verified against current tooling: OpenAI now issues `sk-proj-`/`sk-svcacct-`/`sk-admin-` keys (legacy `sk-`), Anthropic uses `sk-ant-api03-…`, GitHub blocks files >100MB (warns >50MB, browser upload cap 25MB).*

---

## Part A — Dangerous Git Actions for Beginners

Severity legend: 🔴 **Block** (hard stop, require explicit override) · 🟠 **Warn** (confirm dialog) · 🟡 **Nudge** (inline tip).

| # | Action | Why it's dangerous | Computable detection signal | Severity | Friendly guided fix |
|---|--------|--------------------|-----------------------------|----------|---------------------|
| A1 | **Commit directly to main/master** | No safety net; every save is "live." Can't experiment or roll back cleanly; collaborators blocked. | `git rev-parse --abbrev-ref HEAD` ∈ {`main`,`master`}. Also flag if `git config branch.main.remote` set + about to push. | 🟠 Warn | "You're about to save straight to your live copy. Want me to make a safe branch first?" → offer one-click: `git switch -c my-changes` (moves staged work along). |
| A2 | **Force push** (`--force` / `-f`) | Overwrites remote history; erases others' commits; irreversible on remote. Catastrophic on `main`. | Command contains `push` + (`--force`\|`-f`\|`--force-with-lease`). Escalate if target branch is default branch (compare to `git symbolic-ref refs/remotes/origin/HEAD`). | 🔴 Block on main / 🟠 Warn elsewhere | "This erases the online history and can delete work permanently. Are you trying to undo a mistake? Let me show you a safe alternative (`git revert`)." Prefer `--force-with-lease` if truly needed. |
| A3 | **Commit secrets** (.env, keys, creds, service-account json) | Credential leak = account takeover, cloud bill fraud, data breach. Persists in history even after deletion. | Filename match (see Part B file list) in `git diff --cached --name-only`, **OR** content regex/entropy hit in staged diff. | 🔴 Block | "This file has what looks like a password/API key. Committing it could let strangers into your account. I'll add it to `.gitignore` and keep it out of the commit." Offer: unstage + gitignore + (if already committed) rotate-key guidance. |
| A4 | **Huge files / node_modules / build artifacts / datasets** | GitHub **blocks >100MB**; bloats repo permanently (history keeps the bytes); slow clones; `node_modules` is regenerable garbage. | Staged file size: `git diff --cached --numstat` + `git cat-file -s`, flag ≥50MB (warn) / ≥100MB (block). Path match: `node_modules/`, `dist/`, `build/`, `.next/`, `*.zip/mp4/csv/sqlite/psd`, `venv/`, `*.log`. | 🔴 Block ≥100MB / 🟠 Warn ≥50MB or artifact path | "This is a big/auto-generated file GitHub won't accept (or that bloats your project). It's rebuildable — I'll add it to `.gitignore` instead." Suggest Git LFS only if it's a genuine asset. |
| A5 | **`git reset --hard` / discarding uncommitted work** | Permanently deletes uncommitted edits — no undo, not in history. | Command matches `reset --hard`, `checkout -- .`, `restore .`, `clean -fd`, `stash drop`. Check `git status --porcelain` is non-empty (work exists to lose). | 🟠 Warn | "This throws away unsaved changes for good. Want me to save a backup snapshot first?" → auto `git stash` or a WIP commit before proceeding. |
| A6 | **Commit without meaningful message** | Future-you can't find/understand changes; no audit trail; "asdf"/"update" everywhere. | Message length < 10 chars, or ∈ stopword set {`update`,`fix`,`wip`,`asdf`,`.`,`changes`,`stuff`}, or all-lowercase single word. | 🟡 Nudge | Auto-suggest a message from the diff: "How about: *'Add login button to homepage'*?" (generate from changed files/functions). Never block. |
| A7 | **Not pulling before push (diverged history)** | Push rejected (`non-fast-forward`), or beginner force-pushes over teammate's work (→A2). | `git rev-list --left-right --count @{u}...HEAD` → remote-ahead count > 0 while local-ahead > 0 = diverged. Or detect prior `! [rejected]` push output. | 🟠 Warn | "The online version has newer changes than yours. I'll pull them in safely first (`git pull --rebase`), then push." Handle conflicts with plain-language prompts. |
| A8 | **Making a private repo public with secrets in history** | Secrets deleted from current files still live in old commits → instantly exposed to the world on publish. | On visibility-change intent: run **full-history** secret scan (`git log -p` / all blobs), not just working tree. Flag any historical hit. | 🔴 Block | "Before going public: I found an API key in your project's older history. Deleting the file isn't enough — anyone can read old versions. You must **rotate (regenerate) that key** first. Here's how for [provider]." |

---

## Part B — Secret Scanning

### B1. High-confidence key formats (regex)

These have distinctive prefixes/structure → near-zero false positives. Match against staged diff added lines (`git diff --cached -U0`) and, for A8, full history.

| Provider | Regex | Notes |
|----------|-------|-------|
| OpenAI (modern) | `sk-(proj\|svcacct\|admin)-[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}` | Body contains literal `T3BlbkFJ` marker; hyphens/underscores in body. |
| OpenAI (legacy) | `sk-[A-Za-z0-9]{48}` | Older keys. |
| Anthropic | `sk-ant-api03-[A-Za-z0-9_-]{93}AA` | Ends in `AA`; underscores/hyphens allowed. |
| AWS Access Key ID | `AKIA[0-9A-Z]{16}` | Also `ASIA` (temp), `AGPA`, `AIDA`. Pair with 40-char secret access key nearby. |
| AWS Secret Key | `(?i)aws.{0,20}['\"][0-9a-zA-Z/+]{40}['\"]` | Entropy-gated (base64, 40 chars). |
| GitHub PAT | `gh[pousr]_[A-Za-z0-9]{36}` | `ghp_`=classic, `gho_`,`ghu_`,`ghs_`,`ghr_`. Fine-grained: `github_pat_[A-Za-z0-9_]{82}`. |
| Google API key | `AIza[0-9A-Za-z_-]{35}` | Firebase/Maps/Cloud. |
| Google OAuth | `[0-9]+-[0-9a-z_]{32}\.apps\.googleusercontent\.com` | Client IDs. |
| Stripe | `sk_live_[0-9a-zA-Z]{24,}` / `rk_live_…` | `sk_test_`/`pk_` = lower severity. `pk_live_` publishable = OK. |
| Slack | `xox[baprs]-[0-9A-Za-z-]{10,}` | Bot/user/app tokens. |
| Twilio | `SK[0-9a-fA-F]{32}` / `AC[0-9a-f]{32}` | |
| SendGrid | `SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}` | |
| Private keys | `-----BEGIN (RSA\|EC\|OPENSSH\|PGP\|DSA)? ?PRIVATE KEY-----` | Any PEM private key block. Very high severity. |
| JWT | `eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` | Decode header to confirm; may be low-risk. |
| DB URL w/ password | `(postgres\|postgresql\|mysql\|mongodb(\+srv)?\|redis\|amqp)://[^:@/\s]+:[^@/\s]+@` | Password embedded in connection string. |
| Firebase config | Object with `apiKey:` + `authDomain:` + `projectId:` | Config itself is public-ish, but flag `databaseURL`/service keys and warn about missing security rules. |
| Generic assignment | `(?i)(api[_-]?key\|secret\|token\|password\|passwd\|access[_-]?key)\s*[:=]\s*['\"][^'\"]{8,}['\"]` | Broad net; **must** be entropy-gated to cut noise. |

### B2. Entropy signal (for keys without known prefixes)

For string literals matched by the generic rule: compute **Shannon entropy** of the value.
- Base64/hex-ish strings ≥20 chars with entropy **> 4.0 bits/char** → likely a secret.
- Reduce false positives: skip if value is in a placeholder set (`your-api-key`, `xxxx`, `changeme`, `example`, `<...>`), is a UUID in a non-secret context, a git SHA, or a lockfile hash. Skip test fixtures/`*.example` files.

### B3. Files that should never be committed (path denylist)

`.env`, `.env.*` (`.env.local`, `.env.production`), `*.pem`, `*.key`, `id_rsa`, `id_ed25519`, `id_dsa`, `*.ppk`, `*.p12`, `*.pfx`, `*.keystore`, `serviceAccount.json`, `service-account*.json`, `*-firebase-adminsdk-*.json`, `credentials.json`, `gcloud-*.json`, `.aws/credentials`, `.npmrc` (may hold auth token), `.netrc`, `secrets.yaml`/`secrets.yml`, `*.jks`, `.pypirc`, `terraform.tfstate` (often embeds secrets).
**Allowlist exceptions:** `.env.example`, `.env.sample`, `.env.template` (should have placeholder values — still scan them for real secrets).

### B4. Tools to learn from

| Tool | Approach | Takeaway for us |
|------|----------|-----------------|
| **gitleaks** | Regex ruleset (TOML) + entropy over diffs/history; fast; runs as pre-commit hook or CI. | Best model for our pre-commit scan: prefix regex + entropy, allowlist support. Ship a curated ruleset. |
| **trufflehog** | Regex **plus live verification** — actually calls the provider API to confirm a key is active. Deep history scan. | Offer optional "verify key is live" step to escalate severity and prove real risk to the user. |
| **git-secrets** (AWS) | Pre-commit hook, provider-specific patterns, blocks commit. | Confirms the pre-commit-block UX pattern we want. |
| **GitHub push protection** | Server-side scan on push; blocks the push if a known secret pattern is found; partners with providers for auto-revocation. | Our client-side equivalent = block **before** push/deploy; integrate rotation links per provider. |

### B5. The history nuance (critical)

A secret committed and later "deleted" **is still fully readable** in every prior commit that contained it, in reflogs, and in anyone's existing clone/fork. Therefore:
1. **Scan history, not just the working tree** — iterate all blobs (`git rev-list --all --objects` → `git cat-file`) or `git log -p`, especially before A8 (repo going public) and before first push.
2. **Remediation = rotate the key, not delete the file.** The only safe fix is to **regenerate/revoke the exposed credential** at the provider. History rewriting (`git filter-repo`, BFG) is secondary cleanup and doesn't help if someone already cloned.
3. Present rotation as the primary CTA with a provider-specific deep link (OpenAI/Anthropic/AWS/Stripe dashboards).

---

## Part C — Framework / Project Auto-Detection

Read `package.json` (`dependencies` + `devDependencies` + `scripts`) and check for signature config files. Evaluate in this priority order (first match wins for the stack; deploy target is detected independently).

### C1. Stack detection

| Stack | Primary signal (deps) | Config-file / script signals |
|-------|----------------------|------------------------------|
| **Next.js** | `next` in deps | `next.config.{js,mjs,ts}`; scripts use `next dev`/`next build`; `app/` or `pages/` dir; `.next/` in gitignore |
| **Astro** | `astro` in deps | `astro.config.{mjs,ts}`; `.astro` files; scripts `astro dev` |
| **SvelteKit** | `@sveltejs/kit` in deps | `svelte.config.js`; `src/routes/`; `vite` also present |
| **Nuxt** | `nuxt` in deps | `nuxt.config.{js,ts}` |
| **Remix / React Router 7** | `@remix-run/*` or `react-router` (fw mode) | `remix.config.js` or `vite.config` + `@remix-run/dev` |
| **Vite + React (SPA)** | `vite` + `react` + `@vitejs/plugin-react`, **no** `next`/framework meta-pkg | `vite.config.{js,ts}`; `index.html` at root; script `vite` |
| **Vite + Vue/Svelte** | `vite` + (`vue` \| `svelte`) | `vite.config.*`; `.vue`/`.svelte` files |
| **Create React App** | `react-scripts` in deps | scripts `react-scripts start/build`; `public/index.html` + `src/index.js` |
| **Plain Node / Express API** | `express`\|`fastify`\|`koa`\|`hapi`, no frontend framework | `server.js`/`app.js`/`index.js`; script `node …`/`nodemon`; no bundler |
| **Vanilla static site** | No `package.json`, or no framework deps | `index.html` at root + `css`/`js` folders; no build script |
| **Vue CLI** | `@vue/cli-service` | `vue.config.js` |

Tie-breakers: presence of a framework meta-package (`next`, `astro`, `nuxt`, `@sveltejs/kit`) always overrides a bare `vite`/`react` classification. If `package.json` is absent but `index.html` exists → static. Also probe other ecosystems: `requirements.txt`/`pyproject.toml` → Python; `Gemfile` → Ruby; `go.mod` → Go; `Cargo.toml` → Rust — so the tool doesn't mislabel a non-JS repo.

### C2. Deploy-target detection (independent of stack)

| Target | Signal file(s) |
|--------|----------------|
| **Vercel** | `vercel.json`, `.vercel/` dir, or Next.js default (Vercel is the default assumption for Next) |
| **Netlify** | `netlify.toml`, `_redirects`, `.netlify/` |
| **Render** | `render.yaml` |
| **Fly.io** | `fly.toml` |
| **Cloudflare Pages/Workers** | `wrangler.toml`, `wrangler.jsonc`, `functions/` dir |
| **Railway** | `railway.json`, `railway.toml`, `nixpacks.toml` |
| **Heroku** | `Procfile`, `app.json` |
| **GitHub Pages** | `.github/workflows/*pages*`, `CNAME`, `gh-pages` dep/branch |
| **AWS Amplify** | `amplify.yml`, `amplify/` dir |
| **Docker (self-host)** | `Dockerfile`, `docker-compose.yml` |
| **Firebase Hosting** | `firebase.json`, `.firebaserc` |

If none present, infer default: Next.js→Vercel, static→"pick a host" prompt. Combine C1+C2 to set correct scan rules (e.g., a Vite SPA embeds env vars prefixed `VITE_` into the client bundle → warn that any `VITE_`/`NEXT_PUBLIC_` secret is publicly shipped).

---

## Part D — Beginner Branch Model (Visual Teaching)

### D1. The simplest safe model for a solo vibe coder

**"Main is your published book. Branches are your rough drafts."**

```
main   ──●──────────●───────────────●──────►   (always working; this deploys)
          \        /                 \
feature    ●──●──●   (merge back)      ●──●──●  (next idea)
         "add-login"                 "new-colors"
```

The loop, four steps, repeated forever:
1. **Start a draft** → `git switch -c add-login` (branch off main)
2. **Work & save** → make changes, `commit` as you go (safe — main untouched)
3. **Merge the draft in** → when it works, merge the branch into `main` (via PR or `git merge`)
4. **Deploy from main** → main is always the good, shippable copy

Rule the tool enforces: **never commit straight to main** (A1). Every new task auto-starts a branch. This gives beginners an undo button (delete the branch) and keeps `main` always-deployable.

### D2. Plain-language glossary + metaphors

| Term | No-jargon explanation | Metaphor |
|------|----------------------|----------|
| **Commit** | A saved snapshot of your project at one moment, with a note about what changed. | A **photo** in a photo album — you can always flip back to it. Or a save point in a video game. |
| **Branch** | A separate copy where you can try things without touching the real version. | A **sandbox / rough-draft notebook** next to your final essay. |
| **main / master** | Your official, live version — the one that gets published. | The **master copy** on display; the published book. |
| **Push** | Upload your saved snapshots to the cloud (GitHub) so they're backed up and shareable. | **Uploading photos** from your phone to the cloud. |
| **Pull** | Download the latest changes from the cloud to your computer. | **Refreshing your inbox** to get new mail. |
| **Merge** | Combine the work from your draft branch back into the main version. | **Folding a side road back** into the main highway; stirring one bowl into another. |
| **Clone** | Make your own full local copy of an online project. | **Downloading the whole folder** to your desk. |
| **Pull request (PR)** | A proposal: "here's my draft — review and add it to main." | **Handing in your draft** for approval before it's published. |
| **Diverged history** | Your copy and the cloud copy both changed separately and now disagree. | Two people **edited the same doc offline**; now you must reconcile. |
| **Conflict** | Two changes touched the same line — the tool needs you to pick which wins. | Two edits **on the same sentence**; choose the final wording. |

### D3. UI teaching cues
- Show a **live branch ribbon**: green "safe branch: add-login" vs red "⚠ you're on main."
- Visualize commits as a **dot timeline**; push = dots turning into a cloud icon.
- Before any risky op, render the metaphor inline ("This erases photos from the album permanently").

---

### Files/paths this ruleset expects to read per repo
`package.json`, `.gitignore`, `.env*`, `next.config.*`, `vite.config.*`, `astro.config.*`, `svelte.config.js`, `vercel.json`, `netlify.toml`, `render.yaml`, `fly.toml`, `wrangler.toml`, `Dockerfile`, plus full git history via `git rev-list --all --objects`.

### Sources
- gitleaks ruleset — https://github.com/gitleaks/gitleaks/blob/master/config/gitleaks.toml
- Semgrep prefixed-secrets — https://semgrep.dev/blog/2025/secrets-story-and-prefixed-secrets/
- GitHub large-files docs — https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
- GitProtect storage limits — https://gitprotect.io/blog/github-storage-limits/
