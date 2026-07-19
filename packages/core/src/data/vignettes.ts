/**
 * NOVA 브리핑 비네트 — 룰별 우주 세계관 비유 (기획서 UX: 세계관은 재미, 정보는 표준 용어).
 * 원칙:
 *  - headline(h)은 함선 비유로 상황을 그리고, desc(d)가 곧바로 현실 번역을 준다.
 *  - 실제 조치·용어는 Finding.title/detail이 담당하므로 여기선 절대 정보를 대체하지 않는다.
 *  - 한 룰에 변주를 여러 개 두고, 스캔 결과(파일:줄)로 안정적으로 하나를 고른다
 *    → 같은 문제는 늘 같은 문장(재열람 시 안 바뀜), 다른 프로젝트/위치는 자연히 다른 변주.
 *  - prop은 그 비유에 어울리는 이미지 키. 없으면 구역 기본 프롭(git=열쇠/deploy=상자/cost=기름)을 쓴다.
 * 룰 추가 = 이 표에 한 줄 (없으면 기둥별 폴백으로 안전하게).
 */

/** 브리핑에 띄울 이미지 프롭 키. 신규 프롭은 생성 전까지 구역 기본 프롭으로 폴백된다. */
export type PropKey =
  | 'key' | 'crate' | 'oil'          // 기존(구역 기본)
  | 'shield' | 'antenna' | 'gauge'   // 신규 1순위
  | 'veil' | 'panel' | 'seal';       // 신규 2순위

export interface Vignette {
  /** 카드 헤드라인 — NOVA의 첫 마디 */
  h: string;
  /** 한 줄 상황 설명 — 비유를 현실로 번역 */
  d: string;
  /** 이 비유에 어울리는 이미지 프롭 (선택) */
  prop?: PropKey;
}

