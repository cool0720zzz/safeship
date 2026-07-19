/**
 * `safeship init` — git pre-push 훅을 설치한다 (M1).
 * push 직전에 자동으로 스캔 → NO-GO면 push를 막고(exit 1) 브라우저 관제탑을 연다.
 * 설계: 평소엔 조용(GO면 통과), 위험할 때만 붙잡음. 우회는 `git push --no-verify`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

function repoRoot(cwd: string): string | null {
  const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  // git 없거나 실패 시 .git 디렉터리를 위로 탐색
  let dir = path.resolve(cwd);
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** core.hooksPath를 존중해 훅 디렉터리를 찾는다 */
function hooksDir(root: string): string {
  const r = spawnSync('git', ['-C', root, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) {
    const p = r.stdout.trim();
    return path.isAbsolute(p) ? p : path.join(root, p);
  }
  return path.join(root, '.git', 'hooks');
}

/** 훅에서 호출할 safeship 실행 경로 (설치 시점의 번들 절대경로) */
function selfInvocation(): string {
  // process.argv[1] = 지금 실행 중인 safeship.cjs 절대경로
  const self = process.argv[1] ? path.resolve(process.argv[1]) : '';
  return self.replace(/\\/g, '/'); // sh 훅에선 슬래시가 안전
}

const HOOK_MARK = '# >>> safeship pre-push >>>';
const HOOK_END = '# <<< safeship pre-push <<<';

function hookBody(self: string): string {
  return [
    '#!/bin/sh',
    HOOK_MARK,
    '# SafeShip — push 직전 안전 점검 (safeship init이 생성). 우회: git push --no-verify',
    'if command -v safeship >/dev/null 2>&1; then',
    '  safeship scan . --gate </dev/null',
    'elif command -v npx >/dev/null 2>&1 && npx --no-install safeship --help >/dev/null 2>&1; then',
    '  npx --no-install safeship scan . --gate </dev/null',
    self ? `else\n  node "${self}" scan . --gate </dev/null` : 'else\n  echo "[SafeShip] safeship 실행 파일을 찾지 못했어요 — 점검을 건너뜁니다." >&2',
    'fi',
    HOOK_END,
    '',
  ].join('\n');
}

export function runInit(cwd: string): number {
  const root = repoRoot(cwd);
  if (!root) {
    console.error('git 저장소를 찾지 못했어요. 먼저 `git init` 후 다시 실행하세요.');
    return 2;
  }
  const dir = hooksDir(root);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* 이미 있으면 무시 */
  }
  const hookPath = path.join(dir, 'pre-push');
  const self = selfInvocation();
  const body = hookBody(self);

  if (fs.existsSync(hookPath)) {
    const existing = fs.readFileSync(hookPath, 'utf8');
    if (existing.includes(HOOK_MARK)) {
      // 이미 SafeShip 블록이 있으면 최신 내용으로 교체
      const replaced = existing.replace(
        new RegExp(escapeRe(HOOK_MARK) + '[\\s\\S]*?' + escapeRe(HOOK_END) + '\\n?'),
        body.split('\n').slice(1).join('\n'), // shebang 제외한 블록만
      );
      fs.writeFileSync(hookPath, replaced, 'utf8');
    } else {
      // 다른 pre-push 훅이 있으면 SafeShip 블록만 뒤에 덧붙인다 (기존 훅 보존)
      const appended = existing.replace(/\s*$/, '\n\n') + body.split('\n').slice(1).join('\n');
      fs.writeFileSync(hookPath, appended, 'utf8');
    }
  } else {
    fs.writeFileSync(hookPath, body, 'utf8');
  }
  try {
    fs.chmodSync(hookPath, 0o755); // Windows에선 무시되지만 안전
  } catch {
    /* noop */
  }

  console.log('\x1b[1m🚀 SafeShip 설치 완료\x1b[0m');
  console.log(`\x1b[2mpush 직전에 자동으로 안전 점검을 합니다.\x1b[0m`);
  console.log(`  \x1b[2m훅:\x1b[0m ${hookPath}`);
  console.log('');
  console.log('  \x1b[32m•\x1b[0m 문제가 없으면 조용히 통과합니다.');
  console.log('  \x1b[31m•\x1b[0m 차단 항목이 있으면 push를 멈추고 브라우저에 관제탑을 띄워요.');
  console.log('  \x1b[2m•\x1b[0m 급할 땐 우회: git push --no-verify');
  console.log('');
  return 0;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
