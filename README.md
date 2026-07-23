# mvp-sise-api

메이플 MVP작(엠작) 비용 계산기 + 시세 자동수집 백엔드. Render 무료티어 배포용.

- `mvp_calculator.html` — 계산기 프론트엔드(단일 파일). `/` 접속 시 이 화면이 뜸.
- `server.js` — 메소마켓 시세(`/api/sise`) + 옥션 시세 릴레이(`/api/auction-price`) API.
- `userscript/auction-price-reporter.user.js` — 옥션 페이지에서 가격을 읽어 백엔드로 보고하는 유저스크립트.

## 경매장식 "🔍 시세" 버튼

계산기의 아이템 표에서 각 행의 🔍 버튼을 누르면:

1. 그 아이템 이름으로 메이플 옥션 **구매**(개당 실시간 최저가, `PRICE_PER_ITEM_ASC`)와 **시세**(최근 판매,
   `TRADE_DATE_DESC`) 검색 결과를 새 탭 2개로 엶.
2. 계산기는 `/api/auction-price`를 몇 초 간격으로 폴링함.
3. 유저스크립트가 설치돼 있으면, 새로 열린 두 탭에서 각 화면의 **맨 위(=최저가/최신)** 개당 가격을 읽어
   자동으로 백엔드에 보고 → 계산기가 그중 **더 싼 값**을 판매가 칸에 채워 넣음.

### 왜 서버가 직접 옥션 시세를 못 가져오나

메이플 옥션 웹 버전은 넥슨 OTP 인증 + 로그인된 (레벨 200 이상, 최근 접속 이력 있는) 캐릭터 세션이 있어야만
접근 가능함. 서버가 사용자 대신 로그인하려면 계정 자격 증명이나 세션을 저장해야 하는데, 이는 계정 자동화로
간주될 수 있어 하지 않음. 대신 **사용자 본인이 이미 로그인한 브라우저 화면**에서 유저스크립트가 화면에
보이는 숫자만 읽어 보고하는 방식으로 우회함 — 로그인을 대신하거나 자격 증명을 다루지 않음.

### 유저스크립트 설치

1. Chrome/Edge 등에 [Tampermonkey](https://www.tampermonkey.net/) 확장 설치
2. Tampermonkey 대시보드 → "새 스크립트" → `userscript/auction-price-reporter.user.js` 내용 붙여넣기
   (또는 GitHub raw 링크로 바로 설치)
3. 백엔드 주소를 바꿔서 배포했다면 스크립트 상단 `BACKEND` 상수만 수정

설치 안 해도 🔍 버튼은 옥션 탭을 열어주니 눈으로 보고 판매가 칸에 직접 입력하면 됨 — 유저스크립트는
그 입력을 자동화해줄 뿐.

### 참고

- 가격은 메모리에만 저장됨 → Render 무료티어가 슬립 후 깨어나면(재시작) 초기화됨.
- 로그인 세션이 없으면 옥션 페이지 자체가 검색 결과를 못 보여주므로 유저스크립트도 읽을 데이터가 없음.

## Render 배포

1. 이 저장소를 GitHub에 올리고 Render → New → Web Service로 연결
2. Build: `npm install` / Start: `npm start` / Instance: Free
3. Settings → Build & Deploy → **Auto-Deploy: On** 권장 (꺼져 있으면 push 후 수동으로 Manual Deploy 필요)