/** 룰 ID → 비유 변주 목록. 같은 구역이라도 걸린 룰에 따라 다른 브리핑이 뜬다. */
export const VIGNETTES: Record<string, Vignette[]> = {
  // ── 기둥 1: Git 안전 · 시크릿 (기수 해치) ──
  'secret.denylist-file': [
    { h: '적재 목록에 기밀 상자가 그대로 실려 있어요', d: '이 상자는 발사 전에 내려야 해요. 궤도에 올라가면 지상에서 누구나 열어볼 수 있어요.', prop: 'crate' },
    { h: '봉인해야 할 화물이 열린 채 실렸어요', d: '민감한 값이 든 상자예요. GitHub까지 실려가기 전에 화물칸에서 빼주세요.', prop: 'crate' },
    { h: '이 상자엔 「대외비」 딱지가 붙어 있는데요', d: '발사되면 딱지가 무색해져요 — 지상 관제소 전원이 안을 들여다봐요.', prop: 'crate' },
  ],
  'secret.key-in-file': [
    { h: '선체 외벽에 열쇠가 테이프로 붙어 있어요', d: '소스 코드는 공개되는 외벽이에요. 열쇠는 안쪽 금고(환경변수)에 두고 다녀야 해요.', prop: 'key' },
    { h: '조종석 열쇠를 창밖에 걸어놨어요', d: '코드에 박힌 키는 누구나 복사해 가요. 금고로 옮기고 이 키는 재발급하세요.', prop: 'key' },
  ],
  'secret.b64-credential': [
    { h: '위장막을 씌웠지만… 이건 그냥 반투명이에요', d: 'base64는 잠금장치가 아니라 포장지예요. 누구나 1초 만에 벗겨서 안을 봐요.', prop: 'veil' },
    { h: '얇은 천으로 금고를 덮어놨어요', d: 'base64는 암호화가 아니에요 — 천을 걷으면 아이디·비밀번호가 그대로 보여요.', prop: 'veil' },
  ],
  'secret.example-real-value': [
    { h: '전시용 모형에 진짜 열쇠가 꽂혀 있어요', d: '예시 파일은 관람객에게 공개되는 견본이에요. 열쇠 구멍만 남기고 열쇠는 빼주세요.', prop: 'key' },
  ],
  'git.on-default-branch': [
    { h: '본선에서 곧바로 실험 중이에요', d: '탐사정(브랜치)을 띄우고 거기서 실험하면, 실패해도 본선은 멀쩡해요.' },
    { h: '메인 엔진을 켠 채로 개조하고 있어요', d: '별도 작업선(브랜치)에서 손보면 본선은 언제든 발사 가능한 상태로 지켜져요.' },
  ],
  'git.large-file': [
    { h: '화물칸에 규격 초과 화물이 실렸어요', d: '이대로면 발사대(GitHub)가 적재를 거부해요. 이 화물이 정말 함선에 필요한지 보세요.', prop: 'crate' },
  ],
  'git.node-modules-ignored': [
    { h: '부품 창고를 통째로 싣고 가려 해요', d: '현지에서 다시 조달할 수 있는 부품이에요. 싣지 말고 목록만 가져가면 돼요.', prop: 'crate' },
  ],
  'scan.truncated': [
    { h: '화물이 너무 많아 앞쪽만 검사했어요', d: '이 판정은 전체가 아닌 일부 기준이에요. 창고 화물을 정리하면 전 구역을 볼 수 있어요.' },
  ],

  // ── 기둥 2: 배포 프리플라이트 (화물칸) ──
  'deploy.client-env-leak': [
    { h: '서버용 키가 방문자에게 그대로 보여요', d: 'NEXT_PUBLIC_ 같은 공개 접두사가 붙으면 값이 브라우저에 실려 사이트 방문자 누구나 읽어요. 서버 전용 이름으로 옮기세요.', prop: 'panel' },
    { h: '이 키, 브라우저까지 따라 나가요', d: '공개 접두사가 붙은 값은 클라이언트 번들에 포함돼 노출돼요. 공개해도 되는 값에만 쓰세요.', prop: 'panel' },
    { h: '비밀 키가 공개 이름표를 달고 있어요', d: '이 접두사가 붙으면 값이 방문자 모두의 브라우저로 나가요. 서버 쪽에서만 쓰도록 바꾸세요.', prop: 'panel' },
  ],
  'deploy.debug-mode': [
    { h: '정비 해치를 열어둔 채 발사 시퀀스에 들어갔어요', d: '고장이 나는 순간 내부 배선도와 금고 비밀번호가 관중석에 그대로 중계돼요.', prop: 'panel' },
    { h: '점검 모드를 켠 채 이륙하려 해요', d: '오류가 뜨면 설정과 시크릿이 방문자 화면에 통째로 표시돼요. 배포 전에 꺼야 해요.', prop: 'panel' },
  ],
  'deploy.prod-server': [
    { h: '훈련용 엔진으로 실제 발사를 하려고 해요', d: '개발 서버는 시뮬레이터예요. 실제 궤도에서는 추력도, 방호도 부족해요.' },
  ],
  'deploy.port-binding': [
    { h: '통신 안테나가 함선 안쪽만 향하고 있어요', d: '관제탑(플랫폼)이 부르는 주파수를 못 받아요 — 배포는 됐는데 화면이 안 뜨는 이유예요.', prop: 'antenna' },
    { h: '안테나 방향이 잘못 고정돼 있어요', d: '플랫폼은 정해진 포트로 신호를 보내는데 안테나가 딴 데를 봐요. PORT 환경변수를 읽게 하세요.', prop: 'antenna' },
  ],
  'deploy.hardcoded-secret-key': [
    { h: '함선 인장이 선체에 새겨져 있어요', d: '이 인장을 베끼면 남이 우리 함선인 척 서명할 수 있어요(세션·토큰 위조).', prop: 'seal' },
  ],
  'deploy.cors-wildcard': [
    { h: '도킹 포트가 모든 함선에 개방돼 있어요', d: '아무 사이트나 우리 승무원 자격으로 도킹해요. 아는 함선 목록만 남기세요.', prop: 'shield' },
  ],
  'deploy.migrations-step': [
    { h: '화물 적재 순서서가 발사 계획에 빠졌어요', d: '함선은 새 화물칸을 기대하는데 실제 칸이 안 만들어져 있으면 이륙 직후 오류가 나요.', prop: 'crate' },
  ],
  'deploy.platform-config-secrets': [
    { h: '비행 계획서에 금고 비밀번호를 적어놨어요', d: '이 문서는 함께 공개되는 파일이에요. 비밀번호는 관제탑 금고에 따로 맡기세요.', prop: 'key' },
  ],
  'deploy.platform-state-ignored': [
    { h: '내부 식별표가 선체 바깥에 붙어 있어요', d: '프로젝트·조직 ID 같은 내부 정보가 함께 실려 나가요.' },
  ],
  'deploy.lockfile': [
    { h: '부품 규격서 없이 현지 조달을 맡겼어요', d: '발사장에서 다른 규격 부품이 끼워질 수 있어요 — "내 컴퓨터에선 됐는데"의 정체예요.', prop: 'crate' },
    { h: '자재 명세서가 없어 현장 재량에 맡겼어요', d: '락파일이 없으면 배포 서버가 다른 버전을 설치해요. 명세서(락파일)를 커밋하세요.', prop: 'crate' },
  ],
  'deploy.allowed-hosts-wildcard': [
    { h: '관제 승인 없이 아무 함선이나 도킹을 허용해요', d: '어느 도메인으로 위장한 요청이든 다 받아들여요.', prop: 'shield' },
  ],
  'deploy.dockerignore': [
    { h: '컨테이너를 봉인하는데 기밀 상자가 같이 들어가요', d: '이미지를 받는 사람은 누구나 그 상자를 열 수 있어요.', prop: 'crate' },
  ],
  'deploy.compose-secrets': [
    { h: '정비 매뉴얼에 금고 비밀번호가 적혀 있어요', d: '이 설정 파일은 함께 커밋돼요. 값은 바깥(.env)에 두고 참조만 적으세요.', prop: 'key' },
  ],
  'deploy.firebase-open-rules': [
    { h: '방어막 생성기가 꺼져 있어요 — 격납고가 활짝 열렸어요', d: '인터넷의 누구나 우리 데이터를 읽고 쓰고 지울 수 있어요. 유출과 요금 폭주의 고전 사고예요.', prop: 'shield' },
    { h: '차폐막이 내려가 데이터 격납고가 노출됐어요', d: '보안 규칙이 「전부 허용」이에요 — 누구나 DB를 통째로 드나들어요. 인증 규칙으로 막으세요.', prop: 'shield' },
  ],
  'deploy.supabase-rls': [
    { h: '구역별 차폐막이 내려가 있어요', d: '공개 열쇠 하나로 모든 구역을 드나들 수 있게 돼요. 구역마다 출입 규칙이 필요해요.', prop: 'shield' },
  ],
  'deploy.laravel-app-key': [
    { h: '암호화 코어가 비어 있어요', d: '암호화와 세션이 동작하지 않아요 — 발사 전에 코어를 장착하세요.' },
  ],
  'deploy.rails-master-key': [
    { h: '금고는 실었는데 여는 열쇠가 없어요', d: '관제탑에 열쇠(RAILS_MASTER_KEY)를 등록하지 않으면 함선이 부팅에 실패해요.', prop: 'key' },
  ],
  'deploy.spa-fallback': [
    { h: '귀환 좌표가 없어요 — 깊은 경로가 미아가 돼요', d: '방문자가 하위 주소로 바로 들어오거나 새로고침하면 404를 만나요.' },
  ],
  'deploy.ghpages-base-path': [
    { h: '착륙 좌표가 한 구역씩 어긋나 있어요', d: '프로젝트 사이트는 /레포이름/ 아래에 내려앉아요. 좌표가 없으면 화면이 텅 비어요.' },
  ],
  'deploy.runtime-pin': [
    { h: '엔진 버전을 고정하지 않았어요', d: '발사장이 기본 엔진을 교체하는 날, 예고 없이 빌드가 깨질 수 있어요.' },
  ],
  'deploy.env-example': [
    { h: '보급 목록표가 없어요', d: '어떤 연료·부품이 필요한지 적어두면 관제탑에서 빠뜨리지 않아요.' },
  ],

  // ── 기둥 3: 비용 가드 (엔진·연료) ──
  'cost.service-role-exposed': [
    { h: '마스터 키가 조종석 밖에 걸려 있어요', d: '모든 잠금을 여는 관리자 열쇠예요. 밖에 걸리면 화물칸 전체가 통째로 열려요.', prop: 'key' },
    { h: '만능 열쇠가 외벽에 매달려 있어요', d: 'service_role은 보안 규칙을 전부 우회하는 관리자 키예요. 브라우저에 노출되면 DB가 뚫려요.', prop: 'key' },
  ],
  'cost.rate-limit': [
    { h: '연료 밸브에 유량 제한기가 없어요', d: '누군가 밸브를 계속 돌리면 연료(=내 돈)가 그대로 빠져나가요.', prop: 'oil' },
    { h: '연료 라인이 잠금장치 없이 열려 있어요', d: '공개 엔드포인트가 악용되면 호출당 과금이 폭주해요. 요청 제한을 거세요.', prop: 'oil' },
  ],
  'cost.spend-cap': [
    { h: '연료 차단기를 확인해 주세요', d: '경고등(예산 알림)은 울리기만 해요. 실제로 멈추는 건 차단기(지출 상한)예요.', prop: 'gauge' },
    { h: '자동 차단기가 걸려 있는지 봐주세요', d: '알림은 메일만 와요. 지출 상한을 걸어야 한도에서 요청이 실제로 멈춰요.', prop: 'gauge' },
  ],
  'cost.expensive-model-default': [
    { h: '고급 연료를 상시 분사 중이에요', d: '이 구간에 정말 이 등급이 필요한지 보세요 — 등급만 낮춰도 연비가 크게 달라져요.', prop: 'gauge' },
  ],
};

