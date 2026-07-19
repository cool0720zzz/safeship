/**
 * "AI로 고치기" 프롬프트 생성 — 기획서 v0.6 코어 기능.
 * 원칙: 문제 설명 + 해결 단계 + 주의사항 포함, 시크릿 실제 값은 절대 포함 금지.
 */

export function envTrackedPrompt(envFile: string, keyNames: string[]): string {
  const keys = keyNames.length ? keyNames.join(', ') : 'API 키';
  return [
    `내 프로젝트에서 ${envFile} 파일이 git에 올라갈 수 있는 상태야 (안에 ${keys} 등 민감한 값이 있어).`,
    `1) ${envFile}을 .gitignore에 추가해줘`,
    `2) 이미 git 추적 중이면 추적에서만 제거해줘 (git rm --cached ${envFile} — 파일 자체는 남겨둬)`,
    `3) 키가 커밋 이력에 남았을 수 있으니, 해당 서비스 대시보드에서 키를 재발급하는 절차도 단계별로 알려줘.`,
    `주의: 키 값 자체는 절대 출력하지 마.`,
  ].join('\n');
}

export function clientEnvLeakPrompt(varName: string, prefix: string): string {
  return [
    `내 프로젝트에서 ${varName} 환경변수를 클라이언트에서 쓰고 있어.`,
    `${prefix} 접두사가 붙으면 값이 사이트 방문자 모두의 브라우저 번들에 포함된다고 해.`,
    `1) 이 키를 서버 전용 환경변수(접두사 없는 이름)로 바꾸고`,
    `2) 해당 API 호출을 서버 쪽(route handler / server action / API 라우트)으로 옮기고`,
    `3) 클라이언트는 그 서버 엔드포인트를 호출하도록 리팩터링해줘.`,
    `끝나면 클라이언트 번들에 키가 남지 않는지 확인해줘. 키 값 자체는 출력하지 마.`,
  ].join('\n');
}

export function serviceRolePrompt(): string {
  return [
    `내 프로젝트에서 Supabase service_role 키가 클라이언트에 노출될 수 있는 위치에 있어.`,
    `service_role은 RLS(보안 규칙)를 우회하는 관리자 키라 브라우저에 노출되면 안 된대.`,
    `1) 클라이언트에는 anon 키만 남기고`,
    `2) service_role이 필요한 작업은 서버 코드로 옮겨줘`,
    `3) 이미 노출됐을 수 있으니 Supabase 대시보드에서 키를 재발급하는 절차도 알려줘.`,
    `주의: 키 값 자체는 절대 출력하지 마.`,
  ].join('\n');
}

export function secretInCodePrompt(file: string, providerLabel: string): string {
  return [
    `내 프로젝트의 ${file} 파일에 ${providerLabel} API 키로 보이는 값이 하드코딩돼 있어.`,
    `1) 그 값을 코드에서 제거하고 환경변수로 옮겨줘 (.env 사용 + .gitignore 확인)`,
    `2) 코드는 process.env(또는 해당 언어의 환경변수 방식)로 읽게 바꿔줘`,
    `3) 키가 이미 커밋 이력에 있다면 재발급이 필요하다는 점과 절차를 알려줘.`,
    `주의: 키 값 자체는 절대 출력하지 마.`,
  ].join('\n');
}

export function debugModePrompt(framework: string, file: string): string {
  return [
    `내 ${framework} 프로젝트의 ${file}에 디버그 모드가 켜져 있어 (배포되면 에러 화면으로 설정·시크릿이 노출된대).`,
    `1) 디버그 플래그를 환경변수로 읽게 바꾸고, 기본값은 반드시 꺼짐(False)으로 해줘`,
    `2) 로컬 개발에서만 켜는 방법(.env 또는 실행 옵션)을 알려줘`,
    `3) 프로덕션에서 에러가 나면 사용자에겐 일반 에러 페이지만 보이는지 확인해줘.`,
  ].join('\n');
}

export function prodServerPrompt(framework: string): string {
  const server = framework === 'django' ? 'gunicorn (프로젝트.wsgi)' : framework === 'fastapi' ? 'uvicorn --workers (또는 gunicorn -k uvicorn.workers.UvicornWorker)' : 'gunicorn';
  return [
    `내 ${framework} 앱이 개발용 서버로 배포되도록 설정돼 있어.`,
    `1) ${server} 같은 프로덕션 서버를 의존성에 추가하고`,
    `2) 시작 명령(Procfile/render.yaml/Dockerfile CMD)을 프로덕션 서버로 바꿔줘`,
    `3) 0.0.0.0 호스트와 PORT 환경변수로 바인딩하는지도 확인해줘.`,
  ].join('\n');
}

export function portBindPrompt(framework: string): string {
  return [
    `내 ${framework} 앱이 배포 플랫폼에서 트래픽을 못 받을 수 있는 바인딩 설정이야.`,
    `1) 서버가 0.0.0.0 호스트로 리슨하게 바꾸고`,
    `2) 포트는 하드코딩 대신 PORT 환경변수를 읽게 해줘 (플랫폼이 포트를 주입해).`,
    `3) 로컬 기본값(예: 8000)은 PORT가 없을 때만 쓰도록 해줘.`,
  ].join('\n');
}

export function rateLimitPrompt(providers: string[], framework?: string, recommendedPkg?: string): string {
  const pkgLine = recommendedPkg
    ? `2) ${recommendedPkg}를 사용해 per-IP 요청 제한을 추가해줘` +
      (framework === 'next' || framework === 'vite-react'
        ? ' (서버리스 배포라 인메모리 카운터는 안 통해 — 외부 스토어 기반으로)'
        : '')
    : `2) 스택에 맞는 rate limit(예: @upstash/ratelimit, express-rate-limit)을 추가해줘`;
  return [
    `내 프로젝트(${framework ?? 'JS'})는 ${providers.join(', ')} 같은 호출당 과금 API를 쓰는데 rate limit(요청 제한)이 없어.`,
    `공개 엔드포인트가 악용되면 요금이 폭주할 수 있대.`,
    `1) 유료 API를 호출하는 라우트를 찾아서`,
    pkgLine,
    `3) 같은 입력에 대한 반복 호출은 캐시하고, 재시도 로직엔 최대 횟수와 지수 백오프를 걸어줘.`,
  ].join('\n');
}
