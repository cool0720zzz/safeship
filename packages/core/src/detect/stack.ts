/**
 * 스택·배포타깃·프로바이더 탐지 — research/research-deploy-platforms.md §0,
 * research-git-safety.md Part C, research-cost-guard.md §14의 표를 코드로 이관.
 * 플랫폼 추가 = 이 테이블에 한 줄 (기획서 "데이터로 수용" 원칙).
 */
import type { StackInfo } from '../types.js';

interface DetectInput {
  files: string[];
  deps: Set<string>;
  exists(rel: string): boolean;
  read(rel: string): string | null;
}

/** 배포 타깃 시그널 (설정파일이 최우선 시그널) */
const DEPLOY_SIGNALS: Array<{ target: string; files: string[] }> = [
  { target: 'vercel', files: ['vercel.json', '.vercel/project.json'] },
  { target: 'netlify', files: ['netlify.toml', '_redirects'] },
  { target: 'cloudflare', files: ['wrangler.toml', 'wrangler.jsonc'] },
  { target: 'render', files: ['render.yaml'] },
  { target: 'fly', files: ['fly.toml'] },
  { target: 'railway', files: ['railway.json', 'railway.toml', 'nixpacks.toml'] },
  { target: 'heroku', files: ['Procfile', 'app.json'] },
  { target: 'firebase', files: ['firebase.json', '.firebaserc'] },
  { target: 'amplify', files: ['amplify.yml'] },
  { target: 'gh-pages', files: ['CNAME'] },
  { target: 'docker', files: ['Dockerfile', 'docker-compose.yml'] },
];

/** 비용 가드 A/B층: 의존성 → 프로바이더 매핑 (research-cost-guard.md §14)
 *  npm 이름 + pip/gem/composer/Go 모듈 경로를 한 리스트에 — deps는 전 생태계 합집합. */
const PROVIDER_DEPS: Array<{ provider: string; deps: string[] }> = [
  { provider: 'openai', deps: ['openai', 'ruby-openai', 'openai-php/client', 'github.com/sashabaranov/go-openai', 'async-openai'] },
  { provider: 'anthropic', deps: ['@anthropic-ai/sdk', 'anthropic', 'ruby-anthropic', 'github.com/anthropics/anthropic-sdk-go'] },
  { provider: 'gemini', deps: ['@google/generative-ai', '@google-cloud/vertexai', '@google/genai', 'google-generativeai', 'google-genai', 'google-cloud-aiplatform'] },
  { provider: 'replicate', deps: ['replicate', 'replicate-ruby'] },
  { provider: 'fal', deps: ['@fal-ai/client', '@fal-ai/serverless-client', 'fal-client'] },
  { provider: 'supabase', deps: ['@supabase/supabase-js', '@supabase/ssr', 'supabase', 'supabase-py'] },
  { provider: 'firebase', deps: ['firebase', 'firebase-admin', 'firebase-functions'] },
  { provider: 'aws', deps: ['aws-sdk', '@aws-sdk/client-s3', '@aws-sdk/client-dynamodb', 'boto3', 'aws-sdk-rails', 'aws/aws-sdk-php', 'github.com/aws/aws-sdk-go', 'github.com/aws/aws-sdk-go-v2'] },
  { provider: 'twilio', deps: ['twilio', 'twilio-ruby', 'twilio/sdk'] },
  { provider: 'sendgrid', deps: ['@sendgrid/mail', 'sendgrid', 'sendgrid-ruby'] },
  { provider: 'stripe', deps: ['stripe', 'stripe/stripe-php', 'github.com/stripe/stripe-go'] },
  { provider: 'maps', deps: ['@react-google-maps/api', '@googlemaps/js-api-loader', 'googlemaps'] },
];

/** rate-limit 방어 수단으로 인정하는 패키지 (JS + Python) */
export const RATE_LIMIT_DEPS = [
  '@upstash/ratelimit', 'express-rate-limit', 'rate-limiter-flexible',
  'slowapi', 'flask-limiter', 'django-ratelimit', 'fastapi-limiter',
  'rack-attack', // Ruby
];

