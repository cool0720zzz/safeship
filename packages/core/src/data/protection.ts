/**
 * 폭주 방어 데이터 — research/research-runaway-protection.md의 이관본.
 * 가격은 volatile이라 상대 티어만 코드에 두고, 절대 가격은 링크로 안내한다.
 */

export type ModelTier = 'high' | 'mid';

export interface ModelSignal {
  /** 코드에서 찾을 리터럴 (따옴표/백틱 안 기준) */
  re: RegExp;
  label: string;
  tier: ModelTier;
  provider: string;
  cheaper: string;
  pricingUrl: string;
}

/** 🔴 고가 / 🟡 중간 티어 모델 감지 시그널 (저가 모델은 감지 대상 아님) */
export const MODEL_SIGNALS: ModelSignal[] = [
  // OpenAI
  { re: /['"`]o1(-preview|-pro)?['"`]/, label: 'OpenAI o1(추론 특화)', tier: 'high', provider: 'openai', cheaper: 'gpt-4o-mini 또는 o3-mini', pricingUrl: 'https://platform.openai.com/pricing' },
  { re: /['"`]o3['"`]/, label: 'OpenAI o3(추론 특화)', tier: 'high', provider: 'openai', cheaper: 'o3-mini', pricingUrl: 'https://platform.openai.com/pricing' },
  { re: /gpt-4\.5/, label: 'GPT-4.5', tier: 'high', provider: 'openai', cheaper: 'gpt-4.1-mini', pricingUrl: 'https://platform.openai.com/pricing' },
  { re: /gpt-4o(?!-mini)/, label: 'GPT-4o', tier: 'mid', provider: 'openai', cheaper: 'gpt-4o-mini (약 1/15 비용)', pricingUrl: 'https://platform.openai.com/pricing' },
  { re: /gpt-4\.1(?!-mini|-nano)/, label: 'GPT-4.1', tier: 'mid', provider: 'openai', cheaper: 'gpt-4.1-mini 또는 nano', pricingUrl: 'https://platform.openai.com/pricing' },
  // Anthropic
  { re: /claude-(3-)?opus/, label: 'Claude Opus', tier: 'high', provider: 'anthropic', cheaper: 'claude-haiku(대량 처리) 또는 sonnet(범용)', pricingUrl: 'https://docs.anthropic.com/en/docs/about-claude/pricing' },
  // Google
  { re: /gemini-[\w.]*-pro/, label: 'Gemini Pro', tier: 'mid', provider: 'gemini', cheaper: 'gemini-*-flash', pricingUrl: 'https://ai.google.dev/pricing' },
  // 이미지
  { re: /dall-e-3/, label: 'DALL-E 3', tier: 'mid', provider: 'openai', cheaper: 'flux-schnell/sdxl(약 1/10 비용) 검토', pricingUrl: 'https://platform.openai.com/pricing' },
  { re: /flux[-.]?(1\.1)?-?pro/i, label: 'FLUX Pro', tier: 'mid', provider: 'replicate', cheaper: 'flux-schnell 또는 flux-dev', pricingUrl: 'https://replicate.com/pricing' },
];

export interface RateLimitRecipe {
  /** StackInfo.framework 매칭 (undefined = 기본 레시피) */
  frameworks: string[];
  recipe: string;
  packages: string[];
}

/** 스택별 rate limit 레시피 (research §2) */
export const RATE_LIMIT_RECIPES: RateLimitRecipe[] = [
  {
    frameworks: ['next', 'vite-react', 'cra', 'remix', 'sveltekit', 'nuxt', 'astro'],
    recipe: '서버리스 배포에선 인메모리 카운터가 안 통해요(인스턴스가 계속 바뀜). @upstash/ratelimit + Upstash Redis(무료 티어)로 middleware에서 IP당 제한을 거세요. Vercel이라면 대시보드의 Firewall → Rate Limiting 규칙도 병행하면 좋아요.',
    packages: ['@upstash/ratelimit'],
  },
  {
    frameworks: ['node-server'],
    recipe: '단일 서버라면 express-rate-limit로 충분해요. 인스턴스를 여러 개 띄우면 rate-limit-redis 스토어를 붙이세요.',
    packages: ['express-rate-limit'],
  },
  {
    frameworks: ['flask'],
    recipe: 'flask-limiter로 라우트별 제한을 거세요(@limiter.limit("10/minute")). 워커/인스턴스가 여러 개면 Redis 스토리지 백엔드를 지정해야 해요.',
    packages: ['flask-limiter'],
  },
  {
    frameworks: ['fastapi'],
    recipe: 'slowapi(Starlette 미들웨어)로 IP당 제한을 거세요. 배포 인스턴스가 여러 개면 Redis 백엔드를 붙이세요.',
    packages: ['slowapi'],
  },
  {
    frameworks: ['django'],
    recipe: 'django-ratelimit 데코레이터로 뷰별 제한(@ratelimit(key="ip", rate="10/m"))을 거세요. 캐시 백엔드(Redis/Memcached)가 있어야 여러 워커에서 정확해요.',
    packages: ['django-ratelimit'],
  },
  {
    frameworks: ['rails'],
    recipe: 'rack-attack 미들웨어로 IP당 throttle을 거세요. 캐시 스토어(Redis)를 지정하면 멀티 인스턴스에서도 동작해요.',
    packages: ['rack-attack'],
  },
];

export const RATE_LIMIT_COMMON =
  '유료 API를 부르는 라우트에 최소 IP당 분당 5~10회 제한 + 같은 입력은 캐시 + 재시도는 최대 횟수/지수 백오프까지 걸면 폭주 3대 원인이 다 막혀요.';

/** max_tokens 안내 (모델 무관 공통) */
export const MAX_TOKENS_HINT =
  '호출마다 max_tokens(출력 상한)를 꼭 명시하세요 — 출력 토큰이 비용의 대부분이고, 미설정 시 모델 최대치까지 과금될 수 있어요. 대화 이력도 전체 재전송 말고 최근 몇 개로 잘라 보내세요.';

export function recipeFor(framework: string | undefined): RateLimitRecipe | undefined {
  if (!framework) return undefined;
  return RATE_LIMIT_RECIPES.find((r) => r.frameworks.includes(framework));
}
