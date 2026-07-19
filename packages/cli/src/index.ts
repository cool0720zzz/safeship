#!/usr/bin/env node
/**
 * SafeShip CLI — M0: scan 명령 (임의 레포 폴더 → findings JSON / 관제 요약)
 * M1에서 init(훅 설치)·관제탑 서버가 추가된다.
 */
import * as fs from 'node:fs';
import { runScan } from '@safeship/core';
import type { Finding, Report } from '@safeship/core';
import { openCockpit, openOverlayApp, renderDesktopIndex } from './web.js';
import { runInit } from './init.js';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';

function sevBadge(f: Finding): string {
  switch (f.severity) {
    case 'block': return `${RED}■ 차단${RESET}`;
    case 'warn': return `${YELLOW}▲ 확인${RESET}`;
    case 'pass': return `${GREEN}✓ 통과${RESET}`;
    default: return `${DIM}· 정보${RESET}`;
  }
}

function printReport(report: Report): void {
  const { stack, git, summary } = report;
  console.log('');
  console.log(`${BOLD}🚀 SafeShip 스캔${RESET} ${DIM}${report.root}${RESET}`);
  console.log(
    `${DIM}스택:${RESET} ${stack.framework ?? stack.language}` +
    (stack.deployTargets.length ? ` → ${stack.deployTargets.join(', ')}` : '') +
    (stack.providers.length ? `  ${DIM}프로바이더:${RESET} ${stack.providers.join(', ')}` : ''),
  );
  if (git.isRepo) console.log(`${DIM}브랜치:${RESET} ${git.branch ?? '?'}`);
  console.log('');

  const byPillar: Record<string, string> = { git: 'Git 안전 · 시크릿', deploy: '배포 전 점검', cost: '비용 · 요금 사고 방지' };
  for (const pillar of ['git', 'deploy', 'cost'] as const) {
    const items = report.findings.filter((f) => f.pillar === pillar);
    if (!items.length) continue;
    console.log(`${BOLD}${byPillar[pillar]}${RESET}`);
    for (const f of items) {
      console.log(`  ${sevBadge(f)}  ${f.title}`);
      const meta = [f.file && `${f.file}${f.line ? ':' + f.line : ''}`, f.effort, f.deepLink].filter(Boolean).join(' · ');
      console.log(`         ${DIM}${f.detail}${meta ? `\n         ${meta}` : ''}${RESET}`);
    }
    console.log('');
  }

  const v = summary.verdict === 'GO'
    ? `${GREEN}${BOLD}GO — 발사 가능${RESET}`
    : `${RED}${BOLD}NO-GO — 차단 ${summary.block}건${RESET}`;
  console.log(`${BOLD}발사 관제 판정:${RESET} ${v}  ${DIM}(차단 ${summary.block} · 확인 ${summary.warn} · 통과 ${summary.pass})${RESET}`);
  if (summary.block > 0) {
    console.log(`${DIM}차단 항목의 fixPrompt를 AI에 붙여넣으면 고치는 법을 안내받을 수 있어요 (--json으로 확인).${RESET}`);
  }
  console.log('');
}

function main(): number {
  const args = process.argv.slice(2);
  let cmd = args[0] ?? 'scan';
  const asJson = args.includes('--json');
  const gate = args.includes('--gate');
  let dir = args.find((a, i) => i > 0 && !a.startsWith('-')) ?? process.cwd();

  // `safeship ./내폴더` 처럼 명령 없이 경로만 준 경우도 스캔으로
  if (cmd !== 'scan' && cmd !== 'init' && !cmd.startsWith('-') && fs.existsSync(cmd)) {
    dir = cmd;
    cmd = 'scan';
  }

  if (cmd === 'init') {
    return runInit(process.cwd());
  }

  // 데스크톱 오버레이 index.html 생성: safeship overlay-build <outfile>
  if (cmd === 'overlay-build') {
    const out = args[1];
    if (!out) { console.error('사용법: safeship overlay-build <index.html 경로>'); return 2; }
    fs.writeFileSync(out, renderDesktopIndex(), 'utf8');
    console.log(`오버레이 프론트 생성: ${out}`);
    return 0;
  }

  if (cmd !== 'scan') {
    console.error(`알 수 없는 명령: ${cmd}\n사용법: safeship scan [폴더] [--json|--web]  |  safeship init`);
    return 2;
  }

  const report = runScan(dir);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return report.summary.verdict === 'GO' ? 0 : 1;
  }

  const isGo = report.summary.verdict === 'GO';

  // 오버레이 앱이 읽을 payload({report, celebrate}) 방출 — 훅/테스트용
  if (args.includes('--payload')) {
    console.log(JSON.stringify({ report, celebrate: isGo }));
    return isGo ? 0 : 1;
  }

  // 훅 게이트 모드: 오버레이 앱(있으면) 우선, 없으면 브라우저 패널. GO면 통과, NO-GO면 차단(exit 1)
  if (gate) {
    // 오버레이 앱을 먼저 시도, 실패 시 브라우저 관제탑으로 폴백
    const showPanel = (celebrate: boolean): string => {
      if (openOverlayApp(report, { celebrate })) return 'overlay';
      return openCockpit(report, { celebrate }) ? 'browser' : 'none';
    };
    if (isGo) {
      const how = showPanel(true);
      console.log(`${GREEN}${BOLD}✅ SafeShip: 안전 (GO)${RESET} ${DIM}— 푸시를 진행합니다.${RESET}`);
      if (how !== 'none') console.log(`${DIM}🌟 관제탑에서 발사 장면을 확인하세요.${RESET}`);
      return 0;
    }
    console.log(`\n${RED}${BOLD}🛑 SafeShip: 차단 ${report.summary.block}건 — 푸시를 멈췄어요${RESET}`);
    printReport(report);
    const how = showPanel(false);
    if (how !== 'none') {
      console.log(`${BOLD}🛰  관제탑을 열었어요${RESET} ${DIM}— NOVA의 브리핑을 확인하세요.${RESET}`);
    }
    console.log(`${DIM}고친 뒤 다시 push 하세요. 이번만 넘기려면: ${RESET}${BOLD}git push --no-verify${RESET}`);
    console.log('');
    return 1;
  }

  // 일반 scan: --web이면 브라우저도 연다
  if (args.includes('--web')) {
    const file = openCockpit(report);
    if (file) {
      console.log(`\n${BOLD}🛰  관제탑을 브라우저로 열었어요${RESET} ${DIM}${file}${RESET}`);
      console.log(`${DIM}스크롤하며 NOVA의 브리핑을 확인하세요. 터미널 요약은 아래에.${RESET}`);
    } else {
      console.error('관제탑 UI 파일(cockpit.html)을 찾지 못해 터미널 리포트만 출력해요.');
    }
  }

  printReport(report);
  return isGo ? 0 : 1;
}

process.exit(main());
