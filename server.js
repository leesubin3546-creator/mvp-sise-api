// 메이플 MVP작 시세 자동수집 백엔드 (Render 무료티어용)
// 게임비트(gamebit.co.kr) 공개 시세 JSON을 사용해 서버별 "1억 메소 → 현금(원)" 시세를 제공.
// 로아땡은 Cloudflare 봇차단으로 서버측 접근 불가 → 게임비트 JSON으로 대체.
// Node 18+ (내장 fetch 사용).

const express = require('express');
const app = express();
app.use(express.json());

// CORS 허용 (정적 HTML 계산기 + 옥션 페이지의 유저스크립트에서 호출 가능하게)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 게임비트 서버ID(sid) 매핑 — 주요 일반 서버
const SERVERS = {
  '오로라': 2115, '유니온': 2118, '스카니아': 2119, '루나': 2120,
  '제니스': 2121, '크로아': 2122, '베라': 2123, '엘리시움': 2124
};
const STATUS_URL = 'https://gamebit.co.kr/jdata2/maple/total_status.json';

// ---- 캐시 (원본 status 5분) ----
let cache = { status: null, ts: 0 };
const CACHE_MS = 5 * 60 * 1000;

async function getStatus(force) {
  if (!force && cache.status && Date.now() - cache.ts < CACHE_MS) {
    return { status: cache.status, httpStatus: 200, cached: true };
  }
  const r = await fetch(STATUS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'application/json,text/plain,*/*',
      'Referer': 'https://gamebit.co.kr/maple'
    }
  });
  let status = null;
  const text = await r.text();
  try { status = JSON.parse(text); } catch (e) { status = null; }
  if (status) cache = { status, ts: Date.now() };
  return { status, httpStatus: r.status, cached: false, len: text.length };
}

app.get('/api/sise', async (req, res) => {
  try {
    const sid = parseInt(req.query.sid) || 2119; // 기본 스카니아
    const { status, httpStatus, cached, len } = await getStatus(!!req.query.debug);

    let price = null, updated = null;
    const servers = {};
    if (status) {
      for (const [name, id] of Object.entries(SERVERS)) {
        if (status[id]) servers[name] = Math.round(status[id].price);
      }
      if (status[sid]) { price = Math.round(status[sid].price); updated = status[sid].last_update; }
    }

    res.json({
      raoddaeng: price,          // 선택 서버의 1억 메소당 현금(원) — 프론트 호환 키
      price: price,
      sid: sid,
      servers: servers,          // 서버명 → 억당 원
      updated: updated,
      source: 'gamebit.co.kr',
      debug: req.query.debug ? { httpStatus, cached, len, keys: status ? Object.keys(status).length : 0 } : undefined
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- 경매장 시세 릴레이 ----
// 옥션 웹은 넥슨 OTP 로그인 세션이 있어야 접근 가능해서 서버가 대신 조회할 수 없음.
// 대신 유저스크립트(userscript/auction-price-reporter.user.js)가 사용자 브라우저의
// 로그인 세션으로 옥션 페이지를 볼 때 화면에 보이는 가격을 읽어 여기로 보고하면,
// 계산기가 그 값을 폴링해서 가져다 씀. 메모리 저장이라 서버 재시작(무료티어 슬립 등) 시 초기화됨.
const auctionPrices = {}; // { [정규화된 아이템명]: { buy:{price,ts,url}, sise:{price,ts,url} } }
const normItem = (s) => (s || '').trim().replace(/\s+/g, ' ');

app.post('/api/auction-price', (req, res) => {
  const { item, kind, price, url } = req.body || {};
  if (!item || !['buy', 'sise'].includes(kind) || !(price > 0)) {
    return res.status(400).json({ error: 'item, kind(buy|sise), price 필요' });
  }
  const key = normItem(item);
  if (!auctionPrices[key]) auctionPrices[key] = {};
  auctionPrices[key][kind] = { price: Math.round(price), ts: Date.now(), url: url || null };
  res.json({ ok: true, item: key, kind });
});

app.get('/api/auction-price', (req, res) => {
  const key = normItem(req.query.item);
  const entry = auctionPrices[key];
  if (!entry) return res.json({ item: key, found: false });
  const candidates = [entry.buy, entry.sise].filter(Boolean);
  const best = candidates.length ? Math.min(...candidates.map(c => c.price)) : null;
  res.json({ item: key, found: true, buy: entry.buy || null, sise: entry.sise || null, best });
});

// 루트 접속 시 계산기 화면 제공 (API 안내는 /api/sise 참고)
app.get('/', (req, res) => res.sendFile(__dirname + '/mvp_calculator.html'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('listening on ' + PORT));
