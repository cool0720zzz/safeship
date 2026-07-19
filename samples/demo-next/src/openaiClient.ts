// demo fixture — 실제로는 환경변수를 써야 함 (여기선 플레이스홀더)
export const LEGACY_KEY = 'YOUR_OPENAI_KEY';

export async function ask(prompt: string) {
  // rate limit 없음 → cost.rate-limit 경고 재현
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LEGACY_KEY}` },
    body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }] }),
  });
}
