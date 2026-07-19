# SafeShip Pre-Deploy Research — Non-JavaScript Environments

Scope: pre-deploy checklists for **non-JS** stacks, oriented toward a repo-scanning tool that warns non-developer "vibe coders" about broken deploys, exposed secrets/PII, security footguns, and surprise costs. The JS ecosystem is covered separately and excluded here.

---

## 0. The One Pattern That Matters Most: Production Debug Mode Left ON

For server-side stacks, the single highest-severity, highest-frequency footgun is **shipping with debug mode enabled**. It is the non-JS equivalent of exposing a client-side API key. When an unhandled exception occurs (and one always will), the framework renders an interactive error page to the public that can leak:

- Source code excerpts and full stack traces
- **The entire settings/config object, including SECRET_KEY, DB passwords, and API keys** (Django lists all settings on its error page)
- Environment variables, installed package versions, file paths, and server internals
- Sometimes an interactive console that executes arbitrary code (Werkzeug/Flask debugger PIN, Symfony/Laravel profiler)

The tell across every framework is a single flag or env var:

| Framework | Debug flag | Danger when set |
|---|---|---|
| Django | `DEBUG = True` | Error page dumps **all settings + secrets**, SQL log grows unbounded (memory) |
| Flask | `debug=True` / `FLASK_DEBUG=1` | Werkzeug interactive debugger → **RCE** if PIN bypassed |
| FastAPI/Starlette | `debug=True` | Stack traces to client |
| Laravel | `APP_DEBUG=true` | Ignition error page leaks env vars + config; historically RCE (CVE-2021-3129) |
| Rails | `config.consider_all_requests_local` / non-production env | Full error pages + `web-console` gem RCE if reachable |
| Spring Boot | `server.error.include-stacktrace=always`, `include-message=always` | Stack traces + messages to clients |
| Symfony | `APP_ENV=dev` + web profiler | Profiler leaks everything |
| Phoenix | `config :app, debug_errors: true` (dev) | Stack traces to client |

**SafeShip rule:** if any of these evaluates to a debug-on state in a file that looks production-bound (or the value is hardcoded rather than env-driven), raise a CRITICAL. This should be the flagship check.