/** 문제가 없을 때(그 구역 초록불) 구역별 브리핑 */
export const PASS_VIGNETTES: Record<string, Vignette> = {
  git: { h: '기수 해치, 밀폐 상태 양호합니다', d: '기밀 화물이 밖으로 새는 곳이 없어요. 이대로 가면 돼요.' },
  deploy: { h: '화물 적재, 규정대로 실렸습니다', d: '발사장에서 거부당할 만한 적재 문제가 없어요.' },
  cost: { h: '연료 계통, 누유 없이 정상입니다', d: '밸브가 잠겨 있고 유량 제한기도 살아 있어요.' },
};

/**
 * 비유 표에 없는 룰이 걸렸을 때 쓰는 구역별 폴백.
 * 통과 멘트로 폴백하면 "문제가 있는데 정상이라고 말하는" 사고가 나므로 반드시 분리한다.
 */
export const UNKNOWN_VIGNETTES: Record<string, Vignette> = {
  git: { h: '기수 해치 쪽에서 신호가 잡혔어요', d: '아래 항목을 확인해 주세요.' },
  deploy: { h: '화물칸 점검에서 걸린 게 있어요', d: '아래 항목을 확인해 주세요.' },
  cost: { h: '연료 계통에서 확인할 게 있어요', d: '아래 항목을 확인해 주세요.' },
};

