# SafeShip 주요 이미지

앱(함선 관제탑 UI)의 대표 화면 캡처. 재생성: 로컬 서버(127.0.0.1:8778)에 cockpit HTML을 올린 뒤 `puppeteer-core`로 Edge를 몰아 상태별 캡처 (scratchpad/capture.mjs).

| 파일 | 상태 | 설명 |
|---|---|---|
| `01-intro.png` | 인트로 | 관제사 NOVA — "당신의 여정이 준비되었는지 스캔합니다" 히어로 |
| `02-scan.png` | 스캔 브리핑 | 함선 부위별 점검 — 카드에 실제 발견 항목 + "AI로 고치기" |
| `03-verdict-nogo.png` | NO-GO 판정 | 스캔 완료 화면 — 차단 목록 + 잠긴 LAUNCH |
| `04-launch-star.png` | GO 발사 | 안전 통과 → 로켓이 밤하늘로 날아가 별이 됨 |
| `05-overlay-in-use.png` | 실제 사용 | `git push`가 막힌 터미널(2/3) + 오른쪽 1/3에 도킹된 오버레이 패널 — 실제 always-on-top 사용 장면 |

데이터는 데모 레포(safeship-demo / safeship-demo-go) 스캔 결과. 실제로는 push하는 레포의 스캔이 들어간다.
