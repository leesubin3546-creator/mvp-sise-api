// ==UserScript==
// @name         MVP 계산기 - 메이플 옥션 시세 리포터
// @namespace    mvp-mesocalc
// @version      1.0.0
// @description  옥션(auction.maplestory.nexon.com) 구매/시세 검색 결과의 개당 최저가·최근 체결가를 읽어서 MVP 계산기 백엔드로 보고합니다. 로그인은 항상 사용자 본인 브라우저 세션을 그대로 사용하며, 이 스크립트가 로그인을 대신하거나 자격 증명을 저장/전송하지 않습니다.
// @author       -
// @match        https://auction.maplestory.nexon.com/buy*
// @match        https://auction.maplestory.nexon.com/price*
// @grant        GM_xmlhttpRequest
// @connect      mvp-sise-api.onrender.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // MVP 계산기 백엔드 주소. 계산기를 다른 곳에 배포했다면 이 값만 바꾸면 됨.
  const BACKEND = 'https://mvp-sise-api.onrender.com';

  const params = new URLSearchParams(location.search);
  const keyword = (params.get('keyword') || '').trim();
  if (!keyword) return;

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

  function report(price) {
    const body = JSON.stringify({ item: keyword, kind, price, url: location.href });
    GM_xmlhttpRequest({
      method: 'POST',
      url: BACKEND + '/api/auction-price',
      headers: { 'Content-Type': 'application/json' },
      data: body,
      onload: () => toast(`MVP 계산기로 전송됨: ${keyword} (${kind === 'buy' ? '구매 최저가' : '최근 시세'}) ${(price / 1e8).toFixed(2)}억`),
      onerror: () => toast('MVP 계산기 전송 실패 (백엔드 접속 불가)')
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

  let tries = 0;
  const maxTries = 20; // 500ms * 20 = 10초
  const timer = setInterval(() => {
    tries++;
    const price = findFirstPerUnitPrice();
    if (price) {
      clearInterval(timer);
      report(price);
    } else if (tries >= maxTries) {
      clearInterval(timer);
    }
  }, 500);
})();
