const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'listings.html'), 'utf8');

function between(start, end) {
  const a = html.indexOf(start);
  const b = html.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `source block not found: ${start}`);
  return html.slice(a, b);
}

// 실제 옥션 exStat 표본으로 올스탯%, 공격력, 마력이 올바른 단위로 들어가는지 고정한다.
const calcExScore = new Function(
  `${between('const STAT_LABEL=', 'function exScoreParts')}\nreturn calcExScore;`
)();
const base = { wAtk: 4, wSub: 0, wAll: 10, wHp: 0 };

assert.equal(calcExScore(
  { str: 84, dex: 48, all: 5, pad: 4 },
  { ...base, main: 'str', attack: 'pad' }
).score, 150, 'STR + 올스탯% + 공격력 환산');

assert.equal(calcExScore(
  { int: 100, luk: 40, all: 6, mad: 5, pad: 99 },
  { ...base, main: 'int', attack: 'mad' }
).score, 180, '마법사는 공격력이 아니라 마력만 환산');

assert.equal(calcExScore(
  { str: 107, luk: 35, all: 6, mhp: 2800 },
  { ...base, main: 'str', attack: 'pad' }
).score, 167, '관련 없는 스탯과 가중치 0인 HP는 제외');

// 일괄 조회의 최저가 펼침은 정확히 5개를 렌더하고 전체 목록은 명시적 버튼으로만 연다.
const topFiveHtml = new Function(
  'exScoreParts', 'formatScore', 'sfLabel', 'meso', 'esc', 'detailHtml',
  `${between('function topFiveHtml', '// ---- 시세 통계')}\nreturn topFiveHtml;`
)(
  r => ({ score: r.score }),
  String,
  r => `★ ${r.starforce}`,
  n => `${n}메소`,
  String,
  r => `<div>${r.name}</div>`
);
const rows = Array.from({ length: 5 }, (_, i) => ({
  name: `매물${i + 1}`, pricePerUnit: 100 + i, score: 150 + i,
  starforce: 17, isMyWorld: true
}));
const topFive = topFiveHtml(rows, 3);
assert.equal((topFive.match(/<details>/g) || []).length, 5);
assert.match(topFive, /data-full="3"/);

const batchSource = between('function renderBatch()', 'function topFiveHtml');
assert.match(batchSource, /\.slice\(0,5\)/, '가격순 상위 5개만 사용');
assert.doesNotMatch(batchSource, /querySelectorAll\('tr\.brow'/, '행 전체 클릭 동작 제거');
assert.doesNotMatch(batchSource, /scrollIntoView/, '3번 영역 자동 이동 제거');
const makeBatchSearchFilters = new Function(
  `${between('function makeBatchSearchFilters', 'function renderBatchPicker')}\nreturn makeBatchSearchFilters;`
)();
const buildAuctionUrl = new Function('AUCTION_BACKEND',
  `${between('function buildAuctionUrl', 'function readFilters')}\nreturn buildAuctionUrl;`
)('https://mvp-sise-api.onrender.com');
const stored = {
  keyword:'에테르넬 나이트헬름', exact:'true', category:'ARMOR',
  sortType:'PRICE_DESC', worldScope:'all', limit:'20', sampleN:'1',
  potRows:[], addRows:[], exRows:[], scrollRows:[]
};
const mine = makeBatchSearchFilters(stored, 'mine');
assert.equal(mine.sortType, 'PRICE_PER_ITEM_ASC');
assert.equal(mine.worldScope, 'mine');
assert.equal(stored.worldScope, 'all', '일괄 검색에서 저장된 조건을 변경하지 않는다');
assert.match(buildAuctionUrl(mine), /isAllWorldSearchEnabled=true/,
  '현재 월드만 선택 시 옥션 검색에 월드 필터가 들어간다');
assert.doesNotMatch(buildAuctionUrl(makeBatchSearchFilters(stored, 'all')),
  /isAllWorldSearchEnabled/, '전체 월드 선택 시 월드 필터를 해제한다');
assert.equal(makeBatchSearchFilters({...stored,worldScope:'mine'}, 'saved').worldScope,
  'mine', '저장된 조건대로 검색할 수 있다');
assert.match(html, /id="batchWorldScope"/);

assert.match(html, /올스탯 1%당/);
assert.doesNotMatch(html, /id="attackType"/);
assert.doesNotMatch(html, /id="subStat"/);
assert.match(html, /mvpListings\.exWeights\.v2/);

console.log('listings tests passed');

// ---- 추가 옵션 "급" ----
// 급은 스탯 종류와 아이템 레벨에 따라 옥션이 직접 매긴 값이라 우리가 재계산하지 않고 그대로 쓴다.
const gradeSrc = between('function exSum(r)', 'function exScoreParts');
const exSum = new Function(`${gradeSrc}\nreturn exSum;`)();

// 실측 표본: 네크로 에인션트 보우 Lv.120 — 5+6+3+5 = 19급
const bow = { exSum: 19, exGrades: [
  { g: 5, t: '보스 몬스터 데미지 +10%' }, { g: 6, t: 'STR, LUK +24' },
  { g: 3, t: '데미지 +3%' }, { g: 5, t: 'STR +35' } ] };
assert.equal(exSum(bow), 19, '옥션이 준 합계를 그대로 쓴다');
assert.equal(exSum({ exGrades: bow.exGrades }), 19, '합계가 없으면 줄별 급을 더한다');
assert.equal(exSum({ exOption: ['STR +35'] }), null, '급 정보가 없으면 빈 값');
assert.equal(exSum({}), null, '옛 유저스크립트 매물도 안전');

// 보스 데미지%·데미지% 는 환산 점수에 안 잡히지만 급에는 잡힌다 —
// 급을 따로 두는 이유가 이것(환산만 보면 보스뎀 10% 무기가 0짜리와 같은 점수가 됨)
assert.equal(calcExScore({ str: 35, luk: 24 }, { ...base, main: 'str', attack: 'pad' }).score,
  35, '보스뎀/데미지%는 환산에 안 들어감');
assert.ok(exSum(bow) > 0, '그래도 급으로는 평가된다');

assert.match(html, /th\('exg','추옵 급'\)/, '급 칼럼이 정렬 가능');
assert.match(html, /th\('ex','환산'\)/, '환산 칼럼도 따로 유지');

console.log('flame grade tests passed');