export function detectStack(input: DetectInput): StackInfo {
  const { files, deps, exists } = input;

  // 언어 판별 (JS 우선, 비-JS 매니페스트 확인 — research-nonjs-environments.md)
  let language: StackInfo['language'] = 'unknown';
  let framework: string | undefined;

  // 결정적 시그널(manage.py/artisan/Gemfile)이 package.json보다 우선 —
  // Django/Laravel/Rails 레포는 대부분 프론트 에셋용 package.json을 함께 갖는다.
  if (exists('manage.py')) {
    language = 'python';
    framework = 'django';
  } else if (exists('artisan') && exists('composer.json')) {
    language = 'php';
    framework = 'laravel';
  } else if (exists('Gemfile')) {
    language = 'ruby';
    framework = 'rails';
  } else if (exists('package.json')) {
    language = 'js';
    // 메타 프레임워크가 bare vite/react보다 우선 (research Part C tie-breaker)
    if (deps.has('next')) framework = 'next';
    else if (deps.has('nuxt')) framework = 'nuxt';
    else if (deps.has('astro')) framework = 'astro';
    else if (deps.has('@sveltejs/kit')) framework = 'sveltekit';
    else if (deps.has('@remix-run/react')) framework = 'remix';
    else if (deps.has('react-scripts')) framework = 'cra';
    else if (deps.has('vite') && deps.has('react')) framework = 'vite-react';
    else if (deps.has('vite')) framework = 'vite';
    else if (deps.has('express') || deps.has('fastify') || deps.has('koa')) framework = 'node-server';
    // package.json이 빌드 도구뿐이고(프레임워크 미검출) 파이썬 웹 프레임워크가 있으면 파이썬이 본체
    if (!framework && (exists('requirements.txt') || exists('pyproject.toml'))) {
      if (deps.has('django')) { language = 'python'; framework = 'django'; }
      else if (deps.has('flask')) { language = 'python'; framework = 'flask'; }
      else if (deps.has('fastapi')) { language = 'python'; framework = 'fastapi'; }
    }
  } else if (exists('requirements.txt') || exists('pyproject.toml')) {
    language = 'python';
    // deps에 이미 pip 이름이 흡수돼 있다 (requirements + pyproject)
    if (deps.has('django')) framework = 'django';
    else if (deps.has('flask')) framework = 'flask';
    else if (deps.has('fastapi')) framework = 'fastapi';
  } else if (exists('go.mod')) {
    language = 'go';
  } else if (exists('Cargo.toml')) {
    language = 'rust';
  } else if (files.includes('index.html')) {
    language = 'static';
  }

  const deployTargets = DEPLOY_SIGNALS
    .filter((s) => s.files.some((f) => exists(f)))
    .map((s) => s.target);
  // Next.js면 Vercel이 암묵 기본값 (research §1)
  if (framework === 'next' && !deployTargets.includes('vercel')) deployTargets.unshift('vercel');
  // GitHub Actions로 Pages 배포하는 워크플로우 (CNAME 없이도)
  if (!deployTargets.includes('gh-pages')) {
    const wf = files.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f));
    if (wf.some((f) => /deploy-pages|actions-gh-pages|upload-pages-artifact/.test(input.read(f) ?? ''))) {
      deployTargets.push('gh-pages');
    }
  }

  // Go 모듈은 /v2 버전 서픽스·서브패키지(github.com/aws/aws-sdk-go-v2/config)로 오므로 프리픽스 매칭
  const depsArr = [...deps];
  const depMatches = (d: string): boolean =>
    deps.has(d) || (d.includes('/') && depsArr.some((x) => x.startsWith(d + '/')));
  const providers = PROVIDER_DEPS
    .filter((p) => p.deps.some(depMatches))
    .map((p) => p.provider);
  // Supabase CLI 프로젝트 디렉터리도 시그널
  if (exists('supabase/config.toml') && !providers.includes('supabase')) providers.push('supabase');
  // 배포 타깃 자체가 과금 플랫폼인 경우 (B층)
  for (const t of deployTargets) {
    if (['vercel', 'firebase', 'railway', 'fly', 'render', 'heroku', 'netlify', 'cloudflare', 'amplify'].includes(t) && !providers.includes(t)) {
      providers.push(t);
    }
  }

  return { language, framework, deployTargets, providers };
}
