/**
 * 배포 프리플라이트 룰 — research-deploy-platforms.md §13 공통 체크 +
 * research-nonjs-environments.md 언어별 어댑터 (M2).
 * 플랫폼/언어 추가 = 데이터 테이블에 항목 추가.
 */
import type { Finding, Rule, ScanContext } from '../types.js';
import { clientEnvLeakPrompt, debugModePrompt, portBindPrompt, prodServerPrompt } from '../fixPrompts.js';

/** 클라이언트 번들에 인라인되는 접두사 (research-cost-guard.md §14) */
const CLIENT_PREFIXES = ['NEXT_PUBLIC_', 'VITE_', 'REACT_APP_', 'EXPO_PUBLIC_', 'GATSBY_', 'VUE_APP_', 'PUBLIC_'];
/** 변수 이름에 이게 들어가면 시크릿으로 간주 */
const SECRETY_NAME = /(KEY|SECRET|TOKEN|PASSWORD|PRIVATE|SERVICE_ROLE)/i;
/** 공개여도 되는 예외 (예: NEXT_PUBLIC_SUPABASE_ANON_KEY) */
const PUBLIC_OK = /(ANON_KEY|PUBLISHABLE|SITE_KEY|PUBLIC_KEY$)/i;

/** 언어별 락파일 (research-nonjs §10 #5) */
const LOCKFILES_BY_LANG: Record<string, string[]> = {
  js: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'],
  python: ['poetry.lock', 'uv.lock', 'Pipfile.lock'],
  ruby: ['Gemfile.lock'],
  php: ['composer.lock'],
  go: ['go.sum'],
  rust: ['Cargo.lock'],
};

/** 시작 명령이 적힐 수 있는 파일들 (dev 서버·마이그레이션 체크용) */
const START_CMD_FILES = ['Procfile', 'Dockerfile', 'docker-compose.yml', 'render.yaml', 'railway.json', 'railway.toml', 'fly.toml', 'heroku.yml', 'nixpacks.toml'];

function startCmdTexts(ctx: ScanContext): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  for (const f of START_CMD_FILES) {
    if (!ctx.exists(f)) continue;
    const text = ctx.read(f);
    if (text) out.push({ file: f, text });
  }
  return out;
}

/** TOML 텍스트에서 특정 섹션([vars] 등)의 줄들만 (줄번호 포함) */
function tomlSection(text: string, header: string): Array<{ line: number; content: string }> {
  const lines = text.split(/\r?\n/);
  const out: Array<{ line: number; content: string }> = [];
  let inside = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^\[/.test(t)) inside = t === `[${header}]`;
    else if (inside && t && !t.startsWith('#')) out.push({ line: i + 1, content: t });
  }
  return out;
}

/** 파일 텍스트에서 정규식이 처음 걸리는 줄 번호 (1-base, 없으면 0) */
function findLine(text: string, re: RegExp): number {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return i + 1;
  return 0;
}

