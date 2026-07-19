/**
 * SafeShip findings 스키마 — 기획서 §5 리포트 생성기의 계약.
 * UI(관제탑), CLI, 훅이 전부 이 형태만 소비한다.
 */

/** 심각도: 발사 관제 문법 그대로 */
export type Severity = 'block' | 'warn' | 'pass' | 'info';

/** 3기둥 (기획서 §2) */
export type Pillar = 'git' | 'deploy' | 'cost';

/** 도구가 직접 실행 가능한 안전 수정 (위험한 리팩터링은 fixPrompt로 위임) */
export type AutoFix = 'gitignore-env' | 'create-branch' | null;

export interface Finding {
  /** 룰 ID, 예: 'git.env-not-ignored' */
  id: string;
  pillar: Pillar;
  severity: Severity;
  /** 초보 눈높이 제목 — 표준 용어는 유지 (기획서 UX 원칙) */
  title: string;
  /** 한 줄 상세. 시크릿 실제 값은 절대 포함하지 않는다(마스킹). */
  detail: string;
  /** 관련 파일 (레포 상대 경로) */
  file?: string;
  line?: number;
  /** 예상 소요 — "약 30초" (Gusto 패턴) */
  effort?: string;
  /** 외부 대시보드 딥링크 (지출 상한 등) */
  deepLink?: string;
  /** 레포만으로 검증 불가 → 사용자 확인 체크형 (비용 가드 B층) */
  clearable?: boolean;
  autoFix?: AutoFix;
  /** "AI로 고치기" — 사용자의 AI에 붙여넣을 완성형 프롬프트 */
  fixPrompt?: string;
}

/** 감지된 스택 정보 (멀티 생태계, 기획서 기둥2) */
export interface StackInfo {
  language: 'js' | 'python' | 'ruby' | 'php' | 'go' | 'rust' | 'static' | 'unknown';
  framework?: string;
  deployTargets: string[];
  /** 비용 가드 A층: 감지된 종량 과금 프로바이더 */
  providers: string[];
}

export interface GitInfo {
  isRepo: boolean;
  branch?: string;
  /** git 바이너리 사용 가능 여부 */
  gitAvailable: boolean;
}

export interface Summary {
  block: number;
  warn: number;
  pass: number;
  info: number;
  /** 발사 관제 판정: block === 0 이면 GO */
  verdict: 'GO' | 'NO-GO';
}

export interface Report {
  schemaVersion: 1;
  scannedAt: string;
  root: string;
  stack: StackInfo;
  git: GitInfo;
  findings: Finding[];
  summary: Summary;
}

/** 룰 인터페이스 — 룰 레지스트리(research/ 데이터)가 이 형태로 이관된다 */
export interface Rule {
  id: string;
  pillar: Pillar;
  /** 이 룰이 이 레포에 적용되는가 (스택 조건) */
  applies?(ctx: ScanContext): boolean;
  run(ctx: ScanContext): Finding[];
}

export interface ScanContext {
  root: string;
  /** 레포 상대 경로 목록 (node_modules/dist/.git 제외, 상한 적용) */
  files: string[];
  /** 크기 상한을 넘거나 바이너리면 null */
  read(relPath: string): string | null;
  exists(relPath: string): boolean;
  pkg: Record<string, unknown> | null;
  deps: Set<string>;
  stack: StackInfo;
  git: GitInfo;
  /** git check-ignore — 레포가 아니거나 git 없으면 null */
  isIgnored(relPath: string): boolean | null;
  /** git ls-files 기반 추적 여부 — .gitignore에 있어도 이미 추적 중이면 보호 안 됨 */
  isTracked(relPath: string): boolean | null;
  /** MAX_FILES 상한으로 스캔이 잘렸는지 */
  truncated: boolean;
}
