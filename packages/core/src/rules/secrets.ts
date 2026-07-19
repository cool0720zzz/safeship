/**
 * 시크릿 스캔 룰 — research-git-safety.md Part B의 정규식 표 이관 +
 * 전수검사 리뷰(2026-07-10)의 P0/P1 보강: JWT service_role, base64 자격증명,
 * .env.example 실값, 추적 중(.gitignore 무력) 파일, 자격증명 파일 확대.
 * 원칙: 리포트에 시크릿 실제 값 노출 금지(앞 6자만 마스킹 표기).
 */
import type { Finding, Rule, ScanContext } from '../types.js';
import { envTrackedPrompt, secretInCodePrompt } from '../fixPrompts.js';

/** 고신뢰 키 프리픽스 정규식 (B1 + 2026 바이브코더 상용 서비스) */
const KEY_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'OpenAI', re: /sk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{20,}/ },
  { label: 'OpenRouter', re: /\bsk-or-v1-[A-Za-z0-9]{32,}/ },
  { label: 'OpenAI(legacy)·sk계열', re: /\bsk-[A-Za-z0-9]{32,64}\b/ },
  { label: 'Anthropic', re: /sk-ant-api03-[A-Za-z0-9_-]{90,}/ },
  { label: 'AWS AccessKey', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { label: 'GitHub 토큰', re: /\bgh[pousr]_[A-Za-z0-9]{36}\b|github_pat_[A-Za-z0-9_]{82}/ },
  { label: 'GitLab 토큰', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { label: 'Google API', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: 'Google OAuth 시크릿', re: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/ },
  { label: 'Stripe(live)', re: /\b[sr]k_live_[0-9a-zA-Z]{24,}\b/ },
  { label: 'Slack 토큰', re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { label: 'SendGrid', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  { label: 'HuggingFace', re: /\bhf_[A-Za-z0-9]{34,}\b/ },
  { label: 'Replicate', re: /\br8_[A-Za-z0-9]{37,40}\b/ },
  { label: 'Groq', re: /\bgsk_[A-Za-z0-9]{40,}\b/ },
  { label: 'xAI', re: /\bxai-[A-Za-z0-9]{32,}\b/ },
  { label: 'Perplexity', re: /\bpplx-[A-Za-z0-9]{32,}\b/ },
  { label: 'Resend', re: /\bre_[A-Za-z0-9]{16,}\b/ },
  { label: 'Supabase PAT', re: /\bsbp_[a-f0-9]{40}\b/ },
  { label: 'Supabase secret', re: /\bsb_secret_[A-Za-z0-9]{20,}\b/ },
  { label: 'Netlify PAT', re: /\bnfp_[A-Za-z0-9]{36,}\b/ },
  { label: 'Telegram 봇', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{32,33}\b/ },
  { label: 'Twilio API Key', re: /\bSK[0-9a-f]{32}\b/ },
  { label: 'Discord 봇', re: /\b[MNOZ][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,}\b/ },
  { label: 'Azure Storage', re: /AccountKey=[A-Za-z0-9+/]{86,}==/ },
  { label: '개인키(PEM)', re: /-----BEGIN (?:RSA|EC|OPENSSH|PGP|DSA)? ?PRIVATE KEY-----/ },
  { label: 'DB 접속 문자열(비번 포함)', re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:@/\s]+:[^@/\s]+@/ },
];

/** 커밋되면 안 되는 파일 (B3 + 리뷰 P0-3 확대) */
const DENYLIST_BASENAMES = [
  /^\.env(\..+)?$/, /\.pem$/, /^id_rsa$/, /^id_ed25519$/, /\.p12$/, /\.pfx$/,
  /^serviceAccount.*\.json$/i, /-firebase-adminsdk-.*\.json$/, /^credentials\.json$/,
  // 리뷰 P0-3: 서명키·레지스트리 인증·IaC 상태
  /\.(key|jks|keystore|p8|der|ppk)$/, /^\.npmrc$/, /^\.pypirc$/, /^\.?_?netrc$/,
  /^terraform\.tfstate(\..+)?$/, /^secrets\.ya?ml$/,
];
const DENYLIST_ALLOW = [/^\.env\.(example|sample|template)$/];
/** .npmrc 등은 토큰 줄이 있을 때만 문제 (파일 자체는 정상 설정 파일) */
const CONTENT_GATED = new Map<RegExp, RegExp>([
  [/^\.npmrc$/, /_authToken\s*=\s*\S/],
  [/^\.pypirc$/, /password\s*=\s*\S/],
  [/^\.?_?netrc$/, /password\s+\S/],
]);

function mask(value: string): string {
  return value.slice(0, 6) + '…(' + value.length + '자, 값은 표시하지 않음)';
}

const PLACEHOLDER = /your|here|xxx|change|example|sample|dummy|placeholder|todo|test|<|\$\{|^\s*$/i;

/** 값 하나가 시크릿으로 보이는지 판정 (KEY_PATTERNS + JWT service_role + base64 id:pw) */
export function detectSecretValue(value: string): { label: string; match: string } | null {
  for (const { label, re } of KEY_PATTERNS) {
    const m = value.match(re);
    if (m) return { label, match: m[0] };
  }
  const jwt = value.match(/eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/);
  if (jwt) {
    try {
      const payload = Buffer.from(jwt[1], 'base64url').toString('utf8');
      if (payload.includes('service_role')) return { label: 'Supabase service_role JWT', match: jwt[0] };
    } catch { /* 디코드 실패 = JWT 아님 */ }
  }
  return null;
}

/** base64 인코딩 자격증명 (부록 A 골든 케이스 G1_USERS_B64) — 이름 힌트가 있을 때만 디코드 검사 */
function detectB64Credential(line: string): { name: string; match: string } | null {
  const m = line.match(/\b([A-Z0-9_]*(?:B64|BASE64)[A-Z0-9_]*)\s*[=:]\s*["']?([A-Za-z0-9+/=]{12,})["']?/);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[2], 'base64').toString('utf8');
    // id:pw 형태이거나 인쇄 가능한 자격증명 꼴일 때만
    if (/^[\x20-\x7e]{4,}$/.test(decoded) && /[:;,]/.test(decoded)) {
      return { name: m[1], match: m[2] };
    }
  } catch { /* base64 아님 */ }
  return null;
}

function scanFileForKeys(ctx: ScanContext, rel: string): Finding[] {
  const text = ctx.read(rel);
  if (!text) return [];
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const hit = detectSecretValue(lines[i]);
    if (hit) {
      findings.push({
        id: 'secret.key-in-file',
        pillar: 'git',
        severity: 'block',
        title: `${hit.label} 키로 보이는 값이 파일에 들어 있어요`,
        detail: `${rel}:${i + 1} — ${mask(hit.match)}. 이대로 올라가면 다른 사람이 내 비용을 쓸 수 있어요.`,
        file: rel,
        line: i + 1,
        effort: '약 2분',
        fixPrompt: secretInCodePrompt(rel, hit.label),
      });
    } else {
      const b64 = detectB64Credential(lines[i]);
      if (b64) {
        findings.push({
          id: 'secret.b64-credential',
          pillar: 'git',
          severity: 'block',
          title: 'base64로 감춘 자격증명이 있어요 — 암호화가 아니에요',
          detail: `${rel}:${i + 1} — ${b64.name} = ${mask(b64.match)}. base64는 누구나 1초 만에 되돌릴 수 있어요. 비밀번호는 bcrypt/argon2로 해싱하고, 자격증명은 환경변수+시크릿 매니저로 옮기세요.`,
          file: rel,
          line: i + 1,
          effort: '약 10분',
        });
      }
    }
    if (findings.length >= 10) break; // 파일당 상한
  }
  return findings;
}

export const secretRules: Rule[] = [
  {
    id: 'secret.denylist-file',
    pillar: 'git',
    run(ctx) {
      const findings: Finding[] = [];
      for (const rel of ctx.files) {
        const base = rel.split('/').pop()!;
        if (DENYLIST_ALLOW.some((re) => re.test(base))) continue;
        const denyRe = DENYLIST_BASENAMES.find((re) => re.test(base));
        if (!denyRe) continue;

        // 내용 조건이 있는 파일(.npmrc 등)은 토큰 줄이 있을 때만
        const gate = [...CONTENT_GATED.entries()].find(([re]) => re.source === denyRe.source);
        if (gate) {
          const text = ctx.read(rel);
          if (!text || !gate[1].test(text)) continue;
        }

        const ignored = ctx.isIgnored(rel);
        const tracked = ctx.isTracked(rel);
        // .gitignore가 지켜주는 중 — 단, 이미 추적 중이면 gitignore는 무력 (골든 케이스 #1)
        if (ignored === true && tracked !== true) continue;

        // .env 계열이면 안의 키 이름(값 아님)을 프롬프트에 활용
        const keyNames: string[] = [];
        const text = ctx.read(rel);
        if (text && base.startsWith('.env')) {
          for (const line of text.split(/\r?\n/)) {
            const m = line.match(/^([A-Z0-9_]+)\s*=/);
            if (m) keyNames.push(m[1]);
            if (keyNames.length >= 5) break;
          }
        }
        const trackedNote = tracked === true
          ? ' 이미 git에 추적 중이라 .gitignore만으로는 보호되지 않아요 — git rm --cached로 추적을 끊고, 안의 키는 재발급하세요.'
          : '';
        findings.push({
          id: 'secret.denylist-file',
          pillar: 'git',
          severity: 'block',
          title: `${base} 파일이 git에 올라갈 수 있는 상태예요`,
          detail: (ignored === null
            ? `${rel} — 비밀 값이 담기는 파일이에요. .gitignore로 보호해주세요.`
            : ignored === true
              ? `${rel} — .gitignore에 있지만`
              : `${rel} — .gitignore에 없어서 커밋/푸시에 실릴 수 있어요.`) + trackedNote,
          file: rel,
          effort: '약 30초',
          autoFix: 'gitignore-env',
          fixPrompt: envTrackedPrompt(rel, keyNames),
        });
      }
      if (findings.length === 0) {
        findings.push({
          id: 'secret.denylist-file',
          pillar: 'git',
          severity: 'pass',
          title: '비밀 파일(.env 등)이 안전하게 보호되고 있어요',
          detail: '.env, 개인키 등 민감 파일이 없거나 .gitignore로 제외돼 있어요.',
        });
      }
      return findings;
    },
  },
  {
    id: 'secret.key-in-file',
    pillar: 'git',
    run(ctx) {
      const findings: Finding[] = [];
      for (const rel of ctx.files) {
        const base = rel.split('/').pop()!;
        // .env는 denylist 룰이 다루므로 여기선 소스/설정 파일만
        if (base.startsWith('.env')) continue;
        if (base === 'package-lock.json' || base === 'pnpm-lock.yaml' || base === 'yarn.lock') continue;
        const fileFindings = scanFileForKeys(ctx, rel);
        // gitignore로 제외됐고 추적도 안 되는 파일은 커밋될 일이 없다 (오탐 방지)
        if (fileFindings.length && ctx.isIgnored(rel) === true && ctx.isTracked(rel) !== true) continue;
        findings.push(...fileFindings);
        if (findings.length >= 20) break; // 전체 상한
      }
      if (findings.length === 0) {
        findings.push({
          id: 'secret.key-in-file',
          pillar: 'git',
          severity: 'pass',
          title: 'API 키가 코드에 하드코딩되지 않았어요',
          detail: '알려진 키 패턴(OpenAI/AWS/GitHub 등)이 소스에서 발견되지 않았어요.',
        });
      }
      return findings;
    },
  },
  // ── .env.example에 붙여넣은 진짜 값 (리뷰 P0-1: "이름만 있어야 하는 파일에 값이 있다") ──
  {
    id: 'secret.example-real-value',
    pillar: 'git',
    applies: (ctx) => ctx.files.some((f) => /\.env\.(example|sample|template)$/.test(f)),
    run(ctx) {
      const findings: Finding[] = [];
      for (const rel of ctx.files.filter((f) => /\.env\.(example|sample|template)$/.test(f))) {
        const text = ctx.read(rel);
        if (!text) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
          if (!m) continue;
          const value = m[2].trim().replace(/^["']|["']$/g, '');
          if (!value || PLACEHOLDER.test(value)) continue;
          const hit = detectSecretValue(value);
          if (hit) {
            findings.push({
              id: 'secret.example-real-value',
              pillar: 'git',
              severity: 'block',
              title: '예시 파일(.env.example)에 진짜 키가 들어 있어요',
              detail: `${rel}:${i + 1} — ${m[1]} = ${mask(hit.match)} (${hit.label}). 예시 파일은 커밋되는 문서예요 — 값은 비우고 이름만 남기세요. 이 키는 재발급이 필요해요.`,
              file: rel,
              line: i + 1,
              effort: '약 3분',
            });
          }
        }
      }
      if (findings.length === 0) {
        findings.push({
          id: 'secret.example-real-value',
          pillar: 'git',
          severity: 'pass',
          title: '예시 파일(.env.example)에 실제 값이 없어요',
          detail: '예시 파일이 이름/플레이스홀더만 담고 있어요 — 올바른 사용법이에요.',
        });
      }
      return findings;
    },
  },
];
