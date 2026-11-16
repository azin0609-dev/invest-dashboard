# 投資儀表板（個人投資決策工具）

只給一個人使用的投資紀律工具。使用者不是工程師，主要靠 AI 開發，說明請用白話、繁體中文。

## 專案目標

- 解決「看感覺投資」：追 KOL 發文進場、合約一直攤平到爆倉、股票買了不管、大跌靠感覺加碼
- 做法是「紀律儀表板」，不是「預測儀表板」：規則先寫好，市場數字只當參考，買進前逐項檢查
- 使用者已決定**戒掉合約和融資**（第二版拿掉所有合約功能）；買進前檢查會擋下用借來的錢（融資、質押借款、合約）
- 全家一起管：「我」＋家人（成員名稱只存在 localStorage，不要寫進程式碼）
- 四大類資產：台股、美股、債券、加密貨幣（加密貨幣分「現貨」「質押」）；另外記「台股質押借款」
- 定期定額扣款一覽（標的、金額、每月扣款日、誰的帳戶）是使用者每月最重要的功能
- 程式碼放在公開的 GitHub 儲存庫：個人財務數字、持倉、可識別資訊都不要寫進會上傳的檔案（只存在使用者瀏覽器的 localStorage）
- 這是守紀律的工具，不是投資建議；畫面用語避免「建議買進／賣出」，改說「照規則」

## 技術規格

- 純前端：HTML + CSS + 原生 JavaScript（ES modules），不用框架、不需要後端
- 個人資料：localStorage（單一鍵 `invest-desk-v1`），可匯出／匯入 JSON 備份
- 市場資料：`data/market.json`，由 GitHub Actions 每天自動抓兩次並提交（`tools/fetch-market.mjs`）
- 網頁同時讀本地的 `data/market.json` 與 GitHub 上最新的那份（raw.githubusercontent.com），用比較新的
- 介面繁體中文、手機版面（RWD）、PWA（可離線、可加到主畫面）；寬螢幕（≥900px）上方導覽，手機底部導覽＋「更多」
- 所有路徑都用相對路徑，才能放在 GitHub Pages 的子路徑
- 漲跌顏色照台灣習慣：漲紅跌綠，並加 ▲▼（不只靠顏色）

## 啟動與測試

- 雲端（平常使用）：https://azin0609-dev.github.io/invest-dashboard/
- 本機：雙擊 `start.bat` → 開啟 `http://localhost:8001`（和英文 App 的 8000 錯開）
- 不能直接雙擊 `index.html`：瀏覽器不允許 file:// 讀取 `data/*.json` 與載入模組
- 自動檢查：`http://localhost:8001/tests/tests.html`（純邏輯測試，不碰使用者資料）
- 測試日期：網址加 `?today=2026-11-16` 可模擬其他日期（例如測週日開放損益、扣款提醒）
- 除錯：開發者工具輸入 `app.state`（個人資料）、`app.market`（市場資料）
- 手動更新市場資料：GitHub 儲存庫 → Actions → 更新市場資料 → Run workflow；有裝 Node.js 也可以在本機跑 `node tools/fetch-market.mjs`

## 檔案結構

```
index.html              App 外框（標題列、上方導覽、底部導覽、「更多」選單）
start.bat               雙擊啟動本機伺服器（port 8001）
tools/server.ps1        本機小伺服器（PowerShell HttpListener）
tools/fetch-market.mjs  抓市場資料（GitHub Actions 用）
.github/workflows/market.yml  每天台灣時間 06:17、22:17（週一到週五）自動更新市場資料
manifest.webmanifest    PWA 設定
sw.js                   離線快取（網路優先）※新增檔案要加進 ASSETS 並改 CACHE 版本
icons/                  App 圖示（svg、192/512 png）
css/style.css           全部樣式（淺色／深色、手機版、圖表）
js/
  app.js                進入點、網址路由（#/xxx）、右上角紀律分數
  util.js               日期（本地時間 YYYY-MM-DD）、數字格式（萬、億、%）、跳脫
  store.js              localStorage 讀寫、資料預設值、規則預設值、匯出匯入驗證
  market.js             讀 market.json、均線、距一年高點、匯率、恐懼貪婪
  calc.js               資產計算：四大類配置、現金、預備金、單一標的、加密資產平台、台股質押維持率
  dca.js                定期定額：扣款日、每月行程、月總額、即將扣款、確認、現金夠不夠
  rules.js              紀律清單、今日待辦、大跌分段加碼、買進前檢查、冷靜期
  journal.js            日誌選項（來源、情緒、動作）與統計
  chart.js              SVG 折線圖（含滑鼠提示與表格檢視）、走勢線、堆疊條、量表、橫條
  ui.js                 提示、對話框、狀態標籤、表單欄位
  views/                各畫面：home（總覽）/ holdings（持倉）/ structure（配置）/ market / check（下單前）/ plan（定投）/ journal / settings
data/
  market.json           市場資料（自動產生，不要手動改）
  watchlist.json        要自動抓價的個股／ETF（加一筆就會開始抓）
tests/                  自動檢查頁（tests.html + tests.js）
```

