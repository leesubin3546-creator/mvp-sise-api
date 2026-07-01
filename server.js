// 메이플 MVP작 시세 자동수집 백엔드 (Render 무료티어용)
// 로아땡(로켓아이템땡스) 메이플 메소 1억당 현금시세를 스크래핑해서 JSON으로 제공.
// Node 18+ (내장 fetch 사용). iconv-lite로 EUC-KR 디코딩.

const express = require('express');
const iconv = require('iconv-lite');

const app = express();

// CORS 허용 (정적 HTML 계산기에서 호출 가능하게)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  next();
});

// ---- 간단 캐시 (무료서버 부하/차단 방지: 5분) ----
let cache = { data: null, ts: 0 };
const CACHE_MS = 5 * 60 * 1000;

// 로아땡 메이플스토리 메소 매물 페이지
const RAO_URL = 'https://www.itemthankyou.com/sell/search.asp?type_f=1&type_g=3&type_s=&type_i=&SearchStr=';

// "1억당 2,120원" / "100억당 2,300원" / "100,000억 850원" 형태를 1억당 원으로 정규화
function parseRao(html) {
  const prices = [];
  // 판매금액 컬럼의 "N억당 X원" 또는 "N억 X원" 패턴
  const re = /([\d,]+)\s*억\s*당?\s*([\d,]+)\s*원/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const eok = parseFloat(m[1].replace(/,/g, ''));   // 몇 억당
    const price = parseFloat(m[2].replace(/,/g, '')); // 그 가격(원)
    if (eok > 0 && price > 0) {
      const per1eok = price / eok;                    // 1억당 원
      // 이상치 제거 (메이플 메소 억당 대략 500~5000원 범위)
      if (per1eok >= 300 && per1eok <= 6000) prices.push(per1eok);
    }
  }
  return prices;
}

function stats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  return {
    min: Math.round(s[0]),
    median: Math.round(median),
    count: s.length
  };
}

async function fetchRao() {
  const r = await fetch(RAO_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MVPCalc/1.0)' }
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const html = iconv.decode(buf, 'euc-kr');
  return stats(parseRao(html));
}

app.get('/api/sise', async (req, res) => {
  try {
    if (cache.data && Date.now() - cache.ts < CACHE_MS) {
      return res.json({ ...cache.data, cached: true });
    }
    const rao = await fetchRao();
    // 대표 환금가: 중앙값 사용 (min은 미끼매물일 수 있음)
    const raoVal = rao ? rao.median : null;
    const data = {
      raoddaeng: raoVal,        // 로아땡 1억당 현금(원, 중앙값)
      raoddaeng_min: rao ? rao.min : null,
      itemmania: null,          // TODO: 아이템매니아 파서 (구조 확인 후 추가)
      mesoMarket: null,         // 메소마켓 억당 메포 (공식 API 없음 → 수동 입력)
      updated: new Date().toISOString().replace('T', ' ').slice(0, 16),
      source: 'itemthankyou.com'
    };
    cache = { data, ts: Date.now() };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('MVP Sise API — GET /api/sise'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('listening on ' + PORT));
