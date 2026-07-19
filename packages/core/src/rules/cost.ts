/**
 * 비용 가드 룰 — research-cost-guard.md의 핵심 이관.
 * A층: 종량 과금 API. B층: 플랫폼 인프라 과금.
 * 원칙: "예산 알림 ≠ 지출 상한". 레포로 확인 불가한 계정 설정은 clearable(사용자 확인)로.
 */
import type { Finding, Rule } from '../types.js';
import { RATE_LIMIT_DEPS } from '../detect/stack.js';
import { rateLimitPrompt, serviceRolePrompt } from '../fixPrompts.js';
import { MODEL_SIGNALS, MAX_TOKENS_HINT, RATE_LIMIT_COMMON, recipeFor } from '../data/protection.js';

/** 프로바이더별 상한 안내 (research-cost-guard.md 각 섹션의 "Exact cap steps") */
const CAP_GUIDES: Record<string, { title: string; detail: string; deepLink: string }> = {
  openai: {
    title: 'OpenAI 지출 상한(프로젝트 예산)을 설정했는지 확인하세요',
    detail: '조직 예산은 알림만 오고 멈추지 않아요. Project별 Budget만 실제로 요청을 중단시켜요.',
    deepLink: 'https://platform.openai.com/settings/organization/limits',
  },
  anthropic: {
    title: 'Anthropic 워크스페이스 지출 한도를 확인하세요',
    detail: 'Console → Limits에서 조직/워크스페이스별 spend limit을 걸 수 있어요.',
    deepLink: 'https://console.anthropic.com/settings/limits',
  },
  gemini: {
    title: 'Gemini 프로젝트 지출 상한을 확인하세요',
    detail: 'AI Studio → Spend에서 월 상한을 설정하면 도달 시 트래픽이 중단돼요.',
    deepLink: 'https://aistudio.google.com/',
  },
  supabase: {
    title: 'Supabase Spend Cap이 켜져 있는지 확인하세요',
    detail: 'Pro는 Spend Cap이 기본 ON이지만 꺼져 있으면 egress 요금이 무제한이에요. (컴퓨트 애드온은 캡 예외)',
    deepLink: 'https://supabase.com/dashboard/org/_/billing',
  },
  firebase: {
    title: 'Firebase 예산 알림 + 킬스위치를 확인하세요',
    detail: 'Blaze 플랜은 하드캡이 없어요. 예산 알림은 메일만 — 진짜 차단은 Auto Stop(킬스위치) 확장이 필요해요.',
    deepLink: 'https://console.firebase.google.com/',
  },
  vercel: {
    title: 'Vercel Spend Management를 확인하세요',
    detail: '트래픽 폭증 시 대역폭·함수 요금이 급증할 수 있어요. Spend Management로 임계치에서 프로젝트를 일시정지시킬 수 있어요.',
    deepLink: 'https://vercel.com/dashboard',
  },
  aws: {
    title: 'AWS Budget + 예산 액션을 확인하세요',
    detail: 'AWS는 기본 상한이 없어요. Budget 알림에 더해 Budget Action(자원 중지)까지 걸어야 실제로 멈춰요.',
    deepLink: 'https://console.aws.amazon.com/cost-management/',
  },
  twilio: {
    title: 'Twilio 사용량 트리거와 자동충전 설정을 확인하세요',
    detail: 'SMS 펌핑 사고 시 자동충전이 계속 결제해요. Usage Trigger + 지역 제한을 걸어두세요.',
    deepLink: 'https://console.twilio.com/',
  },
  replicate: {
    title: 'Replicate 지출 한도를 확인하세요',
    detail: '이미지 생성은 장당 과금이라 볼륨에 비례해 요금이 늘어요.',
    deepLink: 'https://replicate.com/account/billing',
  },
  maps: {
    title: 'Google Maps QPD 쿼터 상한을 확인하세요',
    detail: '예산 알림은 호출을 못 막아요 — API별 Queries Per Day 쿼터만 실제로 멈춰요.',
    deepLink: 'https://console.cloud.google.com/apis/dashboard',
  },
  // ── B층: 배포 플랫폼 자체 과금 (research-deploy-platforms.md 각 §의 cost traps) ──
  render: {
    title: 'Render 플랜과 슬립 정책을 확인하세요',
    detail: '무료 웹서비스는 15분 유휴 시 잠들어요(첫 요청 ~1분 지연) + 월 750시간 한도. 항상 켜두려면 서비스당 $7+/월, 대역폭 초과는 $30/100GB.',
    deepLink: 'https://dashboard.render.com/billing',
  },
  railway: {
    title: 'Railway 사용량 한도(Usage Limits)를 설정하세요',
    detail: '상시 무료가 없어요 — 체험 $5 크레딧 소진 후 중지/과금돼요. 리소스-초 단위 과금이라 켜둔 서비스·DB가 조용히 크레딧을 먹어요.',
    deepLink: 'https://railway.com/account/usage',
  },
  fly: {
    title: 'Fly.io 머신이 켜져 있으면 계속 과금돼요',
    detail: '무료 티어가 없어요. 잊힌 머신도 초 단위로 과금 — auto_stop_machines 설정과 안 쓰는 머신 정리를 확인하세요.',
    deepLink: 'https://fly.io/dashboard',
  },
  heroku: {
    title: 'Heroku 다이노 플랜을 확인하세요',
    detail: '무료가 없어요 — Eco $5/월(30분 유휴 시 슬립), 상시 구동은 Basic $7/월+. Postgres 등 애드온은 별도 과금이에요.',
    deepLink: 'https://dashboard.heroku.com',
  },
  netlify: {
    title: 'Netlify 크레딧 잔량을 확인하세요',
    detail: '무료 플랜은 월 ~300크레딧 — 소진되면 계정의 모든 사이트가 다음 주기까지 일시정지돼요. 대용량 미디어·잦은 재빌드가 주범이에요.',
    deepLink: 'https://app.netlify.com',
  },
  cloudflare: {
    title: 'Cloudflare Workers 무료 한도(10만 요청/일)를 확인하세요',
    detail: '한도 초과 시 요청이 실패해요(자정 UTC 리셋). 동적 트래픽이 크면 $5/월 유료 플랜과 KV/D1/R2 과금도 확인하세요.',
    deepLink: 'https://dash.cloudflare.com',
  },
  amplify: {
    title: 'Amplify SSR 과금을 확인하세요',
    detail: 'SSR은 요청 수 + 컴퓨트(GB-초) 단위로 과금돼요 — 정적/SSG 배포가 무료 한도(월 15GB 서빙)에 훨씬 유리해요.',
    deepLink: 'https://console.aws.amazon.com/amplify',
  },
  sendgrid: {
    title: 'SendGrid 발송량과 봇 방지를 확인하세요',
    detail: '무료 100통/일. 공개 폼이 스팸봇에 뚫리면 유료 발송량이 폭증해요 — 폼에 캡차/레이트리밋을 함께 두세요.',
    deepLink: 'https://app.sendgrid.com',
  },
};