/** FNV-1a 기반 안정 해시 — 같은 seed는 늘 같은 인덱스 (재열람 시 문장 안 바뀜) */
export function stableIndex(seed: string, n: number): number {
  if (n <= 1) return 0;
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % n;
}

/**
 * 룰 ID로 변주 목록을 찾는다. 일부 룰은 `cost.spend-cap.openai`처럼 접미사가 붙으므로
 * 정확 일치 → 뒤에서부터 한 단계씩 잘라가며 조회한다.
 */
export function lookupVignettes(ruleId: string): Vignette[] | null {
  let key = ruleId;
  while (key) {
    if (VIGNETTES[key]) return VIGNETTES[key];
    const cut = key.lastIndexOf('.');
    if (cut <= 0) break;
    key = key.slice(0, cut);
  }
  return null;
}

/**
 * 구역 브리핑 선택: 문제 룰이 있으면 그 변주 중 seed로 하나, 없으면 통과 멘트.
 * seed는 보통 `파일:줄`(안정적) — 없으면 ruleId.
 */
export function vignetteFor(ruleId: string | null, pillar: string, seed?: string): Vignette {
  if (!ruleId) return PASS_VIGNETTES[pillar] ?? { h: '점검 완료', d: '이 구역은 이상이 없어요.' };
  const list = lookupVignettes(ruleId);
  if (!list || !list.length) return UNKNOWN_VIGNETTES[pillar] ?? { h: '점검 결과를 확인하세요', d: '아래 항목을 살펴봐 주세요.' };
  return list[stableIndex(seed || ruleId, list.length)];
}
