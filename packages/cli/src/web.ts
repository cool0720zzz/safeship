/**
 * 관제탑 웹 뷰 (M4 v0) — 스캔 리포트를 함선 스크롤 UI(cockpit.html)에 주입해 띄운다.
 * 기본: 크롬리스 앱 창(주소창·탭 없음)을 화면 오른쪽 패널로 도킹 → "브라우저가 열린" 느낌 대신 "패널이 뜬" 느낌.
 * Edge/Chrome이 없으면 기본 브라우저로 폴백.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { PASS_VIGNETTES, UNKNOWN_VIGNETTES, VIGNETTES } from '@safeship/core';
import type { Report } from '@safeship/core';

/** 크롬리스 앱 모드를 지원하는 브라우저 실행 파일 (Edge 우선 — Win11 기본 탑재) */
function findChromium(): string | null {
  const winPaths = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const macPaths = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  const linuxPaths = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge'];
  const list = process.platform === 'win32' ? winPaths : process.platform === 'darwin' ? macPaths : linuxPaths;
  return list.find((p) => fs.existsSync(p)) ?? null;
}

/** 주 모니터 작업영역(작업표시줄 제외). 실패 시 보편값. */
function workingArea(): { w: number; h: number } {
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; Write-Output "$($b.Width)x$($b.Height)"'],
      { encoding: 'utf8', timeout: 4000 },
    );
    const m = (r.stdout || '').trim().match(/(\d+)x(\d+)/);
    if (m) return { w: +m[1], h: +m[2] };
  }
  return { w: 1440, h: 852 };
}

/** 크롬리스 앱 창을 띄운다 (푸시를 막지 않도록 비동기 detached). 성공 시 true.
 *  mini=false: 화면 오른쪽 1/3 패널 / mini=true: 작업표시줄 위 우하단 작은 카드. */
