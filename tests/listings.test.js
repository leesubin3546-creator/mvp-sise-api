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
assert.match(html, /searchFilters=\{\.\.\.p\.filters,sortType:'PRICE_PER_ITEM_ASC'\}/,
  '일괄 조회는 검색 자체를 개당 가격 오름차순으로 강제');

assert.match(html, /올스탯 1%당/);
assert.doesNotMatch(html, /id="attackType"/);
assert.doesNotMatch(html, /id="subStat"/);
assert.match(html, /mvpListings\.exWeights\.v2/);

console.log('listings tests passed');