export const costRules: Rule[] = [
  {
    id: 'cost.spend-cap',
    pillar: 'cost',
    applies: (ctx) => ctx.stack.providers.length > 0,
    run(ctx) {
      const findings: Finding[] = [];
      for (const p of ctx.stack.providers) {
        const guide = CAP_GUIDES[p];
        if (!guide) continue;
        findings.push({
          id: `cost.spend-cap.${p}`,
          pillar: 'cost',
          severity: 'warn',
          title: guide.title,
          detail: guide.detail + ' (계정 설정이라 레포에서는 확인할 수 없어요 — 설정했다면 체크해주세요.)',
          deepLink: guide.deepLink,
          clearable: true,
        });
      }
      return findings;
    },
  },
  {
    id: 'cost.service-role-exposed',
    pillar: 'cost',
    applies: (ctx) => ctx.stack.providers.includes('supabase'),
    run(ctx) {
      const findings: Finding[] = [];
      // 예시 파일은 값 없는 문서 — 이름만으로 차단하지 않는다 (오탐 방지)
      const envFiles = ctx.files.filter((f) => {
        const b = f.split('/').pop()!;
        return b.startsWith('.env') && !/example|sample|template/.test(b);
      });
      for (const rel of envFiles) {
        const text = ctx.read(rel);
        if (!text) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(/^([A-Z0-9_]*(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)[A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*)\s*=/);
          if (m) {
            findings.push({
              id: 'cost.service-role-exposed',
              pillar: 'cost',
              severity: 'block',
              title: 'Supabase service_role 키가 클라이언트에 노출돼요',
              detail: `${rel}:${i + 1} — ${m[1]}. service_role은 보안 규칙(RLS)을 우회하는 관리자 키라 브라우저에 노출되면 DB가 통째로 뚫려요.`,
              file: rel,
              line: i + 1,
              effort: '약 5분',
              fixPrompt: serviceRolePrompt(),
            });
          }
        }
      }
      if (findings.length === 0) {
        findings.push({
          id: 'cost.service-role-exposed',
          pillar: 'cost',
          severity: 'pass',
          title: 'service_role 키가 클라이언트에 노출되지 않았어요',
          detail: '공개 접두사가 붙은 service_role 변수가 발견되지 않았어요.',
        });
      }
      return findings;
    },
  },
  {
    id: 'cost.rate-limit',
    pillar: 'cost',
    applies: (ctx) =>
      ['js', 'python', 'ruby'].includes(ctx.stack.language) &&
      ctx.stack.providers.some((p) => ['openai', 'anthropic', 'gemini', 'replicate', 'fal'].includes(p)),
    run(ctx) {
      const has = RATE_LIMIT_DEPS.some((d) => ctx.deps.has(d));
      const paid = ctx.stack.providers.filter((p) => ['openai', 'anthropic', 'gemini', 'replicate', 'fal'].includes(p));
      const recipe = recipeFor(ctx.stack.framework);
      return [{
        id: 'cost.rate-limit',
        pillar: 'cost',
        severity: has ? 'pass' : 'warn',
        title: has ? 'API 호출에 요청 제한이 걸려 있어요' : '유료 API에 요청 제한(rate limit)이 없어 보여요',
        detail: has
          ? `${RATE_LIMIT_DEPS.find((d) => ctx.deps.has(d))} 감지 — 요금 폭주와 남용을 막아줘요.`
          : `${paid.join(', ')}를 쓰는데 rate limit이 없어요. ${recipe ? recipe.recipe : RATE_LIMIT_COMMON}`,
        effort: has ? undefined : '약 10분',
        fixPrompt: has ? undefined : rateLimitPrompt(paid, ctx.stack.framework, recipe?.packages[0]),
      }];
    },
  },
  {
    id: 'cost.expensive-model-default',
    pillar: 'cost',
    applies: (ctx) => ctx.stack.language === 'js' || ctx.stack.language === 'python',
    run(ctx) {
      const findings: Finding[] = [];
      const seen = new Set<string>();
      for (const rel of ctx.files) {
        const base = rel.split('/').pop()!;
        if (base.endsWith('.md') || base.includes('lock')) continue;
        // gitignore된(그리고 추적 안 되는) 파일은 커밋될 일이 없어 스캔 제외 (self-scan 오탐 방지)
        if (ctx.isIgnored(rel) === true && ctx.isTracked(rel) !== true) continue;
        const text = ctx.read(rel);
        if (!text) continue;
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          for (const sig of MODEL_SIGNALS) {
            if (seen.has(sig.label)) continue;
            if (!sig.re.test(lines[i])) continue;
            seen.add(sig.label);
            const isHigh = sig.tier === 'high';
            findings.push({
              id: 'cost.expensive-model-default',
              pillar: 'cost',
              severity: isHigh ? 'warn' : 'info',
              title: isHigh
                ? `${sig.label} — 고가 티어 모델이 코드에 있어요`
                : `${sig.label} — 중간 티어 모델을 쓰고 있어요`,
              detail: `${rel}:${i + 1} — 저가 대안: ${sig.cheaper}. ${MAX_TOKENS_HINT} (정확한 가격은 변동돼요 — 가격표를 확인하세요.)`,
              file: rel,
              line: i + 1,
              deepLink: sig.pricingUrl,
              fixPrompt: [
                `내 프로젝트 ${rel}에서 ${sig.label} 모델을 쓰고 있어.`,
                `1) 이 용도에 정말 이 티어가 필요한지 검토하고, 충분하다면 ${sig.cheaper}(으)로 기본값을 바꿔줘`,
                `2) 모든 호출에 max_tokens(출력 상한)를 명시해줘`,
                `3) 대화 이력을 전체 재전송하고 있으면 최근 몇 개로 자르거나 요약하도록 바꿔줘.`,
              ].join('\n'),
            });
          }
        }
        if (seen.size >= 6) break;
      }
      return findings;
    },
  },
];