Source: [Django deployment checklist](https://docs.djangoproject.com/en/5.0/howto/deployment/checklist/) — "Never deploy a site into production with DEBUG turned on… it leaks lots of information about your project."

---

## 1. Python — Django

### Detection

| Signal | Meaning |
|---|---|
| `manage.py` | Django project (near-definitive) |
| `**/settings.py` or `settings/` package (`base.py`, `production.py`) | Config location |
| `**/wsgi.py`, `**/asgi.py` | WSGI/ASGI entrypoint (deploy target) |
| `Django` / `django` in `requirements.txt`, `pyproject.toml`, `Pipfile`, `poetry.lock`, `uv.lock` | Dependency |
| `django` imports, `INSTALLED_APPS`, `urls.py` | Corroborating |

### Pre-deploy checklist + repo detection

| Risk | Severity | How to detect from repo |
|---|---|---|
| `DEBUG = True` reaching prod | CRITICAL | Regex `DEBUG\s*=\s*True` in settings; safe form is `DEBUG = os.environ.get(...)`. Flag hardcoded `True` or a default-True env fallback. |
| Hardcoded `SECRET_KEY` | CRITICAL | `SECRET_KEY\s*=\s*['"]` with a literal (not `os.environ`/`config()`). Enables session forgery, password-reset token forgery. |
| `ALLOWED_HOSTS = ['*']` | HIGH | Literal `'*'` — disables Host-header validation (CSRF/cache-poisoning exposure). |
| `.env` / secrets committed | CRITICAL | Presence of `.env`, `local_settings.py`, `*.pem`, service-account JSON in the tree and NOT in `.gitignore`. |
| DB credentials in `settings.py` | CRITICAL | `PASSWORD`/`USER` literals inside `DATABASES`. |
| Running `manage.py runserver` in prod | HIGH (broken/insecure) | `runserver` in `Procfile`, `Dockerfile` CMD, `docker-compose`, or start script. Should be `gunicorn project.wsgi` / `uvicorn project.asgi`. runserver is single-threaded, unhardened, explicitly "not for production." |
| No WSGI/ASGI server dependency | HIGH | No `gunicorn`/`uvicorn`/`waitress`/`daphne` in deps but a web deploy is implied. |
| `collectstatic` not run | MEDIUM (broken UI, 404 CSS/JS) | No `collectstatic` in build/release step; `STATIC_ROOT` set but no `whitenoise`/CDN. |
| Migrations not applied | HIGH (broken deploy / 500s) | No `migrate` in release/entrypoint; unapplied migration files present. |
| Missing HTTPS/cookie hardening | MEDIUM | `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS` absent when `DEBUG=False`. `manage.py check --deploy` reports these. |

Tip for SafeShip: recommend/emulate `python manage.py check --deploy`, which is Django's own built-in production linter.

---

## 2. Python — Flask / FastAPI

### Detection

| Signal | Meaning |
|---|---|
| `Flask` / `flask` in deps; `app = Flask(__name__)` | Flask |
| `fastapi` in deps; `app = FastAPI()` | FastAPI |
| `app.py`, `main.py`, `wsgi.py`, `asgi.py`, `application.py` | Entrypoint |
| `starlette`, `uvicorn`, `gunicorn` in deps | Server hints |

### Pre-deploy checklist + repo detection

| Risk | Severity | How to detect from repo |
|---|---|---|
| `app.run(debug=True)` / `FLASK_DEBUG=1` | CRITICAL | Werkzeug debugger allows arbitrary code execution via the browser console if reached. Regex `debug\s*=\s*True`, `FLASK_DEBUG`, `FastAPI(debug=True)`. |
| Dev server used in prod (`app.run()` / `uvicorn.run()` reload) | HIGH | `app.run(` or `uvicorn.run(..., reload=True)` as the deploy CMD instead of `gunicorn -w 4` / `gunicorn -k uvicorn.workers.UvicornWorker` / `uvicorn --workers`. Flask's built-in server is not production-grade. |
| No production WSGI/ASGI server in deps | HIGH | No `gunicorn`/`uvicorn`/`hypercorn`/`waitress`. |
| Hardcoded `SECRET_KEY` | CRITICAL | `app.secret_key = "..."` / `SECRET_KEY = "..."` literal → session cookie forgery. |
| Not binding `0.0.0.0:$PORT` | MEDIUM (broken deploy) | Hardcoded `host="127.0.0.1"` or fixed port won't receive traffic on most PaaS. Should read `$PORT`. |
| CORS wide open | HIGH | `CORS(app)` with no origins, `allow_origins=["*"]` **combined with** `allow_credentials=True` (browser-invalid + leaks). Flag `flask_cors` default and Starlette `CORSMiddleware(allow_origins=["*"])`. |
| No rate limiting on paid/LLM/email routes | HIGH (surprise cost) | Routes that call OpenAI/Anthropic/Stripe/SendGrid/Twilio SDKs with no `slowapi`/`flask-limiter` and no auth. Beginner cost-blowout vector. |
| Secrets/keys committed | CRITICAL | `.env`, API keys in source (see cross-language secret scan). |
| `DEBUG`/docs open exposing schema | LOW/INFO | FastAPI `/docs`, `/redoc`, `/openapi.json` public — usually fine, but note for internal APIs. |

---

## 3. Ruby — Rails

### Detection

| Signal | Meaning |
|---|---|
| `Gemfile` + `rails` gem | Rails |
| `config/`, `app/`, `config/routes.rb`, `bin/rails` | Structure |
| `Procfile`, `config/puma.rb` | Server config |
| `config/master.key`, `config/credentials.yml.enc` | Encrypted credentials |

### Pre-deploy checklist + repo detection

| Risk | Severity | How to detect from repo |
|---|---|---|
| `RAILS_ENV` not `production` | HIGH | Deploy env missing `RAILS_ENV=production`/`RACK_ENV=production` → dev error pages, `web-console` gem RCE if reachable. |
| `master.key` committed | CRITICAL | `config/master.key` (or `config/credentials/*.key`) present in repo → decrypts all `credentials.yml.enc` secrets. Must be gitignored (Rails does this by default; flag if removed). |
| `secret_key_base` missing/hardcoded | CRITICAL | Should come from credentials or `SECRET_KEY_BASE` env. Literal in `secrets.yml` = session/cookie forgery. |
| Assets not precompiled | MEDIUM (broken UI) | No `rails assets:precompile` (or `bin/rails assets:precompile`) in build; Sprockets/Propshaft/importmap present. |
| Migrations not run | HIGH (broken deploy) | No `rails db:migrate` in release step; pending migration files. |
| Secrets in plaintext YAML | CRITICAL | Literals in `config/database.yml`, `secrets.yml`, or committed `.env` instead of encrypted credentials / ENV. |
| Missing `force_ssl` | MEDIUM | `config.force_ssl = true` absent in `production.rb`. |
| Master key absent for deploy | HIGH (broken boot) | `credentials.yml.enc` present but no `RAILS_MASTER_KEY` env configured → app won't boot. |

---

## 4. PHP — Laravel

### Detection

| Signal | Meaning |
|---|---|
| `composer.json` with `laravel/framework` | Laravel |
| `artisan` file at root | Definitive |
| `.env` / `.env.example`, `config/`, `routes/`, `public/index.php` | Structure |

### Pre-deploy checklist + repo detection

| Risk | Severity | How to detect from repo |
|---|---|---|
| `APP_DEBUG=true` in prod | CRITICAL | `.env` line `APP_DEBUG=true`. Ignition error page leaks env vars, config, stack traces; history of RCE (CVE-2021-3129). Must be `false`. |
| **`.env` exposed via web** | CRITICAL | The classic Laravel leak: `.env` committed to repo AND/OR docroot misconfigured to project root instead of `public/`. Flag `.env` present in repo; warn that document root must point to `/public`, never project root. Massive real-world secret-leak source. |
| Missing / hardcoded `APP_KEY` | CRITICAL | `APP_KEY=` empty → encryption/sessions broken. `APP_KEY` committed with a real value → all encrypted data/cookies forgeable. |
| `APP_ENV=local` in prod | HIGH | Should be `production`. |
| Storage/bootstrap perms | MEDIUM (broken deploy) | `storage/` and `bootstrap/cache/` must be writable; note in checklist (not fully repo-detectable). |
| Config/route not cached | LOW (perf) | Recommend `php artisan config:cache route:cache view:cache` in build. Warn: caching requires no closures in routes and all config via `env()` only at cache time. |
| DB creds / API keys in `.env` committed | CRITICAL | Same secret scan; Laravel `.env` holds `DB_PASSWORD`, `MAIL_*`, `STRIPE_*`, `AWS_*`. |
| Debug/telescope route public | HIGH | `laravel/telescope`, `/telescope`, `/horizon` reachable without auth middleware. |

---

## 5. Go

### Detection

| Signal | Meaning |
|---|---|
| `go.mod`, `go.sum` | Go module |
| `main.go`, `package main`, `func main()` | Entrypoint |
| `Dockerfile` with `golang:` base | Build |

### Pre-deploy checklist + repo detection

| Risk | Severity | How to detect from repo |
|---|---|---|
| Not binding `0.0.0.0:$PORT` | HIGH (broken deploy) | `http.ListenAndServe(":8080", ...)` hardcoded vs reading `os.Getenv("PORT")`. Fixed/localhost bind fails on PaaS. |
| Hardcoded secrets | CRITICAL | String literals for API keys/DB DSNs/JWT signing keys instead of `os.Getenv`. Scan for high-entropy strings and DSN patterns. |
| CGO breaks static build | MEDIUM (broken deploy) | `import "C"`, or sqlite driver `mattn/go-sqlite3` in `go.mod` while Dockerfile uses `CGO_ENABLED=0` or scratch/alpine base → runtime "not found"/glibc errors. |
| TLS/`InsecureSkipVerify` | HIGH | `InsecureSkipVerify: true` in `tls.Config` disables cert validation. |
| No timeouts on `http.Server` | LOW | `http.Server{}` without `ReadTimeout`/`WriteTimeout` (DoS hardening). |
| Missing lockfile integrity | LOW | `go.sum` absent → non-reproducible build. |
| `pprof` exposed | MEDIUM | Blank import `_ "net/http/pprof"` on a public mux leaks profiling/debug endpoints. |

Go generally has fewer beginner footguns (compiled, no debug-page concept), so weight PORT-binding and hardcoded secrets highest.

---

## 6. Rust

### Detection

| Signal | Meaning |
|---|---|
| `Cargo.toml`, `Cargo.lock` | Rust crate |
| `src/main.rs` | Binary entrypoint |
| `actix-web`, `axum`, `rocket`, `warp` in `[dependencies]` | Web framework |

### Pre-deploy checklist + repo detection

| Risk | Severity | How to detect from repo |
|---|---|---|
| Not built in `--release` | HIGH (perf/broken cost) | Dockerfile/build runs `cargo run`/`cargo build` without `--release` → debug binary is dramatically slower and larger. |
| Not binding `0.0.0.0:$PORT` | HIGH (broken deploy) | Hardcoded `127.0.0.1:8080` / fixed port vs `std::env::var("PORT")`. |
| Hardcoded secrets | CRITICAL | Literals instead of `std::env::var` / `dotenvy`. Scan for keys/DSNs. |
| Env config missing | MEDIUM | `.env` used at dev only; ensure prod env vars set (framework config via `config`/`envy`). |
| `Cargo.lock` not committed | LOW | For binaries, lockfile should be committed for reproducibility. |
| Panics as error handling | LOW | Pervasive `.unwrap()`/`.expect()` on request paths → thread panic/500s (informational for beginners). |

Like Go, Rust has no debug-page footgun; PORT-bind and release-build are the deploy-breakers.

---

## 7. Java — Spring Boot

### Detection

| Signal | Meaning |
|---|---|
| `pom.xml` with `spring-boot-starter-*` | Maven Spring Boot |
| `build.gradle`/`build.gradle.kts` with `org.springframework.boot` | Gradle |
| `src/main/resources/application.properties` or `application.yml` | Config |
| `@SpringBootApplication` annotated class | Entrypoint |
| `application-<profile>.properties/yml` | Profiles |

### Pre-deploy checklist + repo detection

| Risk | Severity | How to detect from repo |
|---|---|---|
| Plaintext DB password/secrets in `application.properties` committed | CRITICAL | `spring.datasource.password=...`, `spring.mail.password=...`, API keys as literals instead of `${DB_PASSWORD}` placeholders. Extremely common beginner leak. |
| Actuator endpoints exposed | HIGH | `management.endpoints.web.exposure.include=*` (or includes `env`, `heapdump`, `threaddump`, `beans`, `mappings`) with no `spring-boot-starter-security`. `/actuator/env` leaks config incl. secrets; `/actuator/heapdump` dumps memory. **Note:** Spring Boot 2/3 default exposes only `/health` and `/info` — the risk is the explicit `include=*` override without securing it. |
| Stack traces to clients | MEDIUM | `server.error.include-stacktrace=always` / `include-message=always`. |
| Wrong/no active profile | HIGH | No `SPRING_PROFILES_ACTIVE=prod`; app boots with dev profile (H2 in-memory DB, verbose logging). |
| Not reading `$PORT` | MEDIUM/HIGH | `server.port` fixed vs `${PORT:8080}` on PaaS that inject PORT. |
| `ddl-auto=create`/`create-drop` in prod | HIGH (data loss) | `spring.jpa.hibernate.ddl-auto=create-drop` wipes schema on boot. Should be `validate`/`none` + Flyway/Liquibase. |
| H2 console enabled | HIGH | `spring.h2.console.enabled=true` reachable in prod = DB shell. |
| No dependency lock | LOW | Maven has no lockfile by default; Gradle `gradle.lockfile` optional. Reproducibility note. |

Sources: [Spring Boot Actuator endpoints](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html) (only health/info exposed by default; `*` override is the footgun); [Wiz: Actuator misconfigurations](https://www.wiz.io/blog/spring-boot-actuator-misconfigurations).

---

## 8. Brief — Elixir / Phoenix

### Detection
`mix.exs` with `:phoenix` dep; `config/`, `lib/<app>_web/`, `config/runtime.exs`, `assets/`.

### Key footguns
| Risk | Severity | Detection |
|---|---|---|
| Missing `SECRET_KEY_BASE` | CRITICAL (broken boot) | `config/runtime.exs` reads `System.get_env("SECRET_KEY_BASE")`; must be set in prod. |
| Secrets hardcoded in `config/prod.exs` | CRITICAL | Literals for `secret_key_base`, DB URL instead of `runtime.exs`/env. |
| `debug_errors: true` / dev config in prod | HIGH | Should only be in `config/dev.exs`. |
| Assets not built (`mix assets.deploy`) | MEDIUM | Missing from release/Dockerfile. |
| Migrations not run | HIGH | Release must call `Ecto.Migrator` / `mix ecto.migrate`. |
| `check_origin` disabled | MEDIUM | `check_origin: false` on the endpoint's socket config. |
| Not binding `0.0.0.0:$PORT` | HIGH | Endpoint `http: [ip: {0,0,0,0}, port: ...]` reading `PORT`. |

## 9. Brief — .NET (ASP.NET Core)

### Detection
`*.csproj`/`*.sln`, `Program.cs`, `appsettings.json` + `appsettings.Development.json`, `Microsoft.AspNetCore.*` package refs.

### Key footguns
| Risk | Severity | Detection |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT=Development` in prod | HIGH | Enables `DeveloperExceptionPage` → stack traces to clients; disables prod hardening. Must be `Production`. |
| Connection strings/secrets in `appsettings.json` committed | CRITICAL | `ConnectionStrings`, `ApiKey`, passwords as literals instead of env vars / user-secrets / Key Vault. `appsettings.json` IS committed by convention — high leak risk. |
| `UseDeveloperExceptionPage()` unconditionally | HIGH | Should be guarded by `env.IsDevelopment()`. |
| Not reading `$PORT` / `ASPNETCORE_URLS` | MEDIUM | Fixed `UseUrls` vs env-driven. |
| HTTPS redirection/HSTS missing | MEDIUM | No `UseHttpsRedirection()`/`UseHsts()`. |
| EF migrations not applied | HIGH | No `dotnet ef database update` / `MigrateAsync` in startup. |

---

## 10. Cross-Language Common Checklist (all non-JS)

Apply these regardless of stack; they are the universal deploy-breakers and leak vectors.

| # | Check | Severity | Generic detection heuristic |
|---|---|---|---|
| 1 | **Debug/dev mode OFF in prod** | CRITICAL | Any framework debug flag hardcoded on (see Section 0 table). Flagship check. |
| 2 | **Secrets in env, not code** | CRITICAL | High-entropy strings + known key prefixes in source: `sk-`, `sk_live_`, `AKIA` (AWS), `AIza` (Google), `ghp_`/`github_pat_`, `xoxb-` (Slack), `-----BEGIN … PRIVATE KEY-----`, `postgres://user:pass@`, JWT-looking literals. |
| 3 | **No secret files committed** | CRITICAL | `.env`, `*.pem`, `*.key`, `id_rsa`, `credentials.json`/service-account JSON, `master.key`, `*.pfx` present in tree and not in `.gitignore`. Also check `git log`/history if available. |
| 4 | **Server binds `0.0.0.0:$PORT`** | HIGH (broken deploy) | Hardcoded `127.0.0.1`/`localhost` or fixed port instead of reading the `PORT` env var. #1 cause of "deploy succeeds but returns nothing." |
| 5 | **Dependency lockfile committed** | HIGH (broken/irreproducible) | Present: `requirements.txt` pinned or `poetry.lock`/`uv.lock`/`Pipfile.lock`; `Gemfile.lock`; `composer.lock`; `go.sum`; `Cargo.lock`; `packages.lock.json`. Missing lock → different versions in prod than tested. |
| 6 | **DB migrations applied on release** | HIGH (broken deploy) | Migration files exist (`migrations/`, `db/migrate/`, `alembic/`, Flyway `V*.sql`) but no migrate step in `Procfile`/Dockerfile/CI release phase. |
| 7 | **HTTPS / secure cookies / HSTS** | MEDIUM | Framework SSL-redirect + secure/httponly cookie flags absent when in prod mode. |
| 8 | **No PII / plaintext credentials committed** | CRITICAL | Seed data, `.sql` dumps, CSVs, or fixtures containing emails/phones/SSNs/card numbers; plaintext passwords in config. |
| 9 | **Production web server, not dev server** | HIGH | Start command uses framework dev server (`runserver`, `flask run`/`app.run`, `rails server` default, `mix phx.server` w/o release, `cargo run`) instead of a production server (gunicorn/uvicorn, Puma, php-fpm/nginx, compiled release binary). |
| 10 | **Rate limiting / auth on paid-API routes** | HIGH (surprise cost) | Routes invoking metered SDKs (OpenAI, Anthropic, Stripe, Twilio, SendGrid, AWS, S3) with no auth and no limiter → runaway bills or abuse. |
| 11 | **CORS not wildcard-with-credentials** | HIGH | `*` origin combined with credentials/cookies. |
| 12 | **Debug/admin/introspection endpoints not public** | HIGH | `/actuator/*`, `/telescope`, `/horizon`, `/__debug__`, `/pprof`, Adminer/phpMyAdmin, H2 console, GraphQL introspection reachable without auth. |

---

## Notes on SafeShip Implementation Priorities (non-JS)

1. **Lead with the debug-mode check** — it's universal, high-severity, and easy to explain to a non-developer ("your site will show its passwords to strangers").
2. **Secret scanning is second** — combine filename rules (Section 10 #3) with entropy + known key-prefix regexes; report the file and line but never echo the full secret.
3. **PORT-binding** catches the most common "why is my deploy blank" support ticket.
4. **Cost footguns** (rate limiting on metered APIs) are underappreciated but map directly to the "surprise costs" goal — worth a dedicated detector that maps SDK imports → unprotected routes.
5. Framework-native linters exist and can be surfaced/emulated: Django `manage.py check --deploy`, Laravel `php artisan about`/config validation, Rails `bin/rails` boot checks. Recommending them adds credibility.

### Sources
- [Django deployment checklist](https://docs.djangoproject.com/en/5.0/howto/deployment/checklist/)
- [Django settings reference (DEBUG behavior)](https://docs.djangoproject.com/en/6.0/ref/settings/)
- [Spring Boot Actuator endpoints — default exposure](https://docs.spring.io/spring-boot/reference/actuator/endpoints.html)
- [Wiz — Spring Boot Actuator misconfigurations](https://www.wiz.io/blog/spring-boot-actuator-misconfigurations)
- [Acunetix — Spring Boot Actuator endpoints web exposed](https://www.acunetix.com/vulnerabilities/web/spring-boot-misconfiguration-all-spring-boot-actuator-endpoints-are-web-exposed/)
