# 폭주 방어 플레이북 — 모델별 · 환경별 구체 설정 (룰 레지스트리 원본)

> 비용 가드의 "구체 행동" 층. `research-cost-guard.md`가 "어디서 돈이 새는가"라면,
> 이 문서는 "**내 스택에서 정확히 뭘 설정하는가**"를 다룬다.
> ⚠️ 가격·모델명은 volatile — 상대 티어만 룰에 박고, 절대 가격은 공식 가격표 링크로 안내한다. (작성: 2026-07-09)

---

## 1. 모델 티어 — "기본값이 비싼 모델인가?"

원칙: **초보의 사고 대부분은 '비싼 모델 + 무제한 호출' 조합**. 도구는 코드에서 모델 리터럴을 감지해
티어를 알려주고, 저가 대안 + `max_tokens` 상한을 함께 안내한다.

### OpenAI ([가격표](https://platform.openai.com/pricing))
| 티어 | 모델 리터럴 | 상대 비용 | 안내 |
|---|---|---|---|
| 💚 저가 | `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4.1-nano`, `o1-mini`, `o3-mini` | 1× 기준 | 챗봇·요약 등 대부분 용도에 충분 |
| 🟡 중간 | `gpt-4o`, `gpt-4.1` | mini 대비 ~15-20× | 품질이 정말 필요한 경로만 |
| 🔴 고가 | `o1`, `o1-preview`, `o1-pro`, `o3`, `gpt-4.5` | mini 대비 수십~백× | 추론 특화 — 기본값 금지 |

### Anthropic ([가격표](https://docs.anthropic.com/en/docs/about-claude/pricing))
| 티어 | 모델 리터럴 | 안내 |
|---|---|---|
| 💚 저가 | `claude-haiku`, `claude-3-5-haiku`, `claude-haiku-4-5` | 대량 처리·분류 |
| 🟡 중간 | `claude-sonnet`, `claude-3-7-sonnet`, `claude-sonnet-5` | 범용 기본값으로 적절 |
| 🔴 고가 | `claude-opus`, `claude-3-opus`, `claude-opus-4` | haiku 대비 수십× — 기본값 금지 |

### Google ([가격표](https://ai.google.dev/pricing))
💚 `gemini-*-flash`, `flash-lite` · 🔴 `gemini-*-pro`

### 이미지 생성
💚 `flux-schnell`, `sdxl` (장당 ~$0.003-0.005) · 🟡 `flux-dev`, `dall-e-3` standard (~$0.02-0.04) · 🔴 `dall-e-3` HD, `flux-pro`, `gpt-image` 고해상 (~$0.05-0.2)

### 호출당 상한 (모델 무관 공통)
- **`max_tokens`(OpenAI) / `max_tokens`(Anthropic) 항상 명시** — 출력 토큰이 비용의 대부분. 미설정 시 모델 최대치까지 과금 가능.
- 대화 이력 전체 재전송 금지 — 최근 N개로 자르거나 요약. (입력 토큰 폭증의 주범)
- Anthropic는 **prompt caching** 적용 시 반복 시스템 프롬프트 비용 ~90% 절감.

---

## 2. Rate Limit — 스택별 정확한 레시피

원칙: "rate limit을 거세요"가 아니라 **"네 스택에선 이 패키지를 이 파일에"**까지.

| 스택/환경 | 레시피 | 비고 |
|---|---|---|
| **Next.js (Vercel)** | `@upstash/ratelimit` + Upstash Redis → `middleware.ts`에서 IP당 제한. 무료 Redis로 충분 | Vercel 서버리스는 인메모리 카운터가 안 통함(인스턴스가 계속 바뀜) — 반드시 외부 스토어 |
| **Next.js (Vercel) 보조** | Vercel **Firewall → Rate Limiting 규칙** (대시보드 설정, 코드 불필요) | 앱 계층 방어와 병행 권장 |
| **Express/Fastify (Render·Railway·Fly)** | `express-rate-limit` (단일 인스턴스) / 다중 인스턴스면 `rate-limit-redis` 스토어 | 상시 서버라 인메모리도 동작은 함 |
| **Cloudflare Workers** | 네이티브 **Rate Limiting binding** (`wrangler.toml`에 선언) | 외부 스토어 불필요, 가장 간단 |
| **Supabase Edge Functions** | Upstash Redis REST를 fetch로 호출하는 수동 카운터 | Deno 환경 — npm rate limiter 대부분 미지원 |
| **FastAPI (Python)** | `slowapi` (`@limiter.limit("10/minute")`) | |
| **Flask (Python)** | `flask-limiter` | |
| **Django** | `django-ratelimit` | |
| **Firebase Functions** | 함수 `maxInstances` 설정 + App Check | maxInstances가 폭주 상한 역할 |

### 공통 수칙
1. **유료 API를 부르는 라우트에만 걸어도 된다** — 전면 적용보다 핵심 경로 방어가 먼저.
2. 인증 없는 공개 엔드포인트 + 유료 API = 최악 조합. 최소 IP당 분당 5~10회.
3. 같은 입력 반복 호출은 **캐시**(Redis/`unstable_cache`)로 차단 — rate limit보다 먼저 돈을 아껴줌.
4. 재시도는 **최대 횟수 + 지수 백오프** 필수 (`p-retry` 등) — 재시도 폭풍이 요금 폭탄의 단골 원인.

---

## 3. 환경(배포 타깃)별 추가 설정 요약

| 타깃 | 반드시 확인 | 왜 |
|---|---|---|
| Vercel | Spend Management(일시정지 액션까지) + Firewall | Pro도 기본은 알림뿐 |
| Firebase | 예산알림 + **Auto Stop 킬스위치 확장** + 규칙 잠금 + `maxInstances` | Blaze는 하드캡 자체가 없음 |
| Supabase | Spend Cap ON 확인 + RLS 전 테이블 + `service_role` 서버 전용 | 캡이 컴퓨트 애드온은 못 막음 |
| AWS | Budget + **Budget Action**(자원 중지) | 알림만으론 안 멈춤 |
| Cloudflare | Budget alert (하드캡 없음, 단 Workers 무료는 일 10만 요청에서 자동 정지) | 무료 티어가 사실상 안전장치 |
| Railway/Fly | 사용량 대시보드 주기 확인 + 리소스 상한 | 초 단위 과금, 잊힌 인스턴스가 주범 |

---

## 엔진 반영 상태
- `cost.expensive-model-default` — 코드에서 🔴/🟡 티어 모델 리터럴 감지 → 저가 대안 + max_tokens 안내 (M0.5 추가)
- `cost.rate-limit` — 스택별 레시피를 detail/fixPrompt에 주입 (M0.5 업그레이드)
- 데이터 위치: `packages/core/src/data/protection.ts` (이 문서가 원본, 코드는 이관본)
