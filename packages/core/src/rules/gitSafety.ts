/**
 * Git 안전 룰 — research-git-safety.md Part A (A1, A4 일부).
 * force push / reset --hard 차단은 훅(M1)에서 실시간으로 다룬다.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Finding, Rule } from '../types.js';

const WARN_SIZE = 50 * 1024 * 1024;   // 50MB — GitHub 경고선
const BLOCK_SIZE = 95 * 1024 * 1024;  // 100MB 직전 차단

export const gitSafetyRules: Rule[] = [
  {
    id: 'git.on-default-branch',
    pillar: 'git',
    applies: (ctx) => ctx.git.isRepo,
    run(ctx) {
      const b = ctx.git.branch;
      if (b === undefined) {
        // detached HEAD — 커밋해도 브랜치에 안 붙는 상태 (초보에게 커밋 유실 1위)
        return [{
          id: 'git.on-default-branch',
          pillar: 'git',
          severity: 'warn',
          title: '브랜치가 아닌 상태(detached HEAD)예요',
          detail: '지금 커밋하면 어느 브랜치에도 붙지 않아 잃어버리기 쉬워요. git switch -c 새브랜치명 으로 브랜치를 만들어 붙이세요.',
          effort: '약 10초',
        }];
      }
      if (b === 'main' || b === 'master') {
        return [{
          id: 'git.on-default-branch',
          pillar: 'git',
          severity: 'warn',
          title: `${b} 브랜치에서 직접 작업 중이에요`,
          detail: '브랜치를 만들면 실수해도 언제든 되돌릴 수 있어요. main은 항상 배포 가능한 상태로 지켜주세요.',
          effort: '약 10초',
          autoFix: 'create-branch',
        }];
      }
      return [{
        id: 'git.on-default-branch',
        pillar: 'git',
        severity: 'pass',
        title: `작업 브랜치(${b ?? '알 수 없음'})에서 안전하게 작업 중이에요`,
        detail: '실패해도 main은 안전해요 — 마음 놓고 실험하세요.',
      }];
    },
  },
  {
    id: 'git.node-modules-ignored',
    pillar: 'git',
    applies: (ctx) => ctx.stack.language === 'js',
    run(ctx) {
      const gi = ctx.read('.gitignore') ?? '';
      // 모노레포 글롭(**/node_modules, packages/*/node_modules)도 인정
      const ok = /(^|\n)\s*(?:[\w*./-]*\/)?node_modules\/?\s*(\r?\n|$)/.test(gi);
      return [{
        id: 'git.node-modules-ignored',
        pillar: 'git',
        severity: ok ? 'pass' : 'warn',
        title: ok ? '대용량 폴더(node_modules)가 잘 제외돼 있어요' : 'node_modules가 .gitignore에 없어요',
        detail: ok
          ? '언제든 다시 설치할 수 있는 폴더라 git에 올리지 않는 게 맞아요.'
          : '이대로면 수만 개 파일이 커밋에 실려요. .gitignore에 node_modules를 추가하세요.',
        effort: ok ? undefined : '약 10초',
        autoFix: ok ? null : 'gitignore-env',
      }];
    },
  },
  {
    id: 'git.large-file',
    pillar: 'git',
    run(ctx) {
      const findings: Finding[] = [];
      for (const rel of ctx.files) {
        let size = 0;
        try {
          size = fs.statSync(path.join(ctx.root, rel)).size;
        } catch {
          continue;
        }
        if (size >= WARN_SIZE) {
          // gitignore로 제외됐고 추적도 안 되면 푸시될 일 없음 (모델/데이터 파일 오탐 방지)
          if (ctx.isIgnored(rel) === true && ctx.isTracked(rel) !== true) continue;
          const mb = Math.round(size / (1024 * 1024));
          findings.push({
            id: 'git.large-file',
            pillar: 'git',
            severity: size >= BLOCK_SIZE ? 'block' : 'warn',
            title: `${mb}MB짜리 큰 파일이 들어 있어요`,
            detail: `${rel} — GitHub은 100MB부터 푸시를 거부해요. 이 파일이 정말 저장소에 필요한지 확인하세요.`,
            file: rel,
          });
        }
        if (findings.length >= 5) break;
      }
      if (findings.length === 0) {
        findings.push({
          id: 'git.large-file',
          pillar: 'git',
          severity: 'pass',
          title: '대용량 파일이 커밋에 없어요',
          detail: '50MB를 넘는 파일이 발견되지 않았어요.',
        });
      }
      return findings;
    },
  },
];