export const deployRules: Rule[] = [
  {
    id: 'deploy.stack-detected',
    pillar: 'deploy',
    run(ctx) {
      const { framework, language, deployTargets } = ctx.stack;
      const fwLabel = framework ?? (language === 'unknown' ? '미확인' : language);
      return [{
        id: 'deploy.stack-detected',
        pillar: 'deploy',
        severity: 'info',
        title: `스택 감지: ${fwLabel}${deployTargets.length ? ' → ' + deployTargets.join(', ') : ''}`,
        detail: deployTargets.length
          ? '감지된 스택에 맞는 체크리스트를 적용했어요.'
          : '배포 타깃 설정파일이 아직 없어요. 배포처를 정하면 그에 맞는 점검을 추가해요.',
      }];
    },
  },

  // ── 디버그 모드 (비-JS 플래그십 체크, research-nonjs §0) ──
  {
    id: 'deploy.debug-mode',
    pillar: 'deploy',
    applies: (ctx) => ['django', 'flask', 'fastapi', 'laravel', 'rails'].includes(ctx.stack.framework ?? ''),
    run(ctx) {
      const fw = ctx.stack.framework!;
      const findings: Finding[] = [];
      const hit = (file: string, line: number, what: string, danger: string) => {
        findings.push({
          id: 'deploy.debug-mode',
          pillar: 'deploy',
          severity: 'block',
          title: `${what} — 디버그 모드가 켜진 채 배포돼요`,
          detail: `${file}:${line} — ${danger}`,
          file, line,
          effort: '약 3분',
          fixPrompt: debugModePrompt(fw, file),
        });
      };

      if (fw === 'django' || fw === 'flask' || fw === 'fastapi') {
        for (const rel of ctx.files.filter((x) => x.endsWith('.py'))) {
          const text = ctx.read(rel);
          if (!text) continue;
          if (fw === 'django') {
            const ln = findLine(text, /^\s*DEBUG\s*=\s*True\b/);
            if (ln) hit(rel, ln, 'Django DEBUG=True', '에러 화면이 SECRET_KEY·DB 비밀번호를 포함한 설정 전체를 방문자에게 보여줘요. 환경변수로 읽고 기본값은 꺼짐으로.');
          }
          if (fw === 'flask') {
            const runLn = findLine(text, /\.run\([^)]*debug\s*=\s*True/);
            if (runLn) hit(rel, runLn, 'Flask debug=True', 'Werkzeug 인터랙티브 디버거가 열려요 — 브라우저에서 서버 코드를 실행당할 수 있어요(RCE).');
          }
          if (fw === 'fastapi') {
            const fastLn = findLine(text, /FastAPI\s*\(\s*[^)]*debug\s*=\s*True/);
            if (fastLn) hit(rel, fastLn, 'FastAPI debug=True', '에러 스택트레이스가 방문자에게 그대로 노출돼요.');
          }
        }
        // FLASK_DEBUG=1 (.env / Procfile) — 예시 파일(.env.example 등)은 문서라 제외
        if (fw === 'flask') {
          for (const rel of ctx.files.filter((x) => (/(^|\/)\.env[^/]*$/.test(x) && !/example|sample|template/.test(x)) || x === 'Procfile')) {
            const text = ctx.read(rel);
            if (!text) continue;
            const ln = findLine(text, /^FLASK_DEBUG\s*=\s*(1|true)/i);
            if (ln) hit(rel, ln, 'FLASK_DEBUG=1', '디버그 모드로 배포되면 인터랙티브 디버거(RCE 위험)가 노출돼요.');
          }
        }
      }
      if (fw === 'laravel') {
        for (const rel of ctx.files.filter((x) => /(^|\/)\.env[^/]*$/.test(x) && !/example|sample/.test(x))) {
          const text = ctx.read(rel);
          if (!text) continue;
          const ln = findLine(text, /^APP_DEBUG\s*=\s*true/i);
          if (ln) hit(rel, ln, 'Laravel APP_DEBUG=true', 'Ignition 에러 페이지가 환경변수·설정을 노출해요(과거 RCE 이력, CVE-2021-3129). 프로덕션은 반드시 false.');
        }
      }
      if (fw === 'rails') {
        const prod = 'config/environments/production.rb';
        const text = ctx.exists(prod) ? ctx.read(prod) : null;
        if (text) {
          const ln = findLine(text, /consider_all_requests_local\s*=\s*true/);
          if (ln) hit(prod, ln, 'Rails 전체 요청 로컬 취급', '프로덕션에서 상세 에러 페이지가 노출돼요.');
        }
      }

      if (findings.length === 0) {
        findings.push({
          id: 'deploy.debug-mode',
          pillar: 'deploy',
          severity: 'pass',
          title: '디버그 모드가 켜진 흔적이 없어요',
          detail: `${fw} 디버그 플래그가 하드코딩된 곳이 발견되지 않았어요.`,
        });
      }
      return findings;
    },
  },

  // ── 프로덕션 서버 (dev 서버로 배포 방지, research-nonjs §1-2) ──
  {
    id: 'deploy.prod-server',
    pillar: 'deploy',
    applies: (ctx) => ctx.stack.language === 'python' && ['django', 'flask', 'fastapi'].includes(ctx.stack.framework ?? ''),
    run(ctx) {
      const fw = ctx.stack.framework!;
      const findings: Finding[] = [];
      // 항상 dev 서버인 패턴 / `python x.py`는 서비스 시작 줄(web:/CMD/startCommand)에서만,
      // 마이그레이션·빌드 스크립트 줄(release: 등)은 제외
      const ALWAYS_DEV = /(manage\.py\s+runserver|flask\s+run|uvicorn[^\n]*--reload)/;
      const START_LINE = /^(web:|CMD\b|ENTRYPOINT\b)|startCommand:/;
      const PY_SCRIPT = /python3?\s+[\w./-]+\.py\b/;
      const NOT_DEV = /(migrate|collectstatic|seed|build)/;
      const findDevLine = (text: string): number => {
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const l = lines[i];
          if (NOT_DEV.test(l)) continue;
          if (ALWAYS_DEV.test(l)) return i + 1;
          if (START_LINE.test(l.trim()) && PY_SCRIPT.test(l)) return i + 1;
        }
        return 0;
      };
      for (const { file, text } of startCmdTexts(ctx)) {
        const ln = findDevLine(text);
        if (ln) {
          findings.push({
            id: 'deploy.prod-server',
            pillar: 'deploy',
            severity: 'warn',
            title: '개발용 서버로 배포되도록 설정돼 있어요',
            detail: `${file}:${ln} — 개발 서버(runserver/app.run 류)는 단일 스레드에 보안 하드닝이 없어요. gunicorn/uvicorn 같은 프로덕션 서버로 바꾸세요.`,
            file, line: ln,
            effort: '약 5분',
            fixPrompt: prodServerPrompt(fw),
          });
          break;
        }
      }
      const PROD_SERVERS = ['gunicorn', 'uvicorn', 'waitress', 'hypercorn', 'daphne'];
      const hasProd = PROD_SERVERS.some((d) => ctx.deps.has(d));
      if (!hasProd && ctx.stack.deployTargets.length > 0) {
        findings.push({
          id: 'deploy.prod-server',
          pillar: 'deploy',
          severity: 'warn',
          title: '프로덕션 WSGI/ASGI 서버가 의존성에 없어요',
          detail: `gunicorn·uvicorn 등이 requirements에 없어요. 개발 서버로는 실서비스 트래픽을 감당할 수 없어요.`,
          effort: '약 5분',
          fixPrompt: prodServerPrompt(fw),
        });
      }
      if (findings.length === 0) {
        findings.push({
          id: 'deploy.prod-server',
          pillar: 'deploy',
          severity: 'pass',
          title: '프로덕션 서버 구성이 확인됐어요',
          detail: `${PROD_SERVERS.find((d) => ctx.deps.has(d)) ?? '프로덕션 서버'} 감지 — 개발 서버 배포 흔적이 없어요.`,
        });
      }
      return findings;
    },
  },

  // ── 0.0.0.0:$PORT 바인딩 ("배포는 됐는데 화면이 안 뜸" 1위 원인) ──
  {
    id: 'deploy.port-binding',
    pillar: 'deploy',
    applies: (ctx) =>
      ['python', 'go'].includes(ctx.stack.language) &&
      ctx.stack.deployTargets.some((t) => ['render', 'railway', 'fly', 'heroku', 'docker'].includes(t)),
    run(ctx) {
      const findings: Finding[] = [];
      if (ctx.stack.language === 'python') {
        for (const rel of ctx.files.filter((x) => x.endsWith('.py'))) {
          const text = ctx.read(rel);
          if (!text) continue;
          // Flask/FastAPI 앱 객체의 .run()만 — subprocess.run() 등 오탐 방지
          if (!/from\s+flask\s+import|import\s+flask/i.test(text)) continue;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (/\b(app|application)\.run\(/.test(l) && !/host\s*=/.test(l) && !/["']0\.0\.0\.0["']/.test(l)) {
              findings.push({
                id: 'deploy.port-binding',
                pillar: 'deploy',
                severity: 'warn',
                title: '서버가 외부 트래픽을 못 받는 바인딩이에요',
                detail: `${rel}:${i + 1} — host를 지정하지 않으면 127.0.0.1에만 열려요. 배포 플랫폼에선 0.0.0.0 + PORT 환경변수로 바인딩해야 해요.`,
                file: rel, line: i + 1,
                effort: '약 2분',
                fixPrompt: portBindPrompt(ctx.stack.framework ?? 'python'),
              });
            }
          }
        }
      }
      if (ctx.stack.language === 'go') {
        for (const rel of ctx.files.filter((x) => x.endsWith('.go'))) {
          const text = ctx.read(rel);
          if (!text) continue;
          const ln = findLine(text, /ListenAndServe\(\s*"(:\d+|127\.0\.0\.1[^"]*)"/);
          if (ln) {
            findings.push({
              id: 'deploy.port-binding',
              pillar: 'deploy',
              severity: 'warn',
              title: '포트가 하드코딩돼 있어요',
              detail: `${rel}:${ln} — 배포 플랫폼은 PORT 환경변수로 포트를 주입해요. os.Getenv("PORT")를 읽게 바꾸세요.`,
              file: rel, line: ln,
              effort: '약 2분',
              fixPrompt: portBindPrompt('go'),
            });
          }
        }
      }
      if (findings.length === 0) {
        findings.push({
          id: 'deploy.port-binding',
          pillar: 'deploy',
          severity: 'pass',
          title: '포트 바인딩이 플랫폼 호환으로 보여요',
          detail: '하드코딩된 localhost/포트 바인딩이 발견되지 않았어요.',
        });
      }
      return findings;
    },
  },

  // ── 프레임워크 시크릿 키 하드코딩 (research-nonjs §1-3) ──
  {
    id: 'deploy.hardcoded-secret-key',
    pillar: 'deploy',
    applies: (ctx) => ['python', 'ruby'].includes(ctx.stack.language),
    run(ctx) {
      const findings: Finding[] = [];
      if (ctx.stack.language === 'python') {
        for (const rel of ctx.files.filter((x) => x.endsWith('.py'))) {
          const text = ctx.read(rel);
          if (!text) continue;
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            if (/(^\s*SECRET_KEY\s*=|\.secret_key\s*=)\s*['"][^'"]{8,}['"]/.test(l) && !/environ|getenv|config\(/.test(l)) {
              findings.push({
                id: 'deploy.hardcoded-secret-key',
                pillar: 'deploy',
                severity: 'block',
                title: 'SECRET_KEY가 코드에 하드코딩돼 있어요',
                detail: `${rel}:${i + 1} — 이 키가 노출되면 세션·비밀번호 재설정 토큰을 위조할 수 있어요. 환경변수로 옮기고 재발급하세요.`,
                file: rel, line: i + 1,
                effort: '약 3분',
              });
            }
          }
        }
      }
      if (ctx.stack.language === 'ruby') {
        const mk = 'config/master.key';
        if (ctx.exists(mk) && ctx.isIgnored(mk) === false) {
          findings.push({
            id: 'deploy.hardcoded-secret-key',
            pillar: 'deploy',
            severity: 'block',
            title: 'Rails master.key가 커밋될 수 있는 상태예요',
            detail: `${mk} — 이 파일 하나로 credentials.yml.enc의 모든 시크릿이 풀려요. .gitignore에 추가하고, 이미 푸시됐다면 키를 재생성하세요.`,
            file: mk,
            effort: '약 5분',
          });
        }
      }
      if (findings.length === 0) {
        findings.push({
          id: 'deploy.hardcoded-secret-key',
          pillar: 'deploy',
          severity: 'pass',
          title: '프레임워크 시크릿 키 하드코딩이 없어요',
          detail: 'SECRET_KEY/master.key가 안전하게 관리되고 있는 것으로 보여요.',
        });
      }
      return findings;
    },
  },

  // ── CORS 와일드카드 + 자격증명 (research-nonjs §10 #11) ──
  {
    id: 'deploy.cors-wildcard',
    pillar: 'deploy',
    applies: (ctx) => ctx.stack.language === 'python',
    run(ctx) {
      const findings: Finding[] = [];
      for (const rel of ctx.files.filter((x) => x.endsWith('.py'))) {
        const text = ctx.read(rel);
        if (!text) continue;
        if (/allow_origins\s*=\s*\[\s*['"]\*['"]/.test(text) && /allow_credentials\s*=\s*True/.test(text)) {
          const ln = findLine(text, /allow_origins\s*=\s*\[\s*['"]\*['"]/);
          findings.push({
            id: 'deploy.cors-wildcard',
            pillar: 'deploy',
            severity: 'warn',
            title: 'CORS가 모든 출처 + 자격증명 허용이에요',
            detail: `${rel}:${ln} — allow_origins=["*"]와 allow_credentials=True 조합은 브라우저 규격 위반이자 보안 구멍이에요. 실제 도메인 목록으로 좁히세요.`,
            file: rel, line: ln,
            effort: '약 2분',
          });
        }
      }
      return findings;
    },
  },

  // ── 마이그레이션 실행 단계 (research-nonjs §10 #6) ──
  {
    id: 'deploy.migrations-step',
    pillar: 'deploy',
    applies: (ctx) => {
      const hasMigrations =
        ctx.files.some((f) => /(^|\/)migrations\/[^/]+\.(py|sql)$/.test(f)) ||
        ctx.exists('alembic.ini') ||
        ctx.files.some((f) => f.startsWith('db/migrate/')) ||
        ctx.files.some((f) => f.startsWith('database/migrations/'));
      return hasMigrations && ctx.stack.deployTargets.length > 0;
    },
    run(ctx) {
      const all = startCmdTexts(ctx).map((t) => t.text).join('\n');
      const hasStep = /(migrate|alembic\s+upgrade|db:migrate)/.test(all);
      return [{
        id: 'deploy.migrations-step',
        pillar: 'deploy',
        severity: hasStep ? 'pass' : 'warn',
        title: hasStep ? '배포 시 마이그레이션 단계가 있어요' : '마이그레이션 파일은 있는데 배포 때 실행하는 단계가 안 보여요',
        detail: hasStep
          ? '릴리스 과정에서 DB 스키마가 코드와 함께 갱신돼요.'
          : 'DB 스키마가 코드와 어긋나면 배포 직후 500 에러가 나요. 릴리스 단계(Procfile release:, render preDeploy 등)에 migrate를 넣거나, 플랫폼 대시보드에서 실행하고 있다면 체크해주세요.',
        clearable: hasStep ? undefined : true,
        effort: hasStep ? undefined : '약 5분',
      }];
    },
  },

  // ── 플랫폼 설정파일 안의 시크릿 (wrangler [vars] / fly [env] 등) ──
  {
    id: 'deploy.platform-config-secrets',
    pillar: 'deploy',
    applies: (ctx) => ['wrangler.toml', 'fly.toml', 'netlify.toml', 'render.yaml', '.dev.vars'].some((f) => ctx.exists(f)),
    run(ctx) {
      const findings: Finding[] = [];
      const checkToml = (file: string, section: string, advice: string) => {
        const text = ctx.exists(file) ? ctx.read(file) : null;
        if (!text) return;
        for (const { line, content } of tomlSection(text, section)) {
          const m = content.match(/^([A-Za-z0-9_]+)\s*=/);
          if (m && SECRETY_NAME.test(m[1]) && !PUBLIC_OK.test(m[1])) {
            findings.push({
              id: 'deploy.platform-config-secrets',
              pillar: 'deploy',
              severity: 'block',
              title: `${file}의 [${section}]에 시크릿이 들어 있어요`,
              detail: `${file}:${line} — ${m[1]}. 이 파일은 git에 커밋되는 평문이에요. ${advice}`,
              file, line,
              effort: '약 3분',
            });
          }
        }
      };
      checkToml('wrangler.toml', 'vars', '시크릿은 `wrangler secret put 이름`으로 넣으세요.');
      checkToml('fly.toml', 'env', '시크릿은 `fly secrets set 이름=값`으로 넣으세요.');
      checkToml('netlify.toml', 'build.environment', '시크릿은 Netlify 대시보드 환경변수로 넣으세요.');

      const render = ctx.exists('render.yaml') ? ctx.read('render.yaml') : null;
      if (render) {
        for (const m of render.matchAll(/key:\s*([A-Za-z0-9_]+)[^\n]*\n\s*value:\s*\S/g)) {
          if (SECRETY_NAME.test(m[1]) && !PUBLIC_OK.test(m[1])) {
            const ln = render.slice(0, m.index).split('\n').length;
            findings.push({
              id: 'deploy.platform-config-secrets',
              pillar: 'deploy',
              severity: 'block',
              title: 'render.yaml에 시크릿 값이 평문으로 있어요',
              detail: `render.yaml:${ln} — ${m[1]}. sync: false로 두고 값은 Render 대시보드에서 넣으세요.`,
              file: 'render.yaml', line: ln,
              effort: '약 3분',
            });
          }
        }
      }

      if (ctx.exists('.dev.vars') && ctx.isIgnored('.dev.vars') === false) {
        findings.push({
          id: 'deploy.platform-config-secrets',
          pillar: 'deploy',
          severity: 'block',
          title: '.dev.vars(로컬 Workers 시크릿)가 커밋될 수 있어요',
          detail: '.dev.vars — .gitignore에 추가하세요. Cloudflare 로컬 시크릿 파일이에요.',
          file: '.dev.vars',
          effort: '약 30초',
        });
      }

      if (findings.length === 0) {
        findings.push({
          id: 'deploy.platform-config-secrets',
          pillar: 'deploy',
          severity: 'pass',
          title: '플랫폼 설정파일에 평문 시크릿이 없어요',
          detail: 'wrangler/fly/netlify/render 설정에서 시크릿으로 보이는 값이 발견되지 않았어요.',
        });
      }
      return findings;
    },
  },

  // ── 플랫폼 상태 디렉터리 gitignore (research §13 #14) ──
  {
    id: 'deploy.platform-state-ignored',
    pillar: 'deploy',
    applies: (ctx) => ctx.git.isRepo,
    run(ctx) {
      const STATE_DIRS = ['.vercel', '.netlify', '.firebase', '.amplify', '.wrangler'];
      const leaked = STATE_DIRS.filter((d) => ctx.exists(d) && ctx.isIgnored(d) === false);
      if (leaked.length === 0) return [];
      return [{
        id: 'deploy.platform-state-ignored',
        pillar: 'deploy',
        severity: 'warn',
        title: '플랫폼 상태 폴더가 .gitignore에 없어요',
        detail: `${leaked.join(', ')} — 프로젝트/조직 ID 같은 내부 정보가 레포에 실려요. .gitignore에 추가하세요.`,
        effort: '약 30초',
      }];
    },
  },

  // ── 클라이언트 노출 변수 (JS) ──
  {
    id: 'deploy.client-env-leak',
    pillar: 'deploy',
    applies: (ctx) => ctx.stack.language === 'js',
    run(ctx) {
      const findings: Finding[] = [];
      const envFiles = ctx.files.filter((f) => {
        const b = f.split('/').pop()!;
        return b === '.env' || (b.startsWith('.env.') && !/example|sample|template/.test(b));
      });
      for (const rel of envFiles) {
        const text = ctx.read(rel);
        if (!text) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/^([A-Z0-9_]+)\s*=/);
          if (!m) continue;
          const name = m[1];
          const prefix = CLIENT_PREFIXES.find((p) => name.startsWith(p));
          if (!prefix) continue;
          if (!SECRETY_NAME.test(name) || PUBLIC_OK.test(name)) continue;
          findings.push({
            id: 'deploy.client-env-leak',
            pillar: 'deploy',
            severity: 'block',
            title: '서버용 키가 브라우저에 노출될 이름이에요',
            detail: `${rel}:${i + 1} — ${name}. ${prefix} 접두사가 붙으면 방문자 누구나 값을 볼 수 있어요.`,
            file: rel,
            line: i + 1,
            effort: '약 2분',
            fixPrompt: clientEnvLeakPrompt(name, prefix),
          });
        }
      }
      if (findings.length === 0) {
        findings.push({
          id: 'deploy.client-env-leak',
          pillar: 'deploy',
          severity: 'pass',
          title: '클라이언트 노출 변수에 시크릿이 없어요',
          detail: 'NEXT_PUBLIC_/VITE_ 등 공개 접두사 변수에서 키/시크릿 이름이 발견되지 않았어요.',
        });
      }
      return findings;
    },
  },

  // ── 락파일 (전 언어, research-nonjs §10 #5) ──
  {
    id: 'deploy.lockfile',
    pillar: 'deploy',
    applies: (ctx) => Object.keys(LOCKFILES_BY_LANG).includes(ctx.stack.language),
    run(ctx) {
      const lang = ctx.stack.language;
      const candidates = LOCKFILES_BY_LANG[lang];
      const found = candidates.find((f) => ctx.exists(f));

      // 파이썬은 requirements.txt 전체 버전 고정도 인정
      if (!found && lang === 'python' && ctx.exists('requirements.txt')) {
        const req = ctx.read('requirements.txt') ?? '';
        const specs = req.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('-'));
        const pinned = specs.length > 0 && specs.every((l) => /==/.test(l));
        return [{
          id: 'deploy.lockfile',
          pillar: 'deploy',
          severity: pinned ? 'pass' : 'warn',
          title: pinned ? 'requirements.txt가 버전 고정돼 있어요' : '의존성 버전이 고정돼 있지 않아요',
          detail: pinned
            ? '배포 서버가 내 컴퓨터와 같은 버전을 설치해요.'
            : 'requirements.txt에 == 버전 고정이 없으면 배포 서버가 다른 버전을 설치해 "내 컴퓨터에선 됐는데" 문제가 생겨요. pip freeze > requirements.txt 또는 uv/poetry lock을 쓰세요.',
          effort: pinned ? undefined : '약 1분',
        }];
      }

      return [{
        id: 'deploy.lockfile',
        pillar: 'deploy',
        severity: found ? 'pass' : 'warn',
        title: found ? `락파일(${found})이 있어요` : '락파일이 없어요',
        detail: found
          ? '내 컴퓨터와 배포 서버가 같은 버전의 패키지를 쓰게 보장돼요.'
          : `배포 서버가 다른 버전을 설치해 "내 컴퓨터에선 됐는데" 문제가 생길 수 있어요. ${candidates[0]}을 커밋하세요.`,
        effort: found ? undefined : '약 1분',
      }];
    },
  },

  // ── Django ALLOWED_HOSTS 와일드카드 (research-nonjs §1) ──
  {
    id: 'deploy.allowed-hosts-wildcard',
    pillar: 'deploy',
    applies: (ctx) => ctx.stack.framework === 'django',
    run(ctx) {
      for (const rel of ctx.files.filter((x) => x.endsWith('.py'))) {
        const text = ctx.read(rel);
        if (!text) continue;
        const ln = findLine(text, /ALLOWED_HOSTS\s*=\s*\[[^\]]*['"]\*['"]/);
        if (ln) {
          return [{
            id: 'deploy.allowed-hosts-wildcard',
            pillar: 'deploy',
            severity: 'warn',
            title: "ALLOWED_HOSTS = ['*'] — 호스트 검증이 꺼져 있어요",
            detail: `${rel}:${ln} — 아무 도메인으로 위장한 요청을 다 받아요(캐시 오염·CSRF 노출). 실제 배포 도메인 목록으로 좁히세요.`,
            file: rel, line: ln,
            effort: '약 2분',
          }];
        }
      }
      return [];
    },
  },

  // ── Docker: .dockerignore에 .env 누락 → 이미지 안에 시크릿 봉인 ──
  {
    id: 'deploy.dockerignore',
    pillar: 'deploy',
    applies: (ctx) => ctx.exists('Dockerfile'),
    run(ctx) {
      const di = ctx.exists('.dockerignore') ? (ctx.read('.dockerignore') ?? '') : null;
      const hasEnv = di !== null && /(^|\n)\s*\**\.?env/.test(di);
      const ok = di !== null && hasEnv;
      return [{
        id: 'deploy.dockerignore',
        pillar: 'deploy',
        severity: ok ? 'pass' : 'warn',
        title: ok
          ? '.dockerignore가 .env를 제외하고 있어요'
          : di === null ? '.dockerignore가 없어요' : '.dockerignore에 .env가 없어요',
        detail: ok
          ? '이미지에 시크릿 파일이 들어가지 않아요.'
          : 'Dockerfile COPY . . 가 .env를 이미지에 그대로 구워 넣어요 — 이미지를 받는 누구나 키를 꺼낼 수 있어요. .dockerignore에 .env와 node_modules를 추가하세요.',
        effort: ok ? undefined : '약 1분',
      }];
    },
  },

  // ── docker-compose environment 평문 시크릿 ──
  {
    id: 'deploy.compose-secrets',
    pillar: 'deploy',
    applies: (ctx) => ctx.exists('docker-compose.yml') || ctx.exists('docker-compose.yaml') || ctx.exists('compose.yml') || ctx.exists('compose.yaml'),
    run(ctx) {
      const findings: Finding[] = [];
      for (const f of ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml']) {
        const text = ctx.exists(f) ? ctx.read(f) : null;
        if (!text) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          // `- NAME=값` 또는 `NAME: 값` 꼴에서 시크릿 이름 + 리터럴 값 (${...} 참조는 제외)
          const m = lines[i].match(/^\s*-?\s*([A-Z0-9_]+)\s*[=:]\s*(?!\s*\$\{)["']?\S+/);
          if (m && SECRETY_NAME.test(m[1]) && !PUBLIC_OK.test(m[1])) {
            findings.push({
              id: 'deploy.compose-secrets',
              pillar: 'deploy',
              severity: 'warn',
              title: 'docker-compose에 시크릿이 평문으로 있어요',
              detail: `${f}:${i + 1} — ${m[1]}. compose 파일은 커밋되는 파일이에요. \${변수} 참조로 바꾸고 값은 .env(gitignore됨)에 두세요.`,
              file: f, line: i + 1,
              effort: '약 3분',
            });
          }
        }
      }
      return findings;
    },
  },

  // ── Firebase Security Rules 전체 공개 (research-deploy §9 "classic disaster") ──
  {
    id: 'deploy.firebase-open-rules',
    pillar: 'deploy',
    applies: (ctx) => ctx.files.some((f) => f.endsWith('.rules') || f === 'database.rules.json'),
    run(ctx) {
      const findings: Finding[] = [];
      for (const rel of ctx.files.filter((f) => f.endsWith('.rules'))) {
        const text = ctx.read(rel);
        if (!text) continue;
        const ln = findLine(text, /allow\s+(read\s*,\s*write|write\s*,\s*read|read|write)\s*:\s*if\s+true/);
        if (ln) {
          findings.push({
            id: 'deploy.firebase-open-rules',
            pillar: 'deploy',
            severity: 'block',
            title: 'Firebase 보안 규칙이 전체 공개예요',
            detail: `${rel}:${ln} — allow ... if true는 인터넷의 누구나 내 DB를 읽고 쓸 수 있다는 뜻이에요. 데이터 유출 + 요금 폭주의 고전 사고예요. 인증 기반 규칙으로 바꾸세요.`,
            file: rel, line: ln,
            effort: '약 15분',
          });
        }
      }
      const rtdb = ctx.exists('database.rules.json') ? ctx.read('database.rules.json') : null;
      if (rtdb) {
        const ln = findLine(rtdb, /"\.(read|write)"\s*:\s*true/);
        if (ln) {
          findings.push({
            id: 'deploy.firebase-open-rules',
            pillar: 'deploy',
            severity: 'block',
            title: 'Firebase RTDB 규칙이 전체 공개예요',
            detail: `database.rules.json:${ln} — ".read"/".write": true는 누구나 접근 가능하다는 뜻이에요.`,
            file: 'database.rules.json', line: ln,
            effort: '약 15분',
          });
        }
      }
      if (findings.length === 0) {
        findings.push({
          id: 'deploy.firebase-open-rules',
          pillar: 'deploy',
          severity: 'pass',
          title: 'Firebase 보안 규칙에 전체 공개 구문이 없어요',
          detail: 'allow ... if true 패턴이 발견되지 않았어요.',
        });
      }
      return findings;
    },
  },

  // ── Supabase RLS 흔적 (마이그레이션에 enable row level security가 전혀 없으면 경고) ──
  {
    id: 'deploy.supabase-rls',
    pillar: 'deploy',
    applies: (ctx) => ctx.files.some((f) => /^supabase\/migrations\/.+\.sql$/.test(f)),
    run(ctx) {
      const sqls = ctx.files.filter((f) => /^supabase\/migrations\/.+\.sql$/.test(f));
      const all = sqls.map((f) => ctx.read(f) ?? '').join('\n').toLowerCase();
      const createsTable = /create\s+table/.test(all);
      const hasRls = /row\s+level\s+security/.test(all);
      if (!createsTable) return [];
      return [{
        id: 'deploy.supabase-rls',
        pillar: 'deploy',
        severity: hasRls ? 'pass' : 'warn',
        title: hasRls ? '마이그레이션에 RLS 활성화가 있어요' : '테이블은 만드는데 RLS(행 수준 보안) 활성화가 안 보여요',
        detail: hasRls
          ? 'Row Level Security가 켜져 있으면 anon 키로는 정책에 맞는 데이터만 접근돼요.'
          : 'RLS가 꺼진 테이블은 공개 anon 키만으로 전체 읽기/쓰기가 가능해요. 각 테이블에 alter table ... enable row level security + 정책을 추가하세요. (대시보드에서 이미 켰다면 체크해주세요.)',
        clearable: hasRls ? undefined : true,
        effort: hasRls ? undefined : '약 15분',
      }];
    },
  },

  // ── Laravel APP_KEY 비어 있음 (암호화·세션 깨짐) ──
  {
    id: 'deploy.laravel-app-key',
    pillar: 'deploy',
    applies: (ctx) => ctx.stack.framework === 'laravel',
    run(ctx) {
      for (const rel of ctx.files.filter((x) => /(^|\/)\.env$/.test(x))) {
        const text = ctx.read(rel);
        if (!text) continue;
        const ln = findLine(text, /^APP_KEY\s*=\s*$/);
        if (ln) {
          return [{
            id: 'deploy.laravel-app-key',
            pillar: 'deploy',
            severity: 'warn',
            title: 'APP_KEY가 비어 있어요',
            detail: `${rel}:${ln} — 암호화·세션이 동작하지 않아요. php artisan key:generate로 생성하세요 (배포 서버에는 환경변수로).`,
            file: rel, line: ln,
            effort: '약 1분',
          }];
        }
      }
      return [];
    },
  },

  // ── Rails master.key 부재 (credentials 못 열어 부팅 실패) ──
  {
    id: 'deploy.rails-master-key',
    pillar: 'deploy',
    applies: (ctx) => ctx.stack.language === 'ruby' && ctx.exists('config/credentials.yml.enc'),
    run(ctx) {
      const hasKey = ctx.exists('config/master.key');
      return [{
        id: 'deploy.rails-master-key',
        pillar: 'deploy',
        severity: hasKey ? 'pass' : 'warn',
        title: hasKey ? 'credentials 복호화 키가 로컬에 있어요' : 'credentials.yml.enc는 있는데 master.key가 없어요',
        detail: hasKey
          ? 'master.key는 .gitignore에 있는지 별도 룰이 확인해요.'
          : '배포 서버에 RAILS_MASTER_KEY 환경변수를 설정하지 않으면 앱이 부팅에 실패해요. (플랫폼에 설정했다면 체크해주세요.)',
        clearable: hasKey ? undefined : true,
      }];
    },
  },

  // ── SPA 딥링크 fallback (research-deploy §12 — 3대 실패 클래스) ──
  {
    id: 'deploy.spa-fallback',
    pillar: 'deploy',
    applies: (ctx) =>
      ['vite-react', 'vite', 'cra'].includes(ctx.stack.framework ?? '') &&
      ctx.stack.deployTargets.some((t) => ['netlify', 'vercel', 'firebase', 'gh-pages'].includes(t)),
    run(ctx) {
      const findings: Finding[] = [];
      const t = ctx.stack.deployTargets;
      const warn = (target: string, how: string) => findings.push({
        id: 'deploy.spa-fallback',
        pillar: 'deploy',
        severity: 'warn',
        title: `${target}에 SPA 라우팅 fallback이 없어요`,
        detail: `주소창 직접 입력·새로고침 시 하위 경로가 404가 돼요. ${how}`,
        effort: '약 3분',
      });
      if (t.includes('netlify')) {
        const red = ctx.exists('_redirects') ? (ctx.read('_redirects') ?? '') : '';
        const toml = ctx.exists('netlify.toml') ? (ctx.read('netlify.toml') ?? '') : '';
        if (!/\/index\.html\s+200/.test(red) && !/to\s*=\s*"\/index\.html"/.test(toml)) {
          warn('Netlify', '_redirects 파일에 `/* /index.html 200` 한 줄을 추가하세요.');
        }
      }
      if (t.includes('vercel')) {
        const vj = ctx.exists('vercel.json') ? (ctx.read('vercel.json') ?? '') : '';
        if (!/index\.html/.test(vj) && !/rewrites/.test(vj)) {
          warn('Vercel', 'vercel.json에 rewrites: [{ "source": "/(.*)", "destination": "/index.html" }]를 추가하세요.');
        }
      }
      if (t.includes('firebase')) {
        const fj = ctx.exists('firebase.json') ? (ctx.read('firebase.json') ?? '') : '';
        if (!/"destination"\s*:\s*"\/index\.html"/.test(fj)) {
          warn('Firebase Hosting', 'firebase.json hosting.rewrites에 { "source": "**", "destination": "/index.html" }를 추가하세요.');
        }
      }
      if (t.includes('gh-pages') && !ctx.exists('404.html') && !ctx.exists('public/404.html')) {
        warn('GitHub Pages', 'index.html을 복사한 404.html을 함께 배포하면 딥링크가 살아나요.');
      }
      if (findings.length === 0) {
        findings.push({
          id: 'deploy.spa-fallback',
          pillar: 'deploy',
          severity: 'pass',
          title: 'SPA 라우팅 fallback이 설정돼 있어요',
          detail: '하위 경로 새로고침에도 앱이 열려요.',
        });
      }
      return findings;
    },
  },

  // ── GitHub Pages base path (프로젝트 사이트 = /레포명/ 경로) ──
  {
    id: 'deploy.ghpages-base-path',
    pillar: 'deploy',
    applies: (ctx) => ctx.stack.deployTargets.includes('gh-pages') && ctx.stack.language === 'js',
    run(ctx) {
      const fw = ctx.stack.framework ?? '';
      let ok = false; let how = '';
      if (fw.startsWith('vite')) {
        const cfg = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs'].map((f) => ctx.read(f) ?? '').join('');
        ok = /\bbase\s*:/.test(cfg);
        how = 'vite.config에 base: "/레포이름/"을 설정하세요.';
      } else if (fw === 'cra') {
        ok = typeof ctx.pkg?.homepage === 'string';
        how = 'package.json에 "homepage": "https://아이디.github.io/레포이름"을 추가하세요.';
      } else if (fw === 'next') {
        const cfg = ['next.config.js', 'next.config.mjs', 'next.config.ts'].map((f) => ctx.read(f) ?? '').join('');
        ok = /basePath\s*:/.test(cfg);
        how = 'next.config에 basePath: "/레포이름"을 설정하세요.';
      } else {
        return [];
      }
      return [{
        id: 'deploy.ghpages-base-path',
        pillar: 'deploy',
        severity: ok ? 'pass' : 'warn',
        title: ok ? 'GitHub Pages base path가 설정돼 있어요' : 'GitHub Pages base path가 없어요',
        detail: ok
          ? '프로젝트 사이트(/레포명/) 경로에서 에셋이 올바르게 로드돼요.'
          : `프로젝트 사이트는 /레포이름/ 아래에 배포돼서, base path가 없으면 CSS/JS가 전부 404가 나 빈 화면이 떠요. ${how} (사용자 페이지(아이디.github.io 루트)라면 체크해주세요.)`,
        clearable: ok ? undefined : true,
        effort: ok ? undefined : '약 2분',
      }];
    },
  },

  // ── 런타임 버전 고정 (research-deploy §13 #9) ──
  {
    id: 'deploy.runtime-pin',
    pillar: 'deploy',
    applies: (ctx) => ctx.stack.deployTargets.length > 0 && ['js', 'python'].includes(ctx.stack.language),
    run(ctx) {
      let ok = false; let how = '';
      if (ctx.stack.language === 'js') {
        const engines = (ctx.pkg?.engines ?? {}) as Record<string, string>;
        ok = Boolean(engines.node) || ctx.exists('.nvmrc');
        how = 'package.json에 "engines": { "node": "20.x" } 또는 .nvmrc 파일을 추가하세요.';
      } else {
        ok = ctx.exists('runtime.txt') || ctx.exists('.python-version');
        how = 'runtime.txt(예: python-3.12) 또는 .python-version 파일을 추가하세요.';
      }
      return [{
        id: 'deploy.runtime-pin',
        pillar: 'deploy',
        severity: ok ? 'pass' : 'info',
        title: ok ? '런타임 버전이 고정돼 있어요' : '런타임 버전이 고정돼 있지 않아요',
        detail: ok
          ? '플랫폼이 기본 버전을 올려도 빌드가 갑자기 깨지지 않아요.'
          : `배포 플랫폼이 기본 버전을 올리면 어느 날 빌드가 깨질 수 있어요. ${how}`,
      }];
    },
  },

  {
    id: 'deploy.env-example',
    pillar: 'deploy',
    applies: (ctx) => ctx.files.some((f) => f.split('/').pop()!.startsWith('.env')),
    run(ctx) {
      const hasExample = ctx.files.some((f) => /\.env\.(example|sample|template)$/.test(f));
      return [{
        id: 'deploy.env-example',
        pillar: 'deploy',
        severity: hasExample ? 'pass' : 'info',
        title: hasExample ? '.env.example로 필요한 환경변수가 문서화돼 있어요' : '.env.example이 없어요',
        detail: hasExample
          ? '배포 서버에 어떤 값을 넣어야 하는지 한눈에 알 수 있어요.'
          : '어떤 환경변수가 필요한지 목록(.env.example, 값은 비우고 이름만)을 만들어두면 배포 때 빠뜨리지 않아요.',
      }];
    },
  },
];
