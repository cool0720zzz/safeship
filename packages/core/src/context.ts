import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { GitInfo, ScanContext, StackInfo } from './types.js';
import { detectStack } from './detect/stack.js';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.svelte-kit',
  'out', 'coverage', '.venv', 'venv', '__pycache__', '.turbo', '.cache', 'vendor',
  // 대형 빌드 산출물/캐시 — 순회하면 MAX_FILES 소진 + 대용량 오탐 (리뷰 지적)
  'target', '.gradle', 'Pods', 'obj', '.terraform', '.pytest_cache',
  '.mypy_cache', '.ruff_cache', '.tox', '.dart_tool', '.expo',
]);
const MAX_FILES = 4000;
const MAX_READ_BYTES = 300 * 1024;

/** 텍스트로 취급할 확장자 (시크릿 스캔 대상) */
const TEXT_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.md',
  '.py', '.rb', '.php', '.go', '.rs', '.java',
  '.yml', '.yaml', '.toml', '.ini', '.txt', '.html', '.css', '.sql',
  // 시크릿 스캔 사각지대 해소 (보안 리뷰 P0-2): 컴포넌트/스크립트/노트북/IaC
  '.vue', '.svelte', '.astro', '.sh', '.bash', '.zsh', '.ipynb',
  '.tf', '.tfvars', '.properties', '.conf', '.cfg', '.xml',
  '.rules', // Firebase Security Rules
]);

function walk(root: string): { files: string[]; truncated: boolean } {
  const out: string[] = [];
  let truncated = false;
  const stack: string[] = [''];
  while (stack.length) {
    if (out.length >= MAX_FILES) { truncated = true; break; }
    const rel = stack.pop()!;
    const abs = path.join(root, rel);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        // '.git'만 제외 — '.github'(워크플로우)는 스캔해야 한다
        if (!SKIP_DIRS.has(e.name) && e.name !== '.git') stack.push(childRel);
      } else if (e.isFile()) {
        out.push(childRel);
        if (out.length >= MAX_FILES) { truncated = true; break; }
      }
    }
  }
  return { files: out.sort(), truncated };
}

function git(root: string, args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 5000 });
  if (r.error || r.status === null) return { ok: false, stdout: '' };
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim() };
}

function readGitInfo(root: string): GitInfo {
  const probe = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!probe.ok) {
    // git 바이너리 부재와 비-레포 구분
    const hasGit = !spawnSync('git', ['--version'], { encoding: 'utf8' }).error;
    return { isRepo: false, gitAvailable: hasGit };
  }
  let branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch.ok || branch.stdout === 'HEAD') {
    // 커밋이 아직 없는(unborn) HEAD도 브랜치명을 읽는다
    branch = git(root, ['symbolic-ref', '--short', 'HEAD']);
  }
  return {
    isRepo: true,
    gitAvailable: true,
    branch: branch.ok ? branch.stdout : undefined,
  };
}

/**
 * 비-JS 매니페스트의 의존성 이름을 deps에 추가한다 (프로바이더 감지용 휴리스틱).
 * 정확한 버전 해석은 목적이 아니고, 알려진 프로바이더 패키지명 매칭만 하면 된다.
 */
