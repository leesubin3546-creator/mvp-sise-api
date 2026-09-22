// ==UserScript==
// @name         MVP 계산기 - 메이플 옥션 시세 리포터
// @namespace    mvp-mesocalc
// @version      1.4.0
// @description  옥션(auction.maplestory.nexon.com) 구매/시세 검색 결과의 개당 최저가·최근 체결가와 매물 목록을 읽어서 MVP 계산기/매물 찾기 백엔드로 보고합니다. 로그인은 항상 사용자 본인 브라우저 세션을 그대로 사용하며, 이 스크립트가 로그인을 대신하거나 자격 증명을 저장/전송하지 않습니다.
// @author       -
// @match        https://auction.maplestory.nexon.com/buy*
// @match        https://auction.maplestory.nexon.com/price*
// @grant        GM_xmlhttpRequest
// @connect      mvp-sise-api.onrender.com
// @connect      localhost
// @run-at       document-idle
// @updateURL    https://mvp-sise-api.onrender.com/userscript/auction-price-reporter.user.js
// @downloadURL  https://mvp-sise-api.onrender.com/userscript/auction-price-reporter.user.js
// ==/UserScript==

(function () {
  'use strict';

  // MVP 계산기 백엔드 주소. 기본은 배포 주소지만, 계산기/매물 찾기가 옥션 URL에 심어 보낸
  // mvpcalcBackend 값이 아래 허용 목록에 있으면 그쪽으로 보고함(로컬 개발용).
  // 허용 목록 밖 주소는 무시 — 임의 사이트로 데이터가 나가지 않게 하려는 것.
  const ALLOWED_BACKENDS = ['https://mvp-sise-api.onrender.com', 'http://localhost:3000'];
  const requested = new URLSearchParams(location.search).get('mvpcalcBackend');
  const BACKEND = ALLOWED_BACKENDS.includes(requested) ? requested : ALLOWED_BACKENDS[0];

  // 이 페이지를 봤다는 것 자체를 백엔드에 알림(설치/동작 여부 진단용).
  // 아이템 검색 결과가 없어도, 콜드스타트 중이어도 항상 시도함.
  function pingBackendAlive() {
    GM_xmlhttpRequest({
      method: 'POST',
      url: BACKEND + '/api/userscript-ping',
      onload: () => {}, onerror: () => {}
    });
  }
  pingBackendAlive();

  const params = new URLSearchParams(location.search);
  const keyword = (params.get('keyword') || '').trim();

  const kind = location.pathname.startsWith('/buy') ? 'buy'
             : location.pathname.startsWith('/price') ? 'sise'
             : null;
  if (!kind) return;

  // "12억 3333만 3300메소" 같은 표기를 정수 메소로 변환
  function parseKoreanMeso(raw) {
    let s = raw.replace(/,/g, '');
    let total = 0;
    const eok = s.match(/(\d+)\s*억/);
    if (eok) { total += parseInt(eok[1], 10) * 1e8; s = s.replace(eok[0], ''); }
    const man = s.match(/(\d+)\s*만/);
    if (man) { total += parseInt(man[1], 10) * 1e4; s = s.replace(man[0], ''); }
    const rest = s.match(/(\d+)\s*메소/);
    if (rest) total += parseInt(rest[1], 10);
    return total > 0 ? total : null;
  }

  // 결과 목록에서 첫 번째(맨 위) "개당 ...메소" 값을 찾음
  // /buy 는 PRICE_PER_ITEM_ASC 정렬 → 첫 값 = 실시간 최저가
  // /price 는 TRADE_DATE_DESC 정렬 → 첫 값 = 최근 판매 시세
  function findFirstPerUnitPrice() {
    const text = document.body.innerText || '';
    const idx = text.indexOf('개당');
    if (idx === -1) return null;
    const seg = text.slice(idx, idx + 60);
    const end = seg.indexOf('메소');
    if (end === -1) return null;
    return parseKoreanMeso(seg.slice(0, end + 2));
  }

  // ---- 매물 목록 파싱 (매물 찾기 페이지용) ----
  // 1순위: 옥션이 검색 결과와 함께 내려준 툴팁 데이터를 React 컴포넌트 props에서 직접 읽음.
  //   화면에는 스타포스/잠재/추옵이 안 보이지만(마우스 오버 툴팁에만 나옴), 그 툴팁을 그리는
  //   데이터(item.toolTip.upgradeInfo)는 이미 목록 렌더링 시점에 들어와 있음 — 추가 요청 없이
  //   스타포스·주문서 강화·추가 옵션·잠재/에디셔널 옵션 줄까지 그대로 가져올 수 있음.
  // 2순위: props를 못 읽으면(옥션 프론트 구조 변경 등) 예전처럼 화면 텍스트를 긁음.

  // 구매하기 버튼에서 위로 올라가며 item prop을 들고 있는 컴포넌트를 찾음
  function fiberItem(el) {
    const key = Object.keys(el).find(k =>
      k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (!key) return null;
    let f = el[key];
    for (let d = 0; d < 14 && f; d++) {
      const p = f.memoizedProps;
      if (p && p.item && p.item.itemName) return p.item;
      f = f.return;
    }
    return null;
  }

  function parseListingRowsFiber() {
    const btns = [...document.querySelectorAll('button')]
      .filter(b => (b.textContent || '').trim() === '구매하기');
    const num = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; };
    // description 예: "잠재능력 : 레전드리" / "에디셔널 잠재능력 : 없음"
    const gradeOf = o => {
      if (!o || !o.grade) return null;
      const m = String(o.description || '').split(':')[1];
      const s = m ? m.trim() : '';
      return s && s !== '없음' ? s : null;
    };
    const texts = o => ((o && o.entries) || [])
      .map(e => String(e.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean);

    const rows = [];
    for (const b of btns) {
      const it = fiberItem(b);
      if (!it) continue;
      const tt = it.toolTip || {};
      const up = tt.upgradeInfo || {};
      const end = it.endDate ? new Date(it.endDate).getTime() : NaN;
      rows.push({
        name: it.itemName,
        potentialGrade: gradeOf(up.potential),
        additionalGrade: gradeOf(up.additionalPotential),
        qty: it.quantity || 1,
        pricePerUnit: num(it.pricePerItem),
        priceTotal: num(it.price),
        zzim: Number.isFinite(it.wishlistCount) ? it.wishlistCount : null,
        remainMin: Number.isFinite(end) ? Math.max(0, Math.round((end - Date.now()) / 60000)) : null,
        combatPower: Number.isFinite(it.attackPowerDiff) ? it.attackPowerDiff : null,
        starforce: Number.isFinite(it.starforce) ? it.starforce : null,
        starforceMax: up.starForce && Number.isFinite(up.starForce.max) ? up.starForce.max : null,
        upgradeCount: Number.isFinite(it.currentUpgradeCount) ? it.currentUpgradeCount : null,
        upgradeRemaining: up.scroll && Number.isFinite(up.scroll.remaining) ? up.scroll.remaining : null,
        upgradeFailure: up.scroll && Number.isFinite(up.scroll.failure) ? up.scroll.failure : null,
        reqLevel: typeof tt.reqLevel === 'number' ? tt.reqLevel : null,
        icon: (it.itemIcon && it.itemIcon.fallBackUrl) || null,
        potential: texts(up.potential),
        additional: texts(up.additionalPotential),
        exOption: texts(up.exOption),
        // 전체 월드로 검색하면 타 월드 매물이 섞여 나옴(구매 시 월드 이전 수수료가 붙음)
        isMyWorld: typeof it.isMyWorld === 'boolean' ? it.isMyWorld : null,
        detailed: true
      });
    }
    return rows;
  }

  function parseListingRowsDom() {
    const btns = [...document.querySelectorAll('button')]
      .filter(b => (b.textContent || '').trim() === '구매하기');
    const rows = [];
    for (const b of btns) {
      let el = b;
      for (let i = 0; i < 8 && el; i++) {
        el = el.parentElement;
        if (el && el.textContent.includes('메소') && el.textContent.length < 400) break;
      }
      if (!el) continue;
      const flat = (el.innerText || '').replace(/\s*\n\s*/g, ' ').trim();
      if (!flat) continue;
      const lines = (el.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
      const name = lines[0] || '';
      if (!name) continue;

      const grades = lines.filter(s => /^(노멀|레어|에픽|유니크|레전드리)$/.test(s));
      const qtyM = flat.match(/(\d+)\s*개\s*[·・]/);
      const perM = flat.match(/개당\s*([\d,]+(?:\s*억)?[\d,만\s]*)메소/);
      // 총액: "개당 ...메소" 부분을 먼저 걷어낸 뒤 남은 "... 메소"를 가격으로 읽음
      const totalSrc = flat.replace(/\d+\s*개\s*[·・]\s*개당[^메]*메소/, '');
      const totM = totalSrc.match(/([\d,]+(?:\s*억)?[\d,만\s]*)\s*메소/);
      const zzimM = flat.match(/찜\s*(\d+)/);
      const timeM = flat.match(/(\d+)\s*시간\s*(\d+)\s*분/);
      const combatM = flat.match(/전투력증가량\s*([+-]?[\d,억만\s]+)/);

      rows.push({
        name,
        potentialGrade: grades[0] || null,
        additionalGrade: grades[1] || null,
        qty: qtyM ? parseInt(qtyM[1], 10) : 1,
        pricePerUnit: perM ? parseKoreanMeso(perM[1] + '메소') : null,
        priceTotal: totM ? parseKoreanMeso(totM[1] + '메소') : null,
        zzim: zzimM ? parseInt(zzimM[1], 10) : null,
        remainMin: timeM ? parseInt(timeM[1], 10) * 60 + parseInt(timeM[2], 10) : null,
        combatPower: combatM ? combatM[1].trim() : null,
        detailed: false
      });
    }
    return rows;
  }

  function parseListingRows() {
    try {
      const rows = parseListingRowsFiber();
      if (rows.length) return rows;
    } catch (e) { /* 구조가 바뀌었으면 조용히 화면 긁기로 넘어감 */ }
    return parseListingRowsDom();
  }

  function reportListings(rows, attempt) {
    attempt = attempt || 0;
    const totalM = (document.body.innerText || '').match(/검색\s*결과\s*([\d,]+)\s*건/);
    const body = JSON.stringify({
      rows,
      total: totalM ? parseInt(totalM[1].replace(/,/g, ''), 10) : rows.length,
      url: location.href
    });
    GM_xmlhttpRequest({
      method: 'POST',
      url: BACKEND + '/api/auction-listings',
      headers: { 'Content-Type': 'application/json' },
      data: body,
      onload: (resp) => {
        if (resp.status >= 200 && resp.status < 300) {
          toast(`매물 찾기로 전송됨: ${rows.length}건`);
        } else if (attempt < 4) {
          setTimeout(() => reportListings(rows, attempt + 1), 3000);
        }
      },
      onerror: () => {
        if (attempt < 4) setTimeout(() => reportListings(rows, attempt + 1), 3000);
      }
    });
  }

  // 백엔드가 막 깨어나는 중일 수 있어 실패하면 몇 번 재시도(최대 4번, ~12초)
  function report(price, attempt) {
    attempt = attempt || 0;
    const body = JSON.stringify({ item: keyword, kind, price, url: location.href });
    GM_xmlhttpRequest({
      method: 'POST',
      url: BACKEND + '/api/auction-price',
      headers: { 'Content-Type': 'application/json' },
      data: body,
      onload: (resp) => {
        if (resp.status >= 200 && resp.status < 300) {
          toast(`MVP 계산기로 전송됨: ${keyword} (${kind === 'buy' ? '구매 최저가' : '최근 시세'}) ${(price / 1e8).toFixed(2)}억`);
        } else if (attempt < 4) {
          setTimeout(() => report(price, attempt + 1), 3000);
        } else {
          toast('MVP 계산기 전송 실패 (백엔드 응답 오류)');
        }
      },
      onerror: () => {
        if (attempt < 4) setTimeout(() => report(price, attempt + 1), 3000);
        else toast('MVP 계산기 전송 실패 (백엔드 접속 불가)');
      }
    });
  }

  function toast(msg) {
    let el = document.getElementById('__mvpcalc_toast');
    if (!el) {
      el = document.createElement('div');
      el.id = '__mvpcalc_toast';
      el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:99999;' +
        'background:#3f3626;color:#fff;padding:10px 14px;border-radius:10px;' +
        'font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.3);max-width:320px;line-height:1.5';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    clearTimeout(el._t);
    el._t = setTimeout(() => el.remove(), 6000);
  }

  // 두 가지를 독립적으로 보고함:
  //  - 개당 최저가 1건 (계산기용) — 검색어가 있을 때만
  //  - 매물 목록 전체 (매물 찾기용) — /buy 페이지면 검색어 없이 필터만으로도
  let priceDone = !keyword;
  let listDone = kind !== 'buy';
  let tries = 0;
  const maxTries = 20; // 500ms * 20 = 10초
  const timer = setInterval(() => {
    tries++;
    if (!priceDone) {
      const price = findFirstPerUnitPrice();
      if (price) { priceDone = true; report(price); }
    }
    if (!listDone) {
      const rows = parseListingRows();
      if (rows.length) { listDone = true; reportListings(rows); }
    }
    if ((priceDone && listDone) || tries >= maxTries) {
      clearInterval(timer);
      // 결과가 0건이어도 "검색은 끝났다"고 알려야 매물 찾기 쪽이 무한 대기하지 않음
      if (tries >= maxTries && !listDone && kind === 'buy'
          && /일치하는 아이템이 없습니다/.test(document.body.innerText || '')) {
        reportListings([]);
      }
    }
  }, 500);
})();