## 資料模型

### 使用者資料（localStorage `invest-desk-v1`，schemaVersion 2）

```js
{
  schemaVersion: 2, createdAt, updatedAt,          // updatedAt：最後一次改持倉
  members: [{ id, name, cashTwd, cashUsd }],       // 第一個固定是 { id: 'me', name: '我' }；每人的交割帳戶現金
  accounts: { emergency, monthlyExpense },         // 全家共用的預備金、每月生活費
  holdings: [{ id, owner, cat:'tw'|'us'|'bond'|'crypto', sym, name, kind, value, cost, ccy:'TWD'|'USD', platform }],
    // kind：台股／美股 'etf'|'stock'；債券 'etf'|'bond'；加密貨幣 'spot'（現貨）|'staked'（質押）。platform 是加密貨幣放在哪
  pledges: [{ id, owner, broker, sym, shares, value, loan, rate, due }],  // 台股質押借款；value 空白用股數 × 收盤價
  dca: [{ id, owner, cat, sym, name, amount, ccy, days:[6,16,26], broker, active }],  // 定期定額
  dcaChecks: { 'YYYY-MM': { '項目id@日': 確認日期 } },  // 已確認扣款
  rules: { targets:{tw,us,bond,crypto}, bandPct, singleCapPct, platformCapPct, efMonths, pledgeWarnPct, pledgeCallPct,
           opensPerDay, coolHours, dipTiers:[10,20,30], chasePct, confirmed },
  plan: { twEtf, usEtf, pool, dipUsed:{段數:日期}, fngManual },
  journal: [{ id, date, owner, sym, action:'buy'|'add'|'sell', amount, source, mood, reason, wrongIf, result:{outcome, pnl, note, date}|null }],
  wishlist: [{ id, sym, note, source, addedAt(ISO) }],   // 想買清單（冷靜期）
  opens: { date, n }, peeks: {'YYYY-MM': 次數}, settings: { fx, lastExport }
}
```

匯出格式：`{ app: "invest-dashboard", schemaVersion, exportedAt, data: <上面整包> }`。格式改版時在 `store.js` 的 `migrate()` 處理舊資料（第一版 → 第二版：台股／美股持倉轉成四大類、現金搬到「我」、合約拿掉）。

### 市場資料（data/market.json）

```js
{
  updatedAt: ISO 時間,
  series: { "^TWII" | "^GSPC" | "^IXIC" | "^VIX" | "^TNX" | "TWD=X" | 觀察清單代號: { name, ccy, src, d: [["YYYY-MM-DD", 收盤], ...] } },  // 約兩年
  fng: { v, rating, date, prevWeek, prevMonth, hist },   // CNN 股市恐懼與貪婪
  tw: { margin: { date, v(億), prev, hist }, foreign: { date, v(億), hist } },  // 證交所融資餘額、外資買賣超
  errors: [抓不到的項目]
}
```

來源：Yahoo Finance（主要）→ 備援 FRED（美股指數、殖利率、匯率）、證交所（加權指數）、ExchangeRate-API（匯率）。抓不到的沿用舊資料，全部失敗才讓 Actions 顯示紅色。

## 規則

### 資產配置（calc.js）
- 投資資產 = 四大類＋各成員現金；不含預備金。質押借款是負債：淨資產 = 投資資產 − 借款
- 配置比例以四大類加總為分母（現金另外看）；和目標差超過 bandPct 才算偏高／偏低
- 單一標的 = 個股和幣（同一種幣的現貨＋質押合併），ETF、債券不算；占投資資產超過 singleCapPct 提醒
- 加密資產依「放在哪」加總，單一平台超過 platformCapPct 提醒（交易所倒閉風險）
- 台股質押：維持率 = 擔保品市值 ÷ 借款；低於 pledgeWarnPct 黃色、低於 pledgeCallPct（一般 130%）紅色；同時算「再跌多少會被追繳」和每月利息