function openPanel(file: string, mini = false): boolean {
  const browser = findChromium();
  if (!browser) return false;
  const { w: sw, h: sh } = workingArea();
  const pw = mini ? 430 : Math.min(760, Math.max(560, Math.round(sw / 3))); // 대략 1/3, 가독 최소 560
  const ph = mini ? 200 : sh;
  const px = mini ? sw - pw - 14 : sw - pw;
  const py = mini ? sh - ph - 14 : 0;
  const url = 'file:///' + file.replace(/\\/g, '/');
  const profile = path.join(os.tmpdir(), 'safeship-panel-profile'); // 전용 프로필 → 항상 깨끗한 앱 창
  const args = [
    `--app=${url}`,
    `--window-size=${pw},${ph}`,
    `--window-position=${px},${py}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  try {
    const child = spawn(browser, args, { detached: true, stdio: 'ignore' });
    child.unref(); // push가 창을 기다리지 않게
    return true;
  } catch {
    return false;
  }
}

function moduleDir(): string {
  // esbuild CJS 번들에선 __dirname, tsc ESM dist에선 import.meta.url
  if (typeof __dirname !== 'undefined') return __dirname;
  return path.dirname(fileURLToPath(import.meta.url));
}

function findCockpit(): string | null {
  const dir = moduleDir();
  const candidates = [
    path.join(dir, 'cockpit.html'),                    // 번들(bin/) 옆
    path.join(dir, '..', '..', '..', 'webui', 'cockpit.html'), // packages/cli/dist 기준 레포 루트
    path.join(process.cwd(), 'webui', 'cockpit.html'),
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

/** 함선 UI에 실데이터를 그리는 렌더러 — cockpit.html 끝에 주입된다 */
const RENDERER = String.raw`
window.__SAFESHIP_RENDER = function () {
  var R = window.SAFESHIP_REPORT;
  if (!R) return;
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var V = window.SAFESHIP_VIGNETTES || {};
  var PASS = window.SAFESHIP_PASS_VIGNETTES || {};
  var UNK = window.SAFESHIP_UNKNOWN_VIGNETTES || {};
  var PROPS = window.SAFESHIP_PROPS || {};
  // 룰 ID는 'cost.spend-cap.openai'처럼 접미사가 붙기도 한다 — 뒤에서부터 잘라가며 조회
  function lookupVigList(id) {
    var key = id;
    while (key) {
      if (V[key]) return V[key];
      var cut = key.lastIndexOf('.');
      if (cut <= 0) return null;
      key = key.slice(0, cut);
    }
    return null;
  }
  // FNV-1a 안정 해시 — 같은 seed는 늘 같은 변주 (재열람 시 문장 안 바뀜)
  function stableIdx(seed, n) {
    if (n <= 1) return 0;
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % n;
  }
  // 룰의 변주 목록에서 seed(파일:줄)로 하나 고른다
  function pickVig(finding) {
    var list = lookupVigList(finding.id);
    if (!list || !list.length) return null;
    var seed = finding.file ? (finding.file + ':' + (finding.line || 0)) : finding.id;
    return list[stableIdx(seed, list.length)];
  }
  var ORDER = { block: 0, warn: 1, pass: 2, info: 3 };
  var SEVC = { block: 'r', warn: 'a', pass: 'g', info: 'g' };
  var app = document.getElementById('app');

  // 연출은 데이터를 따른다 — 초록불 구역에서는 사고 연출(해치 개방/상자 요동/기름 분출)을 재생하지 않는다.
  var okCss = document.createElement('style');
  okCss.textContent = [
    '.app.ok0 .hatch-door { animation: none !important; }',
    '.app.ok0 .hatch-hole { opacity: 0 !important; }',
    '.app.ok0 .keyimg { animation: none !important; opacity: 0 !important; }',
    '.app.ok1 .crateimg { animation: none !important; }',
    '.app.ok2 .oilimg { animation: none !important; opacity: 0 !important; }',
    '.app.ok2 .s2 .pose-wrench { opacity: 1 !important; animation: tapmove .38s ease 1s 3 !important; }',
    '.app.ok2 .s2 .pose-oil { animation: none !important; opacity: 0 !important; }',
    // 교체 소품 = 부착된 계기: (a) 자기 구역에서만 표시 (문구 나오는 그 구역), (b) 사고 연출 끄고 정적 부유
    '.app.swap0 .keyimg[data-swapped] { opacity: 0 !important; animation: none !important; }',
    '.app.swap0.seg0 .keyimg[data-swapped] { opacity: 1 !important; animation: floaty 3.4s ease-in-out infinite !important; }',
    '.app.swap1 .crateimg { opacity: 0 !important; animation: none !important; }',
    '.app.swap1.seg1 .crateimg { opacity: 1 !important; animation: floaty 3.4s ease-in-out infinite !important; }',
    '.app.swap2 .oilimg { opacity: 0 !important; animation: none !important; }',
    '.app.swap2.seg2 .oilimg { opacity: 1 !important; animation: floaty 3.4s ease-in-out infinite !important; }',
    // NOVA 사고 포즈(놀람 리코일/기름범벅) 끄고 부유하며 들여다봄 (nova-scene은 이미 seg별로 게이트됨)
    '.app.swap0 .s0 .nova-hold, .app.swap1 .s1 .nova-hold { animation: floaty 3.2s ease-in-out infinite !important; }',
    '.app.swap2 .s2 .pose-oil { display: none !important; }',
    '.app.swap2 .s2 .pose-wrench { opacity: 1 !important; animation: floaty 3.2s ease-in-out infinite !important; }',
    // 좁은 패널(오버레이 등 ≤900px)에선 함선 본체 교체 소품이 배와 안 맞물려 떠다녀서 숨긴다.
    // 비유 이미지는 카드 옆 아이콘(zoomlens, 위치 안정)이 담당한다.
    '@media (max-width: 900px) { .keyimg[data-swapped], .crateimg[data-swapped], .oilimg[data-swapped] { display: none !important; } }',
  ].join('\n');
  document.head.appendChild(okCss);
  var idleNova = document.querySelector('.intro-nova img');
  var IDLE_SRC = idleNova ? idleNova.getAttribute('src') : null;
  var SEGS = [
    { i: 0, co: 'co0', pillar: 'git', name: '기수 해치' },
    { i: 1, co: 'co1', pillar: 'deploy', name: '화물칸' },
    { i: 2, co: 'co2', pillar: 'cost', name: '엔진·연료' },
  ];

  // HUD: 프로젝트명 + 스택 + 판정
  var proj = String(R.root).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'my-project';
  var stack = (R.stack.framework || R.stack.language) +
    (R.stack.deployTargets.length ? ' → ' + R.stack.deployTargets.join(', ') : '');
  var pill = document.querySelector('.hud .proj');
  if (pill) pill.textContent = proj + ' 호 · ' + stack;
  var isGo = R.summary.verdict === 'GO';
  var vchip = document.getElementById('vchip');
  if (vchip && !isGo) vchip.textContent = 'NO-GO · 차단 ' + R.summary.block;

  // 세그먼트 카드: 기둥별 findings 주입
  SEGS.forEach(function (sg) {
    var card = document.querySelector('#' + sg.co + ' .ccard');
    if (!card) return;
    var items = R.findings.filter(function (f) { return f.pillar === sg.pillar; })
      .sort(function (a, b) { return ORDER[a.severity] - ORDER[b.severity]; });
    var show = items.filter(function (f) { return f.severity !== 'info'; }).slice(0, 4);

    // NOVA 브리핑: 이 구역에서 가장 심각한 룰의 비유로 말한다 (문제 없을 때만 통과 멘트)
    var lead = items.filter(function (f) { return f.severity === 'block'; })[0]
      || items.filter(function (f) { return f.severity === 'warn'; })[0];
    var vig = lead ? (pickVig(lead) || UNK[sg.pillar]) : PASS[sg.pillar];

    // 비유에 어울리는 이미지 프롭으로 교체 (신규 프롭 이미지가 있을 때만; 없으면 구역 기본 소품)
    if (vig && vig.prop && PROPS[vig.prop]) {
      var propSrc = PROPS[vig.prop];
      // 1) 카드 옆 아이콘(zoomlens)
      var lens = document.querySelector('#' + sg.co + ' .zoomlens img');
      if (lens) lens.setAttribute('src', propSrc);
      // 2) 함선 본체의 그 구역 소품(해치 열쇠 / 화물칸 상자 / 밸브 기름) — 가장 눈에 띄는 자리
      var shipSel = ['.keyimg', '.crateimg', '.oilimg'][sg.i];
      document.querySelectorAll(shipSel).forEach(function (el, idx) {
        if (sg.i === 0 && idx > 0) { el.style.display = 'none'; return; } // 열쇠 3개는 하나로 대체
        el.setAttribute('src', propSrc);
        el.setAttribute('data-swapped', '1');
      });
      // 3) 교체 소품은 '사고'가 아니라 '부착된 계기' — 사고 연출을 끄고(swap CSS) NOVA는 들여다보는 포즈로
      app.classList.add('swap' + sg.i);
      // 밸브(cost) 슬롯은 NOVA와 겹쳐 가려지므로, 계기를 엔진 상단 하울로 올려 부착 + NOVA 위(z)
      if (sg.i === 2) {
        document.querySelectorAll('.oilimg').forEach(function (g) {
          g.style.left = '76%'; g.style.top = '43%'; g.style.width = '14%'; g.style.zIndex = '6';
        });
      }
      var scene2 = document.querySelector('.nova-scene.s' + sg.i);
      if (scene2 && PROPS.point) {
        var poses = scene2.querySelectorAll('.nova-hold img');
        poses.forEach(function (pi, k) {
          if (k > 0) { pi.style.display = 'none'; return; }   // seg2는 포즈 2개 → 하나만
          pi.setAttribute('src', PROPS.point);
          pi.setAttribute('alt', '계기를 살펴보는 NOVA');
        });
        var em2 = scene2.querySelector('.emote');
        if (em2) em2.textContent = '🔍';
      }
    }

    // 이 구역이 초록불이면 사고 연출을 끄고 NOVA도 평온한 포즈로 (연출 ↔ 데이터 일치)
    if (!lead) {
      app.classList.add('ok' + sg.i);
      var anchor2 = document.getElementById('an' + sg.i);
      if (anchor2) anchor2.classList.add('ok');
      var scene = document.querySelector('.nova-scene.s' + sg.i);
      if (scene) {
        var emote = scene.querySelector('.emote');
        if (emote) emote.textContent = '✅';
        if (sg.i !== 2 && IDLE_SRC) {
          var poseImg = scene.querySelector('.nova-hold img');
          if (poseImg) {
            poseImg.setAttribute('src', IDLE_SRC);
            poseImg.setAttribute('alt', '평온하게 점검을 마친 NOVA');
          }
        }
      }
    }
    if (vig) {
      var h3 = card.querySelector('h3');
      var desc = card.querySelector('.desc');
      if (h3) h3.textContent = vig.h;
      if (desc) desc.textContent = vig.d;
    }
    card.querySelectorAll('.chk').forEach(function (el) { el.remove(); });
    var anchor = card.querySelector('.cbtns');
    show.forEach(function (f) {
      var div = document.createElement('div');
      div.className = 'chk ' + (SEVC[f.severity] || 'g');
      var small = [f.detail, f.effort].filter(Boolean).join(' · ');
      if (small.length > 120) small = small.slice(0, 120) + '…';
      div.innerHTML = '<span class="s"></span><div class="t">' + esc(f.title) + '<small>' + esc(small) + '</small></div>';
      card.insertBefore(div, anchor);
    });
    if (show.length === 0 && items.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'chk g';
      empty.innerHTML = '<span class="s"></span><div class="t">이 구역은 점검할 항목이 없어요<small>해당되는 위험 요소가 감지되지 않았어요 — 통과</small></div>';
      card.insertBefore(empty, anchor);
    }
    var more = items.length - show.length;
    if (more > 0) {
      var m = document.createElement('div');
      m.className = 'chk g';
      m.innerHTML = '<span class="s"></span><div class="t"><small>+ 항목 ' + more + '개 — 터미널 리포트에서 전체 확인</small></div>';
      card.insertBefore(m, anchor);
    }
    // "AI로 고치기" = 이 구역 첫 fixPrompt 클립보드 복사
    var fix = null;
    for (var i = 0; i < items.length; i++) { if (items[i].fixPrompt) { fix = items[i].fixPrompt; break; } }
    card.querySelectorAll('.cb').forEach(function (b) {
      if (b.classList.contains('ai') && fix) {
        b.addEventListener('click', function () {
          var done = function () { b.textContent = '복사됨 ✓ AI 채팅에 붙여넣으세요'; setTimeout(function () { b.textContent = 'AI로 고치기'; }, 2400); };
          if (navigator.clipboard) navigator.clipboard.writeText(fix).then(done, function () { window.prompt('복사해서 AI에게 붙여넣으세요:', fix); });
          else window.prompt('복사해서 AI에게 붙여넣으세요:', fix);
        });
      } else {
        b.style.display = 'none';
      }
    });
  });

  // 피날레: 차단 목록 + 판정
  var segIdx = { git: 0, deploy: 1, cost: 2 };
  var blocks = R.findings.filter(function (f) { return f.severity === 'block'; });
  var list = document.getElementById('finList');
  var journey = document.getElementById('journey');
  var segs = [[0.05, 0.30], [0.34, 0.59], [0.63, 0.86]];
  function yFor(p) {
    var total = journey.offsetHeight - window.innerHeight;
    var top = journey.getBoundingClientRect().top + window.scrollY;
    return top + p * total;
  }
  // 수동 스무스 스크롤 — 일부 환경에서 window.scrollTo({behavior:'smooth'})가 애니메이션되지 않아
  // rAF로 직접 보간한다(매 프레임 instant scrollTo). 접근성: reduced-motion이면 즉시 점프.
  function smoothTo(target) {
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { window.scrollTo(0, target); return; }
    var start = window.scrollY, dist = target - start, dur = 520, t0 = null, done = false;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
      window.scrollTo(0, Math.round(start + dist * e));
      if (p < 1) requestAnimationFrame(step); else done = true;
    }
    requestAnimationFrame(step);
    // rAF가 굶는 환경(백그라운드 탭 등)에서도 최종 위치는 반드시 도달
    setTimeout(function () { if (!done && Math.abs(window.scrollY - target) > 4) window.scrollTo(0, target); }, dur + 260);
  }
  if (list) {
    list.innerHTML = '';
    if (blocks.length === 0) {
      var ok = document.createElement('div');
      ok.className = 'fin-item done';
      ok.innerHTML = '<span class="d"></span>차단 항목 없음 — 모든 구역 초록불';
      list.appendChild(ok);
    } else {
      blocks.slice(0, 4).forEach(function (f) {
        var si = segIdx.hasOwnProperty(f.pillar) ? segIdx[f.pillar] : 0;
        var name = SEGS[si].name;
        var d = document.createElement('div');
        d.className = 'fin-item';
        d.setAttribute('data-seg', si);   // CSS cursor:pointer + hover 강조 적용
        d.setAttribute('role', 'button');
        d.setAttribute('tabindex', '0');
        d.innerHTML = '<span class="d"></span>' + esc(name + ' — ' + f.title) + ' <span class="jump">브리핑 다시 보기 ↩</span>';
        var jump = function () { smoothTo(yFor((segs[si][0] + segs[si][1]) / 2)); };
        d.addEventListener('click', jump);
        d.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jump(); }
        });
        list.appendChild(d);
      });
      if (blocks.length > 4) {
        var rest = document.createElement('div');
        rest.className = 'fin-item';
        rest.innerHTML = '<span class="d"></span>외 차단 ' + (blocks.length - 4) + '건 — 터미널 리포트 참조';
        list.appendChild(rest);
      }
    }
  }
  var sum = document.querySelector('.fin-in .sum');
  var sim = document.getElementById('simBtn');
  if (isGo) {
    if (sim) sim.click(); // allgreen + LAUNCH 활성화 + 게이트 해제(내부 상태 재사용)
    if (sum) sum.textContent = '모든 점검을 통과했어요 — 안전하게 세상에 별 하나를 띄웁니다.';
    // GO 축하: push가 통과하면 피날레로 이동해 발사 → 별 연출을 자동 재생 (보상의 순간)
    if (window.SAFESHIP_CELEBRATE) {
      setTimeout(function () {
        var j = document.getElementById('journey');
        var total = j.offsetHeight - window.innerHeight;
        var top = j.getBoundingClientRect().top + window.scrollY;
        window.scrollTo(0, Math.round(top + 0.96 * total)); // 피날레로
        window.dispatchEvent(new Event('scroll'));
        setTimeout(function () {
          var lb = document.getElementById('launch');
          if (lb && !lb.disabled) lb.click(); // 🚀 발사 → 밤하늘로 날아가 별이 된다
        }, 1500);
      }, 1100);
    }
  } else {
    if (sim && sim.parentElement) sim.parentElement.style.display = 'none';
    if (sum) sum.textContent = '차단 ' + R.summary.block + '건을 해결하면 판정이 GO로 바뀌어요. 각 카드의 "AI로 고치기"를 붙여넣으면 돼요.';
  }
};
`;

/** webui/props/<키>.webp 를 data URI로 읽어 프롭 맵을 만든다 (없으면 빈 맵 → 구역 기본 프롭). */
function loadProps(cockpitPath: string): Record<string, string> {
  const props: Record<string, string> = {};
  const dir = path.join(path.dirname(cockpitPath), 'props');
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return props; }
  for (const name of names) {
    const m = name.match(/^([a-z]+)\.(webp|png)$/i);
    if (!m) continue;
    try {
      const b64 = fs.readFileSync(path.join(dir, name)).toString('base64');
      const mime = m[2].toLowerCase() === 'png' ? 'image/png' : 'image/webp';
      props[m[1]] = `data:${mime};base64,${b64}`;
    } catch { /* 무시 */ }
  }
  return props;
}

/** 데스크톱 오버레이 크롬 — 창 컨트롤(닫기/투명도/드래그) + 리포트 런타임 fetch + 오른쪽 도킹 슬라이드인.
 *  정적 UI/렌더러는 index.html에 구워지고, 실제 리포트는 Tauri 커맨드 read_report로 런타임에 받는다. */
/** 미니 UI(작업표시줄 위 작은 카드)의 스타일 + 마크업. 데스크톱 앱/브라우저 패널 공용. */
const MINI_UI = String.raw`
<style>
  /* 카드 높이는 200px로 고정 — 설정을 열면 창만 아래로 늘어나고 카드는 그대로 보인다 */
  #ss-mini { position: fixed; top: 0; left: 0; right: 0; height: 200px; display: none;
    padding: 8px; box-sizing: border-box; z-index: 100001; }
  body.ss-mini-mode #ss-mini { display: block; }
  body.ss-mini-mode #app, body.ss-mini-mode #ss-drag, body.ss-mini-mode #ss-ctrl { display: none !important; }
  body.ss-mini-mode { overflow: hidden; }
  .m-card { height: 100%; box-sizing: border-box; border-radius: 15px; padding: 12px 14px;
    background: linear-gradient(160deg, #161d38 0%, #0d1122 100%);
    border: 1px solid rgba(120,140,220,.30); box-shadow: 0 12px 34px rgba(0,0,0,.55);
    display: flex; flex-direction: column; gap: 9px; color: #cdd6ff; }
  .m-top { display: flex; align-items: center; gap: 8px; }
  .m-brand { font-weight: 800; font-size: 12.5px; letter-spacing: .01em; }
  .m-x { margin-left: auto; width: 22px; height: 20px; border: none; border-radius: 6px; cursor: pointer;
    background: rgba(255,255,255,.09); color: #cdd6ff; font-size: 11px; font-family: inherit; }
  .m-x:hover { background: rgba(255,93,100,.85); color: #fff; }
  .m-body { display: flex; gap: 12px; align-items: center; }
  .m-nova { width: 54px; flex: none; filter: drop-shadow(0 5px 12px rgba(0,0,0,.5)); }
  .m-verdict { font-weight: 800; font-size: 14.5px; margin-bottom: 3px; }
  .m-verdict.go { color: #9ece6a; } .m-verdict.nogo { color: #ff8d92; }
  .m-lead { font-size: 12px; color: #aab3d8; line-height: 1.45; word-break: keep-all; }
  .m-more { font-size: 11px; color: #6b74a0; margin-top: 3px; }
  .m-btns { display: flex; gap: 6px; margin-top: auto; }
  .m-btn { flex: 1; padding: 8px 10px; border: none; border-radius: 9px; cursor: pointer;
    font-size: 12px; font-weight: 700; font-family: inherit;
    background: rgba(255,255,255,.10); color: #cdd6ff; transition: filter .15s; }
  .m-btn.primary { background: linear-gradient(180deg, #4c6bff, #3448c9); color: #fff; }
  .m-btn:hover { filter: brightness(1.18); }
</style>
<div id="ss-mini"><div class="m-card" data-tauri-drag-region>
  <div class="m-top"><span class="m-brand">🚀 SafeShip</span><button class="m-x" id="m-close" title="닫기">✕</button></div>
  <div class="m-body">
    <img class="m-nova" id="m-nova" alt="관제사 NOVA">
    <div>
      <div class="m-verdict" id="m-verdict"></div>
      <div class="m-lead" id="m-lead"></div>
      <div class="m-more" id="m-more"></div>
    </div>
  </div>
  <div class="m-btns"><button class="m-btn primary" id="m-detail">자세히 보기</button></div>
</div></div>
<script>
// 리포트 → 미니 카드 채우기 (전체 UI에 인라인된 NOVA 이미지를 그대로 재사용)
window.__SS_FILL_MINI = function () {
  var R = window.SAFESHIP_REPORT || {}, s = R.summary || {};
  var go = s.verdict === 'GO';
  var blocks = (R.findings || []).filter(function (f) { return f.severity === 'block'; });
  var v = document.getElementById('m-verdict');
  v.className = 'm-verdict ' + (go ? 'go' : 'nogo');
  v.textContent = go ? '✅ 안전합니다 · GO' : '🛑 차단 ' + (s.block || blocks.length) + '건 — push를 멈췄어요';
  document.getElementById('m-lead').textContent = go
    ? '안전하게 세상에 별 하나를 띄웠어요.'
    : (blocks[0] ? blocks[0].title : '문제를 확인해 주세요.');
  var more = blocks.length - 1;
  document.getElementById('m-more').textContent = (!go && more > 0) ? '+ ' + more + '건 더' : '';
  var pick = go
    ? (document.querySelector('.cap-nova img') || document.querySelector('.fin-nova .salute'))
    : (document.querySelector('.fin-nova .sad') || document.querySelector('.intro-nova img'));
  var src = pick && pick.getAttribute('src');
  if (src) document.getElementById('m-nova').setAttribute('src', src);
  return go;
};
</script>`;

/** 표시 방식 설정 UI(톱니 + 팝오버). 데스크톱 앱/브라우저 패널 공용.
 *  두 경로가 각각 구현해 넘겨주는 훅에 의존한다:
 *   - window.__SS_APPLY_MODE(mode) : 지금 창을 그 모양으로 바꾼다 (필수)
 *   - window.__SS_SAVE_MODE(mode)  : 기본값으로 저장 (없으면 터미널 명령으로 안내) */
const SETTINGS_UI = String.raw`
<style>
  /* 전체 화면에서는 상단 칩들을 가리지 않도록 우하단에 띄운다 */
  #ss-gear { position: fixed; bottom: 14px; right: 14px; z-index: 100002;
    width: 32px; height: 32px; border: none; border-radius: 50%; cursor: pointer;
    background: rgba(26,33,64,.86); color: #cdd6ff; font-size: 14px; line-height: 1; font-family: inherit;
    border: 1px solid rgba(120,140,220,.28);
    backdrop-filter: blur(6px); box-shadow: 0 4px 14px rgba(0,0,0,.45); transition: background .15s; }
  #ss-gear:hover { background: rgba(48,60,108,.95); }
  /* 미니에서는 카드 헤더의 ✕ 옆으로 */
  body.ss-mini-mode #ss-gear { bottom: auto; top: 17px; right: 44px;
    width: 22px; height: 20px; border-radius: 6px; font-size: 11px;
    background: rgba(255,255,255,.09); border-color: transparent; box-shadow: none; }
  #ss-pop { position: fixed; bottom: 54px; right: 14px; z-index: 100003; width: 262px;
    background: linear-gradient(160deg, #1a2140, #11162b); color: #cdd6ff;
    border: 1px solid rgba(120,140,220,.32); border-radius: 13px; padding: 11px;
    box-shadow: 0 14px 36px rgba(0,0,0,.6); display: flex; flex-direction: column; gap: 6px; }
  #ss-pop[hidden] { display: none; }
  /* 미니에서는 카드 바로 아래에 붙여 카드를 가리지 않는다 (창이 그만큼 늘어남) */
  body.ss-mini-mode #ss-pop { top: 204px; left: 10px; right: 10px; bottom: auto; width: auto; }
  .p-title { font-size: 11.5px; color: #8f99c4; font-weight: 700; margin-bottom: 2px; }
  .p-opt { text-align: left; border: 1px solid transparent; border-radius: 9px; padding: 8px 10px;
    background: rgba(255,255,255,.055); color: #cdd6ff; cursor: pointer; font-family: inherit;
    display: flex; flex-direction: column; gap: 2px; transition: background .15s, border-color .15s; }
  .p-opt:hover { background: rgba(255,255,255,.11); }
  .p-opt.on { border-color: #4c6bff; background: rgba(76,107,255,.17); }
  .p-opt b { font-size: 12.5px; font-weight: 800; }
  .p-opt b::after { content: ''; }
  .p-opt.on b::after { content: '  ✓'; color: #7f9cff; }
  .p-opt span { font-size: 11px; color: #98a2cc; }
  .p-note { font-size: 10.5px; line-height: 1.5; color: #8f99c4; margin-top: 2px; word-break: keep-all; }
  .p-note.ok { color: #9ece6a; }
  .p-note code { background: rgba(255,255,255,.10); padding: 1px 5px; border-radius: 4px;
    font-size: 10px; user-select: all; }
</style>
<button id="ss-gear" title="표시 방식 설정">⚙</button>
<div id="ss-pop" hidden>
  <div class="p-title">다음부터 이렇게 보여드릴까요?</div>
  <button class="p-opt" data-mode="full"><b>전체 화면</b><span>함선을 둘러보며 자세히</span></button>
  <button class="p-opt" data-mode="mini"><b>미니 카드</b><span>작업표시줄 위에 작게</span></button>
  <div class="p-note" id="ss-pop-note">지금 창에도 바로 적용돼요.</div>
</div>
<script>
(function () {
  var gear = document.getElementById('ss-gear');
  var pop = document.getElementById('ss-pop');
  var note = document.getElementById('ss-pop-note');
  var opts = [].slice.call(pop.querySelectorAll('.p-opt'));

  function mark() {
    var cur = document.body.classList.contains('ss-mini-mode') ? 'mini' : 'full';
    opts.forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === cur); });
  }
  gear.addEventListener('click', function (e) {
    e.stopPropagation();
    // 설정을 만지는 중엔 GO 자동 닫힘을 멈춘다
    if (window.__ssAutoClose) { clearTimeout(window.__ssAutoClose); window.__ssAutoClose = null; }
    pop.hidden = !pop.hidden;
    mark();
    sync();
  });
  document.addEventListener('click', function (e) {
    if (!pop.hidden && !pop.contains(e.target) && e.target !== gear) { pop.hidden = true; sync(); }
  });

  // 미니에서 설정을 열면 창을 늘려 카드 아래에 펼친다 (호스트가 __SS_POPOVER를 구현)
  function sync() { try { window.__SS_POPOVER && window.__SS_POPOVER(!pop.hidden); } catch (e) {} }

  opts.forEach(function (b) {
    b.addEventListener('click', function () {
      var m = b.getAttribute('data-mode');
      try { window.__SS_APPLY_MODE && window.__SS_APPLY_MODE(m); } catch (e) { console.error(e); }
      mark();
      sync(); // 모드가 바뀌면 창 크기도 다시 맞춘다
      if (window.__SS_SAVE_MODE) {
        Promise.resolve(window.__SS_SAVE_MODE(m)).then(function () {
          note.className = 'p-note ok';
          note.textContent = '저장했어요 — 다음 push부터 이렇게 보여드릴게요.';
        }, function (err) {
          note.className = 'p-note';
          note.textContent = '저장하지 못했어요: ' + err;
        });
      } else {
        // 브라우저 패널은 파일을 쓸 수 없다 → 같은 일을 하는 명령을 안내
        note.className = 'p-note';
        note.innerHTML = '이 창에만 적용됐어요. 계속 이렇게 보려면 터미널에서 <code>safeship config ui '
          + m + '</code>';
      }
    });
  });
  mark();
})();
</script>`;

const OVERLAY_CHROME = String.raw`
<style>
  #ss-ctrl { position: fixed; top: 6px; right: 8px; z-index: 100000; display: flex; gap: 5px; }
  #ss-ctrl button { width: 26px; height: 24px; border: none; border-radius: 7px; cursor: pointer;
    background: rgba(20,26,52,.72); color: #cdd6ff; font-size: 14px; line-height: 1;
    backdrop-filter: blur(4px); box-shadow: 0 1px 4px rgba(0,0,0,.4); transition: background .15s; }
  #ss-ctrl button:hover { background: rgba(40,50,90,.92); }
  #ss-close:hover { background: rgba(255,93,100,.85); color: #fff; }
  #ss-drag { position: fixed; top: 0; left: 0; right: 78px; height: 30px; z-index: 99998; }
</style>
<div id="ss-drag" data-tauri-drag-region></div>
<div id="ss-ctrl">
  <button id="ss-op" title="투명도 조절">◐</button>
  <button id="ss-close" title="닫기">✕</button>
</div>
` + MINI_UI + SETTINGS_UI + String.raw`
<script>
(async function () {
  var T = window.__TAURI__;
  var P = {};
  // 1) 실제 리포트를 런타임에 받아 주입
  if (T && T.core && T.core.invoke) {
    try {
      P = JSON.parse((await T.core.invoke('read_report')) || '{}');
      if (P && P.report) { window.SAFESHIP_REPORT = P.report; window.SAFESHIP_CELEBRATE = !!P.celebrate; }
    } catch (e) { console.error('read_report:', e); }
  }
  // 전체 UI는 미리 렌더해둔다 (미니에서 '자세히 보기' 누르면 바로 펼쳐지게)
  try { window.__SAFESHIP_RENDER && window.__SAFESHIP_RENDER(); } catch (e) { console.error('render:', e); }

  var ctrl = document.getElementById('ss-ctrl'), drag = document.getElementById('ss-drag');
  var miniEl = document.getElementById('ss-mini'), gearEl = document.getElementById('ss-gear');
  if (!T || !T.window) {
    // 데스크톱 index.html을 일반 브라우저로 연 경우 — 창 제어를 못 하니 크롬을 숨긴다
    [ctrl, drag, miniEl, gearEl].forEach(function (el) { if (el) el.style.display = 'none'; });
    return;
  }
  var W = T.window, win = W.getCurrentWindow();

  // 창 컨트롤(전체 UI)
  var ops = [1, 0.85, 0.7], oi = 0;
  document.getElementById('ss-op').addEventListener('click', function () {
    oi = (oi + 1) % ops.length; document.documentElement.style.opacity = ops[oi];
  });
  document.getElementById('ss-close').addEventListener('click', function () { win.close(); });
  document.getElementById('m-close').addEventListener('click', function () { win.close(); });

  // 화면 크기: payload의 작업영역(작업표시줄 제외) 우선 → 미니가 작업표시줄 위에 정확히 앉는다
  var sw, sh;
  if (P.screen && P.screen.w) { sw = P.screen.w; sh = P.screen.h; }
  else {
    var mon = await W.currentMonitor();
    if (!mon) { var all = await W.availableMonitors(); mon = all && all[0]; }
    var sf = (mon && mon.scaleFactor) || 1;
    sw = Math.round((mon ? mon.size.width : 1440) / sf);
    sh = Math.round((mon ? mon.size.height : 900) / sf) - 48; // 작업표시줄 여유
  }

  function slideX(fromX, toX, y, dur) {
    var t0 = null;
    function step(ts) {
      if (t0 === null) t0 = ts;
      var pr = Math.min(1, (ts - t0) / (dur || 420));
      var e = 1 - Math.pow(1 - pr, 3);
      win.setPosition(new W.LogicalPosition(Math.round(fromX + (toX - fromX) * e), y));
      if (pr < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
    setTimeout(function () { win.setPosition(new W.LogicalPosition(toX, y)); }, (dur || 420) + 220);
  }

  // ── 전체 UI: 오른쪽 1/3 도킹 ──
  async function showFull(animate) {
    document.body.classList.remove('ss-mini-mode');
    if (window.__ssAutoClose) { clearTimeout(window.__ssAutoClose); window.__ssAutoClose = null; }
    var pw = Math.min(760, Math.max(560, Math.round(sw / 3)));
    var tx = sw - pw;
    await win.setSize(new W.LogicalSize(pw, sh));
    if (animate) { await win.setPosition(new W.LogicalPosition(sw, 0)); await win.show(); slideX(sw, tx, 0); }
    else { await win.setPosition(new W.LogicalPosition(tx, 0)); await win.show(); }
    try { await win.setAlwaysOnTop(true); } catch (e) {}
  }

  // ── 미니 UI: 작업표시줄 위 우하단 카드 ──
  async function showMini(animate) {
    document.body.classList.add('ss-mini-mode');
    var isGo = window.__SS_FILL_MINI();
    var mw = 430, mh = 200, gap = 14;
    var tx = sw - mw - gap, ty = sh - mh - gap;
    await win.setSize(new W.LogicalSize(mw, mh));
    if (animate) { await win.setPosition(new W.LogicalPosition(sw, ty)); await win.show(); slideX(sw, tx, ty); }
    else { await win.setPosition(new W.LogicalPosition(tx, ty)); await win.show(); }
    try { await win.setAlwaysOnTop(true); } catch (e) {}
    // 통과했으면 잠깐 보여주고 스스로 사라짐 (방해 최소화)
    if (isGo) window.__ssAutoClose = setTimeout(function () {
      if (document.body.classList.contains('ss-mini-mode')) win.close();
    }, 6500);
  }

  // 설정 UI가 쓰는 훅: 지금 창 모양 바꾸기 + 기본값 저장(~/.safeship.json)
  window.__SS_APPLY_MODE = function (mode) {
    return mode === 'mini' ? showMini(false) : showFull(false);
  };
  window.__SS_SAVE_MODE = function (mode) { return T.core.invoke('save_ui_mode', { mode: mode }); };
  // 미니에서 설정을 펼치면 창을 아래로 늘려 카드를 가리지 않게 한다
  window.__SS_POPOVER = async function (open) {
    if (!document.body.classList.contains('ss-mini-mode')) return;
    var mw = 430, gap = 14, h = open ? 412 : 200;
    await win.setSize(new W.LogicalSize(mw, h));
    await win.setPosition(new W.LogicalPosition(sw - mw - gap, sh - h - gap));
  };

  // 미니 → 전체로 펼치기
  document.getElementById('m-detail').addEventListener('click', function () { showFull(false); });

  try { if (P.mini) await showMini(true); else await showFull(true); }
  catch (e) { console.error('overlay layout:', e); }
})();
</script>
</body>`;

/** Tauri 오버레이 앱 실행 파일을 찾는다 (env 우선, 아니면 레포 상대 경로). */
function findOverlayExe(): string | null {
  const env = process.env.SAFESHIP_OVERLAY_EXE;
  if (env && fs.existsSync(env)) return env;
  const base = moduleDir();
  const names = process.platform === 'win32' ? ['SafeShip.exe', 'desktop.exe'] : ['SafeShip', 'desktop'];
  const roots = [
    // 레포에서 직접 빌드한 경우
    path.join(base, '..', 'desktop', 'src-tauri', 'target', 'release'),
    path.join(base, '..', 'desktop', 'src-tauri', 'target', 'debug'),
    path.join(base, '..', '..', 'desktop', 'src-tauri', 'target', 'release'),
  ];
  if (process.platform === 'win32') {
    // 설치 파일(NSIS)로 설치한 경우의 표준 위치
    if (process.env.LOCALAPPDATA) roots.push(path.join(process.env.LOCALAPPDATA, 'SafeShip'));
    if (process.env.ProgramFiles) roots.push(path.join(process.env.ProgramFiles, 'SafeShip'));
  }
  for (const r of roots) for (const n of names) {
    const p = path.join(r, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** pre-push 훅용: Tauri 오버레이 앱을 실제 스캔 payload와 함께 띄운다. 성공 시 true.
 *  앱이 없으면 false → 호출부가 브라우저 패널로 폴백. */
export function openOverlayApp(report: Report, opts?: { celebrate?: boolean; mini?: boolean }): boolean {
  const exe = findOverlayExe();
  if (!exe) return false;
  // screen: 작업표시줄을 제외한 작업영역 — 미니 카드가 작업표시줄 위에 정확히 앉도록 함께 넘긴다
  const payload = { report, celebrate: !!opts?.celebrate, mini: !!opts?.mini, screen: workingArea() };
  const file = path.join(os.tmpdir(), `safeship-payload-${Date.now()}.json`);
  try {
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    const child = spawn(exe, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, SAFESHIP_PAYLOAD: file },
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/** 데스크톱 오버레이용 index.html 생성 (정적 UI + 렌더러 + 프롭/비네트 굽고, 리포트는 런타임 fetch). */
export function renderDesktopIndex(): string {
  const cockpitPath = findCockpit();
  if (!cockpitPath) throw new Error('cockpit.html를 찾지 못했어요 (webui/cockpit.html)');
  const html = fs.readFileSync(cockpitPath, 'utf8');
  const props = loadProps(cockpitPath);
  const safe = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  const staticData =
    `window.SAFESHIP_VIGNETTES=${safe(VIGNETTES)};` +
    `window.SAFESHIP_PASS_VIGNETTES=${safe(PASS_VIGNETTES)};` +
    `window.SAFESHIP_UNKNOWN_VIGNETTES=${safe(UNKNOWN_VIGNETTES)};` +
    `window.SAFESHIP_PROPS=${safe(props)};`;
  const inject = `<script>${staticData}</script>\n<script>${RENDERER}</script>\n${OVERLAY_CHROME}`;
  return html.replace('</body>', inject);
}

/** 리포트를 주입한 관제탑 HTML을 만들어 기본 브라우저로 연다. 성공 시 파일 경로 반환.
 *  opts.celebrate: GO push 축하 모드 — 피날레로 이동해 발사→별 연출을 자동 재생. */
export function openCockpit(report: Report, opts?: { celebrate?: boolean; mini?: boolean }): string | null {
  const cockpitPath = findCockpit();
  if (!cockpitPath) return null;
  const html = fs.readFileSync(cockpitPath, 'utf8');
  const props = loadProps(cockpitPath);
  const safe = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
  const data =
    `window.SAFESHIP_REPORT=${safe(report)};` +
    `window.SAFESHIP_VIGNETTES=${safe(VIGNETTES)};` +
    `window.SAFESHIP_PASS_VIGNETTES=${safe(PASS_VIGNETTES)};` +
    `window.SAFESHIP_UNKNOWN_VIGNETTES=${safe(UNKNOWN_VIGNETTES)};` +
    `window.SAFESHIP_PROPS=${safe(props)};` +
    `window.SAFESHIP_CELEBRATE=${opts?.celebrate ? 'true' : 'false'};`;
  // 미니 모드: 전체 UI는 렌더해두고 작은 카드만 보여준다 ('자세히 보기'로 창을 키워 펼침)
  const { w: sw, h: sh } = workingArea();
  const fullW = Math.min(760, Math.max(560, Math.round(sw / 3)));
  // 브라우저 패널도 두 모드를 다 갖고 시작 모드만 다르게 — 설정 버튼으로 즉시 오갈 수 있게
  const panelBoot = String.raw`
<script>(function () {
  var SW = ${sw}, SH = ${sh}, FW = ${fullW}, MW = 430, MH = 200, GAP = 14;
  window.__SS_APPLY_MODE = function (mode) {
    if (window.__ssAutoClose) { clearTimeout(window.__ssAutoClose); window.__ssAutoClose = null; }
    if (mode === 'mini') {
      document.body.classList.add('ss-mini-mode');
      var go = window.__SS_FILL_MINI();
      try { window.resizeTo(MW, MH); window.moveTo(SW - MW - GAP, SH - MH - GAP); } catch (e) {}
      if (go) window.__ssAutoClose = setTimeout(function () {
        if (document.body.classList.contains('ss-mini-mode')) window.close();
      }, 6500);
    } else {
      document.body.classList.remove('ss-mini-mode');
      try { window.resizeTo(FW, SH); window.moveTo(SW - FW, 0); } catch (e) {}
    }
  };
  window.__SS_POPOVER = function (open) {
    if (!document.body.classList.contains('ss-mini-mode')) return;
    var h = open ? 412 : MH;
    try { window.resizeTo(MW, h); window.moveTo(SW - MW - GAP, SH - h - GAP); } catch (e) {}
  };
  // 브라우저 패널은 설정 파일을 쓸 수 없다 → __SS_SAVE_MODE를 두지 않으면 설정 UI가 명령을 안내한다
  document.getElementById('m-close').addEventListener('click', function () { window.close(); });
  document.getElementById('m-detail').addEventListener('click', function () { window.__SS_APPLY_MODE('full'); });
  window.__SS_APPLY_MODE(${opts?.mini ? "'mini'" : "'full'"});
})();</script>`;
  const inject =
    `<script>${data}</script>\n<script>${RENDERER}</script>\n` +
    `<script>window.__SAFESHIP_RENDER&&window.__SAFESHIP_RENDER();</script>\n` +
    MINI_UI + SETTINGS_UI + panelBoot +
    `\n</body>`;
  const out = html.replace('</body>', inject);
  const file = path.join(os.tmpdir(), `safeship-cockpit-${Date.now()}.html`);
  fs.writeFileSync(file, out, 'utf8');

  if (process.env.SAFESHIP_NO_OPEN) return file; // 테스트용: 생성만 하고 열지 않음
  // 1순위: 크롬리스 앱 창(오른쪽 패널 또는 우하단 미니). 실패 시 기본 브라우저로 폴백.
  if (openPanel(file, !!opts?.mini)) return file;
  const platform = process.platform;
  if (platform === 'win32') spawnSync('cmd', ['/c', 'start', '', file], { stdio: 'ignore' });
  else if (platform === 'darwin') spawnSync('open', [file], { stdio: 'ignore' });
  else spawnSync('xdg-open', [file], { stdio: 'ignore' });
  return file;
}