function collectNonJsDeps(
  deps: Set<string>,
  read: (rel: string) => string | null,
  exists: (rel: string) => boolean,
): void {
  // Python — requirements*.txt
  for (const f of ['requirements.txt', 'requirements-dev.txt']) {
    const text = exists(f) ? read(f) : null;
    if (!text) continue;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('-')) continue;
      const name = line.split(/[=<>!~\[;\s]/)[0].toLowerCase();
      if (name) deps.add(name);
    }
  }
  // Python — pyproject.toml (PEP 621 dependencies 배열 + poetry 테이블)
  const pyproject = exists('pyproject.toml') ? read('pyproject.toml') : null;
  if (pyproject) {
    const depArray = pyproject.match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depArray) {
      for (const m of depArray[1].matchAll(/["']([A-Za-z0-9_.-]+)/g)) deps.add(m[1].toLowerCase());
    }
    const poetry = pyproject.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?=\n\[|$)/);
    if (poetry) {
      for (const m of poetry[1].matchAll(/^([A-Za-z0-9_.-]+)\s*=/gm)) deps.add(m[1].toLowerCase());
    }
  }
  // Ruby — Gemfile
  const gemfile = exists('Gemfile') ? read('Gemfile') : null;
  if (gemfile) {
    for (const m of gemfile.matchAll(/^\s*gem\s+['"]([^'"]+)['"]/gm)) deps.add(m[1]);
  }
  // PHP — composer.json
  const composer = exists('composer.json') ? read('composer.json') : null;
  if (composer) {
    try {
      const c = JSON.parse(composer) as Record<string, Record<string, string>>;
      for (const key of ['require', 'require-dev']) {
        for (const name of Object.keys(c[key] ?? {})) deps.add(name);
      }
    } catch { /* 무시 */ }
  }
  // Go — go.mod (모듈 경로 전체를 이름으로)
  const gomod = exists('go.mod') ? read('go.mod') : null;
  if (gomod) {
    for (const m of gomod.matchAll(/^\s*([a-z0-9.\-/]+\/[a-z0-9.\-/]+)\s+v[\d.]/gm)) deps.add(m[1]);
  }
  // Rust — Cargo.toml [dependencies]
  const cargo = exists('Cargo.toml') ? read('Cargo.toml') : null;
  if (cargo) {
    const sec = cargo.match(/\[dependencies\]([\s\S]*?)(?=\n\[|$)/);
    if (sec) {
      for (const m of sec[1].matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)) deps.add(m[1].toLowerCase());
    }
  }
}

export function buildScanContext(rootDir: string): ScanContext {
  const root = path.resolve(rootDir);
  const { files, truncated } = walk(root);
  const readCache = new Map<string, string | null>();

  const read = (rel: string): string | null => {
    if (readCache.has(rel)) return readCache.get(rel)!;
    let result: string | null = null;
    const ext = path.extname(rel).toLowerCase();
    const base = path.basename(rel);
    const isEnvLike = base === '.env' || base.startsWith('.env.');
    const NAMED_TEXT = ['Procfile', 'Dockerfile', 'Gemfile', 'Gemfile.lock', '.dev.vars', '.nvmrc', '.python-version',
      '.npmrc', '.pypirc', '.netrc', '_netrc'];  // 레지스트리 인증토큰 파일 (보안 리뷰 P0-3)
    if (TEXT_EXT.has(ext) || isEnvLike || base.startsWith('.gitignore') || NAMED_TEXT.includes(base) || base === 'go.mod') {
      try {
        const abs = path.join(root, rel);
        const stat = fs.statSync(abs);
        if (stat.size <= MAX_READ_BYTES) {
          result = fs.readFileSync(abs, 'utf8');
        }
      } catch {
        result = null;
      }
    }
    readCache.set(rel, result);
    return result;
  };

  const exists = (rel: string) => files.includes(rel) || fs.existsSync(path.join(root, rel));

  let pkg: Record<string, unknown> | null = null;
  try {
    const raw = read('package.json');
    if (raw) pkg = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    pkg = null;
  }

  const deps = new Set<string>();
  for (const key of ['dependencies', 'devDependencies'] as const) {
    const d = (pkg?.[key] ?? {}) as Record<string, string>;
    for (const name of Object.keys(d)) deps.add(name);
  }
  collectNonJsDeps(deps, read, exists);

  const gitInfo = readGitInfo(root);

  const isIgnored = (rel: string): boolean | null => {
    if (!gitInfo.isRepo || !gitInfo.gitAvailable) return null;
    const r = spawnSync('git', ['-C', root, 'check-ignore', '-q', rel], { timeout: 5000 });
    if (r.error || r.status === null) return null;
    return r.status === 0;
  };

  // 추적 파일 목록은 첫 호출 때 한 번만 (ls-files 1회 스폰 후 Set 캐시)
  let trackedSet: Set<string> | null | undefined;
  const isTracked = (rel: string): boolean | null => {
    if (!gitInfo.isRepo || !gitInfo.gitAvailable) return null;
    if (trackedSet === undefined) {
      const r = git(root, ['ls-files']);
      trackedSet = r.ok ? new Set(r.stdout.split(/\r?\n/).filter(Boolean)) : null;
    }
    if (trackedSet === null) return null;
    return trackedSet.has(rel);
  };

  const stack: StackInfo = detectStack({ files, deps, exists, read });

  return { root, files, read, exists, pkg, deps, stack, git: gitInfo, isIgnored, isTracked, truncated };
}