### 定期定額（dca.js）
- 每筆可以有好幾個扣款日；31 號遇小月算月底；遇假日券商會順延（畫面上提醒，不另外算）
- 今日待辦：未來 3 天要扣款的、扣款人現金不夠的（同一人同幣別加總）、本月過了扣款日還沒確認的
- 近期扣款提醒排在紅色風險之後、其他提醒之前

### 買進前檢查（rules.js `checkBuy`）
- 只用自己的錢（融資、質押借款、合約一律不通過）、預備金、扣款人現金夠用
- 買完該類別比例不超過目標＋bandPct；個股和幣不超過單一標的上限
- 個股和幣看趨勢：200 日線下 = 接刀、比 60 日線高超過 chasePct = 追高；ETF、債券不看時機
- 冷靜期：想法來源是 KOL／新聞／朋友，要先放進想買清單滿 coolHours 小時
- 沒有價格資料的趨勢檢查標成「跳過」，不擋

### 大跌分段加碼（rules.js）
- 台股加權或 S&P 500 距一年（252 個交易日）高點跌到 dipTiers 各一段；每段金額 = 加碼池 ÷ 剩下段數；照做後從加碼池扣掉；兩個大盤都回到高點 5% 內才建議重新開始
- 恐懼貪婪指數只當參考，不影響定期定額

### 紀律
- 紀律清單（首頁、右上角分數）：預備金、四大類在範圍內、單一標的、加密平台、質押維持率、本月扣款都確認、每天打開次數
- 損益金額平日隱藏，週日開放；提前看會記次數
- 今日待辦依急迫度排序：紅（風險）→ 近期扣款 → 黃（超過上限）→ 綠（加碼觸發）→ 一般

## 部署（GitHub Pages）

- 儲存庫：https://github.com/azin0609-dev/invest-dashboard （公開；`main` 分支根目錄直接當網站）
- 網站：https://azin0609-dev.github.io/invest-dashboard/
- 已開啟 GitHub Pages（Settings → Pages → Branch `main`、`/ (root)`）
- 更新網站：改完檔案後 `git add -A` → `git commit` → `git push`
- 隱私：commit 用 GitHub 匿名 Email；`CLAUDE.local.md`、`.claude/`、備份檔（invest-backup-*.json）都在 `.gitignore`
- 雲端網址和本機網址（localhost:8001）的資料是分開的兩份，要靠匯出／匯入搬移

## 擴充

- 想自動抓某檔股票的價格：在 `data/watchlist.json` 加一筆 `{ "sym": "代號", "name": "名稱" }`；台股代號加 `.TW`（上櫃加 `.TWO`），美股直接寫代號。下次自動更新後就有均線和距高點
- 注意：watchlist.json 是公開的，不想讓人知道在觀察什麼就不要加

## 開發進度

### 第一版（2026-10-24）
- [x] 持倉、結構、市場、風控、下單前、定投、日誌、設定；GitHub Actions 每日抓資料

### 第二版（2026-11-16）
- [x] 拿掉合約（風控頁、合約持倉、合約下單檢查）；買進前檢查擋下融資、質押借款、合約
- [x] 家人：每人分開記現金和持倉，配置可看全家或單一家人
- [x] 持倉改成四大類：台股、美股、債券、加密貨幣（現貨／質押）
- [x] 台股質押借款：維持率、追繳距離、利息、到期提醒
- [x] 定期定額扣款一覽：每月合計、月曆、扣款確認、扣款前提醒、現金不夠提醒
- [x] 觀察清單加入 BTC、ETH
- [x] 自動檢查頁 55 項

### 之後可以做
- [ ] 每月檢討頁（本月紀律分數變化、日誌統計摘要）
- [ ] 新聞與重要事件行事曆（只當參考）
- [ ] 手機與電腦資料同步

## 已知限制
- 市場資料是每天收盤後的數字，不是即時價格；質押維持率以券商 App 顯示的為準
- Yahoo、CNN 的資料介面不是官方公開 API，可能改版；失敗時看 Actions 的紀錄，市場頁會列出抓不到的項目，恐懼貪婪可以手動填
- 資料只存在該裝置、該網址的瀏覽器；不同裝置要靠匯出匯入搬移
