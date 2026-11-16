// 自動檢查：純邏輯測試，不會讀寫你的 localStorage 資料
import { defaultState, normalize, validateImport, exportData } from '../js/store.js';
import { sma, drawdown, trendOf, findSeries, fngLabel, fxOf, githubRawUrl, lastOf } from '../js/market.js';
import { portfolio, pledgeView, baseSym } from '../js/calc.js';
import { parseDays, occurrences, monthSchedule, monthlyTotals, upcoming, unconfirmedPast, cashShortfalls } from '../js/dca.js';
import { discipline, dipPlan, todos, checkBuy, coolStatus } from '../js/rules.js';
import { statsBy, pendingResults, SOURCES } from '../js/journal.js';
import { twd, pct, spct, addDays } from '../js/util.js';

const groups = [];
let current = null;

function group(name, fn) {
  current = { name, tests: [] };
  groups.push(current);
  fn();
}
function test(name, fn) {
  try {
    fn();
    current.tests.push({ name, ok: true });
  } catch (e) {
    current.tests.push({ name, ok: false, msg: e.message });
  }
}
function eq(actual, expected, label = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}預期 ${b}，實際 ${a}`);
}
function near(actual, expected, tol = 1e-6, label = '') {
  if (!(Math.abs(actual - expected) <= tol)) throw new Error(`${label}預期約 ${expected}，實際 ${actual}`);
}
function ok(cond, msg = '條件不成立') {
  if (!cond) throw new Error(msg);
}

const T = '2026-11-16'; // 星期一
const NOW = Date.parse('2026-11-16T12:00:00+08:00');

/** 產生 n 天的價格序列 */
function series(n, f, start = '2025-01-01') {
  const d = [];
  for (let i = 0; i < n; i++) d.push([addDays(start, i), f(i)]);
  return { name: 'x', d };
}
function mkMarket(extra = {}) {
  return { updatedAt: '2026-11-16T00:00:00Z', series: { 'TWD=X': series(5, () => 32), ...extra }, fng: { v: 50, date: T }, tw: {}, errors: [] };
}
/**
 * 範例家庭（匯率 32）：
 * 我：0050 40 萬（ETF）、2330 10 萬（個股）、VOO 5000 美元（16 萬）、BTC 現貨 1000 美元＋質押 500 美元、現金 5 萬
 * 太太：00679B 債券 ETF 20 萬、現金 1 萬
 */
function mkState() {
  const s = defaultState();
  s.rules.confirmed = true;
  s.opens = { date: T, n: 1 };
  s.updatedAt = T;
  s.members = [{ id: 'me', name: '我', cashTwd: 50000, cashUsd: 0 }, { id: 'w', name: '太太', cashTwd: 10000, cashUsd: 0 }];
  s.accounts = { emergency: 300000, monthlyExpense: 50000 };
  const h = (id, owner, cat, sym, kind, value, ccy, extra = {}) => ({ id, owner, cat, sym, name: '', kind, value, cost: null, ccy, platform: '', ...extra });
  s.holdings = [
    h('h1', 'me', 'tw', '0050', 'etf', 400000, 'TWD'),
    h('h2', 'me', 'tw', '2330', 'stock', 100000, 'TWD', { cost: 80000 }),
    h('h3', 'me', 'us', 'VOO', 'etf', 5000, 'USD'),
    h('h4', 'me', 'crypto', 'BTC', 'spot', 1000, 'USD', { platform: '交易所A' }),
    h('h5', 'me', 'crypto', 'BTC', 'staked', 500, 'USD', { platform: '交易所A' }),
    h('h6', 'w', 'bond', '00679B', 'etf', 200000, 'TWD'),
  ];
  // 目標配置剛好接近實際，避免干擾其他測試
  s.rules.targets = { tw: 54, us: 17, bond: 22, crypto: 7 };
  s.rules.platformCapPct = 100; // 範例的幣都放同一個平台，預設先不提醒
  return s;
}

// ===== 市場資料 =====
group('市場資料計算', () => {
  test('移動平均', () => eq(sma([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]));
  test('距一年高點：最高 120、現在 96 → 跌 20%', () => {
    const d = drawdown(series(10, i => [100, 110, 120, 115, 100, 98, 97, 96, 96, 96][i]));
    eq([d.high, d.last], [120, 96]);
    near(d.dd, 0.2);
  });
  test('只看最近一年（252 筆）的高點', () => eq(drawdown(series(300, i => (i < 10 ? 500 : 100))).high, 100));
  test('200 日線：一路上漲 → 在線上；60 日線乖離', () => {
    const t = trendOf(series(250, i => 100 + i));
    eq([t.above200, t.above60], [true, true]);
    near(t.ext60, 349 / 319.5 - 1);
  });
  test('「0050」找得到「0050.TW」、「btc」找得到「BTC-USD」', () => {
    const m = mkMarket({ '0050.TW': series(3, () => 1), 'BTC-USD': series(3, () => 2) });
    eq([findSeries(m, '0050').key, findSeries(m, 'btc').key, findSeries(m, 'XYZ')], ['0050.TW', 'BTC-USD', null]);
  });
  test('最新收盤與漲跌', () => {
    const l = lastOf(series(3, i => [100, 100, 110][i]));
    eq(l.v, 110);
    near(l.chg, 0.1);
  });
  test('恐懼貪婪分級（CNN）', () => eq([10, 30, 50, 60, 80].map(fngLabel), ['極度恐懼', '恐懼', '中性', '貪婪', '極度貪婪']));
  test('匯率：手動 > 自動 > 預設 32', () => {
    const s = defaultState();
    eq(fxOf(s, { series: {} }).src, '預設');
    s.settings.fx = 31.5;
    eq(fxOf(s, mkMarket()).v, 31.5);
  });
  test('GitHub Pages 網址 → 對應的最新資料網址', () => {
    eq(githubRawUrl({ hostname: 'someone.github.io', pathname: '/invest-dashboard/' }), 'https://raw.githubusercontent.com/someone/invest-dashboard/main/data/market.json');
    eq(githubRawUrl({ hostname: 'localhost', pathname: '/' }), null);
  });
});

// ===== 資產計算 =====
group('資產與配置', () => {
  test('全家：四大類金額（美元換算台幣）、現金、總額', () => {
    const p = portfolio(mkState(), mkMarket());
    eq([p.byCat.tw, p.byCat.us, p.byCat.bond, p.byCat.crypto, p.cash, p.total], [500000, 160000, 200000, 48000, 60000, 968000]);
    eq(p.efMonths, 6);
  });
  test('只看一位家人', () => {
    const p = portfolio(mkState(), mkMarket(), 'w');
    eq([p.invested, p.cash, p.byCat.bond], [200000, 10000, 200000]);
  });
  test('加密貨幣：現貨、質押分開算，加起來是加密貨幣總額', () => {
    const p = portfolio(mkState(), mkMarket());
    eq([p.cryptoSpot, p.cryptoStaked], [32000, 16000]);
  });
  test('配置比例以四大類為分母；偏離超過容許範圍才算偏高／偏低', () => {
    const s = mkState();
    s.rules.targets = { tw: 40, us: 30, bond: 20, crypto: 10 };
    const a = Object.fromEntries(portfolio(s, mkMarket()).alloc.map(x => [x.key, x.status]));
    eq(a, { tw: 'over', us: 'under', bond: 'ok', crypto: 'ok' });
  });
  test('單一標的：ETF、債券不算；同一種幣的現貨和質押合併', () => {
    const p = portfolio(mkState(), mkMarket());
    eq(p.exposures.map(e => [e.sym, e.value]), [['2330', 100000], ['BTC', 48000]]);
  });
  test('加密資產放在哪個平台', () => eq(portfolio(mkState(), mkMarket()).platforms.map(x => [x.name, x.ratio]), [['交易所A', 1]]));
  test('代號統一：2330.TW = 2330、BTC-USD = BTC', () => eq([baseSym(' 2330.tw '), baseSym('btc-usd')], ['2330', 'BTC']));
});

group('台股質押借款', () => {
  const R = defaultState().rules;
  test('維持率＝擔保品市值 ÷ 借款；再跌多少會到追繳線', () => {
    const v = pledgeView({ sym: '2330', value: 2000000, loan: 1000000, rate: 2.4 }, mkMarket(), R);
    near(v.ratio, 2);
    near(v.dropToCall, 1 - 1.3 / 2);
    near(v.interestMonth, 2000);
    eq(v.status, 'ok');
  });
  test('擔保品市值空白 → 用股數 × 收盤價', () => {
    const v = pledgeView({ sym: '2330', shares: 1000, value: null, loan: 1500000 }, mkMarket({ '2330.TW': series(3, () => 2000) }), R);
    eq([v.value, v.valueSrc.startsWith('收盤')], [2000000, true]);
    eq(v.status, 'warn');
  });
  test('低於 130% → 追繳狀態；算不出來 → unknown', () => {
    eq(pledgeView({ value: 1200000, loan: 1000000 }, mkMarket(), R).status, 'bad');
    eq(pledgeView({ sym: 'XYZ', shares: 10, loan: 1000 }, mkMarket(), R).status, 'unknown');
  });
  test('借款算負債：淨資產＝投資資產 − 借款', () => {
    const s = mkState();
    s.pledges = [{ id: 'p', owner: 'me', sym: '2330', value: 300000, loan: 100000, rate: 3 }];
    const p = portfolio(s, mkMarket());
    eq([p.loans, p.net], [100000, 868000]);
  });
});

group('定期定額', () => {
  const s0 = () => {
    const s = mkState();
    s.dca = [
      { id: 'a', owner: 'me', cat: 'tw', sym: '0050', amount: 3000, ccy: 'TWD', days: [6, 16, 26], active: true },
      { id: 'b', owner: 'w', cat: 'us', sym: 'VOO', amount: 100, ccy: 'USD', days: [18], active: true },
      { id: 'c', owner: 'me', cat: 'tw', sym: '2330', amount: 1000, ccy: 'TWD', days: [10], active: false },
    ];
    return s;
  };
  test('扣款日輸入：去重複、排序、只留 1～31', () => eq(parseDays('26, 6，16 16 40 0'), [6, 16, 26]));
  test('31 號遇到 2 月 → 算月底', () => eq(occurrences({ days: [31] }, '2027-02').map(o => o.date), ['2027-02-28']));
  test('本月扣款行程依日期排序，暫停的不算', () => {
    eq(monthSchedule(s0(), '2026-11').map(e => `${e.day}${e.item.sym}`), ['60050', '160050', '18VOO', '260050']);
  });
  test('每月總額（美元換算台幣），也分成員', () => {
    const t = monthlyTotals(s0(), 32);
    eq([t.total, t.count, t.byMember.me, t.byMember.w], [12200, 4, 9000, 3200]);
  });
  test('今天起 3 天內要扣的（含今天）', () => eq(upcoming(s0(), T, 3).map(e => e.date), ['2026-11-16', '2026-11-18']));
  test('跨月：11/29 起 10 天內包含 12/6', () => ok(upcoming(s0(), '2026-11-29', 10).some(e => e.date === '2026-12-06')));
  test('過了扣款日還沒確認的', () => {
    const s = s0();
    eq(unconfirmedPast(s, T).map(e => e.date), ['2026-11-06']);
    s.dcaChecks['2026-11'] = { 'a@6': '2026-11-06' };
    eq(unconfirmedPast(s, T).length, 0);
  });
  test('現金不夠扣：同一人同幣別加總比較', () => {
    const s = s0();
    s.members[1].cashUsd = 50;
    eq(cashShortfalls(s, upcoming(s, T, 3)), [{ owner: 'w', ccy: 'USD', need: 100, have: 50 }]);
  });
});

group('紀律清單與今日待辦', () => {
  test('配置健康時：紀律 100 分', () => {
    const s = mkState();
    eq(discipline(portfolio(s, mkMarket()), s, T).score, 100);
  });
  test('質押維持率低於追繳線 → 紅色待辦排第一', () => {
    const s = mkState();
    s.pledges = [{ id: 'p', owner: 'me', sym: '2330', value: 120000, loan: 100000 }];
    const t = todos(portfolio(s, mkMarket()), s, mkMarket(), T, NOW);
    eq(t[0].lv, 'bad');
    ok(t[0].title.includes('追繳線'), t[0].title);
  });
  test('即將扣款提醒；現金不夠 → 黃色', () => {
    const s = mkState();
    s.dca = [{ id: 'a', owner: 'w', cat: 'tw', sym: '0050', amount: 20000, ccy: 'TWD', days: [17], active: true }];
    const t = todos(portfolio(s, mkMarket()), s, mkMarket(), T, NOW);
    ok(t.some(x => x.title.includes('扣款 1 筆')), '應該有扣款提醒');
    ok(t.some(x => x.lv === 'warn' && x.title.includes('太太的台幣現金')), '應該提醒現金不夠');
  });
  test('類別偏高 → 黃色；偏低 → 一般提醒', () => {
    const s = mkState();
    s.rules.targets = { tw: 40, us: 30, bond: 20, crypto: 10 };
    const t = todos(portfolio(s, mkMarket()), s, mkMarket(), T, NOW);
    ok(t.some(x => x.lv === 'warn' && x.title.startsWith('台股占')), '台股偏高');
    ok(t.some(x => x.lv === 'info' && x.title.startsWith('美股占')), '美股偏低');
  });
  test('加密資產集中在單一平台 → 提醒', () => {
    const s = mkState();
    s.rules.platformCapPct = 50;
    const t = todos(portfolio(s, mkMarket()), s, mkMarket(), T, NOW);
    ok(t.some(x => x.title.includes('交易所A')), '應該提醒平台集中');
  });
  test('待辦依急迫度排序：紅 → 黃 → 綠 → 一般', () => {
    const s = mkState();
    s.rules.confirmed = false;
    s.rules.targets = { tw: 10, us: 10, bond: 10, crypto: 70 };
    s.pledges = [{ id: 'p', owner: 'me', value: 100, loan: 100 }];
    const order = todos(portfolio(s, mkMarket()), s, mkMarket(), T, NOW).map(x => x.lv);
    const rank = ['bad', 'warn', 'good', 'info'];
    eq(order, [...order].sort((a, b) => rank.indexOf(a) - rank.indexOf(b)));
  });
  test('近期扣款排在黃色和一般提醒前面', () => {
    const s = mkState();
    s.rules.confirmed = false;
    s.rules.targets = { tw: 40, us: 30, bond: 20, crypto: 10 };
    s.dca = [{ id: 'a', owner: 'me', cat: 'tw', sym: '0050', amount: 1000, ccy: 'TWD', days: [16], active: true }];
    const t = todos(portfolio(s, mkMarket()), s, mkMarket(), T, NOW);
    const i = t.findIndex(x => x.title.startsWith('今天扣款'));
    ok(i >= 0 && i < t.findIndex(x => x.lv === 'warn') && i < t.findIndex(x => x.title.startsWith('規則還是範例')), '扣款要在前面');
  });
});

group('大跌分段加碼', () => {
  const crash = mkMarket({ '^TWII': series(10, i => (i < 5 ? 100 : 78)) });
  test('台股跌 22% → 達第 2 段；先執行第 1 段，金額＝加碼池 ÷ 3', () => {
    const s = mkState();
    s.plan.pool = 90000;
    const d = dipPlan(s, crash);
    eq([d.reached, d.ready.tier, d.ready.amount, d.ready.lines[0].sym], [2, 1, 30000, '0050']);
  });
  test('第 1 段做完 → 接著第 2 段，金額＝剩下的池 ÷ 2', () => {
    const s = mkState();
    s.plan.pool = 60000;
    s.plan.dipUsed = { 1: T };
    eq([dipPlan(s, crash).ready.tier, dipPlan(s, crash).ready.amount], [2, 30000]);
  });
  test('加碼池是 0 → 不觸發', () => eq(dipPlan(mkState(), crash).ready, null));
});

group('買進前檢查', () => {
  const base = { owner: 'me', cat: 'tw', sym: '2317', kind: 'stock', amount: 20000, ccy: 'TWD', funding: 'cash', source: 'self' };
  const run = (inp, s = mkState(), m = mkMarket()) => checkBuy({ ...base, ...inp }, portfolio(s, m), s, m, NOW);
  const failed = r => r.checks.filter(c => !c.ok).map(c => c.label);
  const lenient = () => { const s = mkState(); s.rules.bandPct = 50; return s; };
  test('自己的錢、比例和上限都沒問題 → 可以買', () => eq(run({}, lenient()).ok, true));
  test('用融資、質押借款、合約 → 一律不通過', () => {
    for (const funding of ['margin', 'pledge', 'contract']) ok(failed(run({ funding }, lenient())).includes('只用自己的錢'), funding);
  });
  test('現金不夠 → 不要借錢買', () => ok(failed(run({ amount: 60000 }, lenient())).includes('現金夠用')));
  test('看的是「誰的帳戶」的現金', () => ok(failed(run({ owner: 'w', amount: 20000 }, lenient())).includes('現金夠用')));
  test('買完類別比例超過目標＋容許範圍 → 不通過', () => {
    ok(!failed(run({ amount: 40000 })).includes('台股比例'), '買 4 萬後 57%，還在 59% 內');
    ok(failed(run({ amount: 150000 })).includes('台股比例'), '買 15 萬後 61%，超過 59%');
  });
  test('單一標的超過上限 → 不通過', () => {
    const s = lenient();
    s.rules.singleCapPct = 1;
    ok(failed(run({}, s)).includes('單一標的上限'));
  });
  test('ETF 不看時機、不算單一標的', () => {
    const r = run({ kind: 'etf' }, lenient());
    ok(!r.checks.some(c => c.group === '趨勢') && !failed(r).includes('單一標的上限'));
  });
  test('價格在 200 日線下 → 逆勢接刀', () => {
    const m = mkMarket({ '2317.TW': series(250, i => 300 - i) });
    ok(failed(run({}, lenient(), m)).includes('長期趨勢（200 日線）'));
  });
  test('比 60 日線高 15% 以上 → 追高', () => {
    const m = mkMarket({ '2317.TW': series(250, i => (i < 230 ? 100 : 130)) });
    ok(failed(run({}, lenient(), m)).includes('不追高'));
  });
  test('因為 KOL 才想買：沒進清單 → 不通過；進清單 25 小時 → 可以', () => {
    const s = lenient();
    ok(failed(run({ source: 'kol' }, s)).includes('冷靜期'));
    s.wishlist = [{ id: 'w', sym: '2317', source: 'kol', addedAt: new Date(NOW - 25 * 3.6e6).toISOString() }];
    ok(!failed(run({ source: 'kol' }, s)).includes('冷靜期'));
    eq(Math.floor(coolStatus(s, '2317.tw', NOW).hours), 25);
  });
});

group('交易日誌統計', () => {
  const j = [
    { id: 1, source: 'kol', mood: 'fomo', action: 'long', date: '2026-10-01', result: { outcome: 'loss', pnl: -5000 } },
    { id: 2, source: 'kol', mood: 'calm', action: 'buy', date: '2026-10-02', result: { outcome: 'win', pnl: 1000 } },
    { id: 3, source: 'self', mood: 'calm', action: 'buy', date: '2026-11-10', result: null },
  ];
  test('依來源：筆數、勝率、合計損益', () => {
    const k = statsBy(j, 'source', SOURCES).find(r => r.key === 'kol');
    eq([k.n, k.closed, k.winRate, k.pnl], [2, 2, 0.5, -4000]);
  });
  test('買進超過 7 天沒記結果才提醒', () => {
    eq(pendingResults(j, T).length, 0);
    eq(pendingResults(j, '2026-11-18').length, 1);
  });
});

group('格式與備份', () => {
  test('台幣金額：萬、億', () => eq([twd(9999), twd(123456), twd(-250000000)], ['9,999 元', '12.3 萬', '−2.5 億']));
  test('百分比', () => eq([pct(0.1234), spct(0.05), spct(-0.031), spct(-0.0001)], ['12.3%', '+5.0%', '−3.1%', '0.0%']));
  test('第一版資料自動轉成第二版：持倉分類、現金搬到「我」、合約拿掉', () => {
    const s = normalize({
      schemaVersion: 1,
      accounts: { cashTwd: 1000, cashUsd: 20, emergency: 5, monthlyExpense: 1 },
      holdings: [{ id: 'x', mkt: 'us', sym: 'VOO', value: 10, bucket: 'core' }, { id: 'y', mkt: 'tw', sym: '2330', value: 5, bucket: 'sat' }],
      contracts: [{ id: 'c', sym: 'NVDA' }],
      rules: { maxLev: 5, efMonths: 3 },
    });
    eq(s.holdings.map(h => [h.cat, h.kind, h.ccy, h.owner]), [['us', 'etf', 'USD', 'me'], ['tw', 'stock', 'TWD', 'me']]);
    eq([s.members[0].cashTwd, s.members[0].cashUsd, s.accounts.emergency, 'contracts' in s, s.rules.efMonths, 'maxLev' in s.rules], [1000, 20, 5, false, 3, false]);
  });
  test('第二版資料缺欄位時自動補齊', () => {
    const s = normalize({ schemaVersion: 2, rules: { singleCapPct: 10 } });
    eq([s.rules.singleCapPct, s.rules.targets.bond, s.members[0].id, Array.isArray(s.pledges)], [10, 20, 'me', true]);
  });
  test('不是這個 App 的備份 → 拒絕', () => {
    eq(validateImport({ app: 'english-app', data: {} }).ok, false);
    eq(validateImport(exportData(defaultState())).ok, true);
  });
});

// ===== 顯示結果 =====
const all = groups.flatMap(g => g.tests);
const failedAll = all.filter(t => !t.ok);
document.getElementById('summary').innerHTML = failedAll.length
  ? `<b class="t-bad">❌ ${failedAll.length} 項失敗</b>，${all.length - failedAll.length} 項通過`
  : `<b class="t-ok">✅ 全部 ${all.length} 項通過</b>`;
document.getElementById('out').innerHTML = groups.map(g => `
  <section class="card">
    <h2>${g.name}</h2>
    ${g.tests.map(t => `
      <div class="t-row"><span class="${t.ok ? 't-ok' : 't-bad'}">${t.ok ? '✓' : '✗'}</span> ${t.name}
        ${t.ok ? '' : `<div class="t-msg">${t.msg}</div>`}</div>`).join('')}
  </section>`).join('');
window.testResults = { total: all.length, failed: failedAll.map(t => `${t.name}: ${t.msg}`) };
