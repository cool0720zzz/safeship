import type { Finding, Report, Rule, Summary } from './types.js';
import { buildScanContext } from './context.js';
import { gitSafetyRules } from './rules/gitSafety.js';
import { secretRules } from './rules/secrets.js';
import { deployRules } from './rules/deploy.js';
import { costRules } from './rules/cost.js';

/** 룰 레지스트리 — M2에서 research/ 데이터 기반으로 확장 */
export const ALL_RULES: Rule[] = [
  ...gitSafetyRules,
  ...secretRules,
  ...deployRules,
  ...costRules,
];

const SEV_ORDER: Record<string, number> = { block: 0, warn: 1, info: 2, pass: 3 };

export function runScan(rootDir: string): Report {
  const ctx = buildScanContext(rootDir);
  const findings: Finding[] = [];

  for (const rule of ALL_RULES) {
    try {
      if (rule.applies && !rule.applies(ctx)) continue;
      findings.push(...rule.run(ctx));
    } catch (err) {
      findings.push({
        id: rule.id,
        pillar: rule.pillar,
        severity: 'info',
        title: `룰 실행 중 오류 (${rule.id})`,
        detail: String(err instanceof Error ? err.message : err),
      });
    }
  }

  // 스캔이 상한에 잘렸으면 "전부 봤다"는 착각을 막는다 (침묵 절단 금지)
  if (ctx.truncated) {
    findings.push({
      id: 'scan.truncated',
      pillar: 'git',
      severity: 'warn',
      title: '파일이 너무 많아 일부만 스캔했어요',
      detail: `파일 수 상한(4,000개)에 걸려 나머지는 검사하지 못했어요. 이 판정은 전체가 아닌 일부 기준이에요 — 빌드 산출물·데이터 폴더를 .gitignore에 추가하면 스캔 범위가 정확해져요.`,
    });
  }

  findings.sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));

  const summary: Summary = {
    block: findings.filter((f) => f.severity === 'block').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    pass: findings.filter((f) => f.severity === 'pass').length,
    info: findings.filter((f) => f.severity === 'info').length,
    verdict: findings.some((f) => f.severity === 'block') ? 'NO-GO' : 'GO',
  };

  return {
    schemaVersion: 1,
    scannedAt: new Date().toISOString(),
    root: ctx.root,
    stack: ctx.stack,
    git: ctx.git,
    findings,
    summary,
  };
}
