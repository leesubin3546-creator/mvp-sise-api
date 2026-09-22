// ==UserScript==
// @name         MVP 계산기 - 메이플 옥션 시세 리포터
// @namespace    mvp-mesocalc
// @version      1.3.0
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
  // 목록의 각 행에서 이름/잠재·에디 등급/가격/찜/남은시간을 읽음.
  // 잠재 옵션 상세 줄은 목록 화면에 없지만, 옥션이 필터를 이미 적용한 결과라
  // 여기 잡힌 매물은 모두 검색 조건을 만족함.
  function parseListingRows() {
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
        combatPower: combatM ? combatM[1].trim() : null
      });
    }
    return rows;
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
