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

// "1억당 2,120원" / "100억당 2,300원" 형태를 1억당 원으로 정규화
function parseRao(rawHtml) {
  const prices = [];
  // HTML 태그 제거 후 공백 정규화 (셀 사이 태그로 정규식이 끊기는 것 방지)
  const html = rawHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const re = /([\d,]+)\s*억\s*당?\s*([\d,]+)\s*원/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const eok = parseFloat(m[1].replace(/,/g, ''));
    const price = parseFloat(m[2].replace(/,/g, ''));
    if (eok > 0 && price > 0) {
      const per1eok = price / eok;
      if (per1eok >= 300 && per1eok <= 6000) prices.push(per1eok);
    }
  }
  return prices;
}

function stats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return { min: Math.round(s[0]), median: Math.round(s[Math.floor(s.length / 2)]), count: s.length };
}

async function fetchRao() {
  const r = await fetch(RAO_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Referer': 'https://www.itemthankyou.com/'
    }
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const html = iconv.decode(buf, 'euc-kr');
  const prices = parseRao(html);
  const flat = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const idx = flat.indexOf('억');
  return {
    stat: stats(prices),
    debug: {
      httpStatus: r.status,
      htmlLen: html.length,
      matched: prices.length,
      sample: flat.slice(Math.max(0, idx - 40), idx + 120)
    }
  };
}

app.get('/api/sise', async (req, res) => {
  try {
    if (!req.query.debug && cache.data && Date.now() - cache.ts < CACHE_MS) {
      return res.json({ ...cache.data, cached: true });
    }
    const rao = await fetchRao();
    const st = rao.stat;
    const data = {
      raoddaeng: st ? st.median : null,
      raoddaeng_min: st ? st.min : null,
      itemmania: null,
      mesoMarket: null,
      updated: new Date().toISOString().replace('T', ' ').slice(0, 16),
      source: 'itemthankyou.com',
      debug: req.query.debug ? rao.debug : undefined
    };
    if (data.raoddaeng != null) cache = { data, ts: Date.now() };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/', (req, res) => res.send('MVP Sise API — GET /api/sise'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('listening on ' + PORT));
