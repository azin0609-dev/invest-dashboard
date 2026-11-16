// 規則：紀律清單、今日待辦、大跌分段加碼、買進前檢查、冷靜期
import { isNum, monthOf, daysBetween, nowMs, twd, usd, pct, fPrice } from './util.js';
import { findSeries, trendOf, drawdown, marketAgeDays, IDX } from './market.js';
import { baseSym } from './calc.js';
import { CATS, memberName } from './store.js';
import { upcoming, unconfirmedPast, cashShortfalls, dayLabel } from './dca.js';
import { SOURCES, EMO_SOURCES, label, pendingResults } from './journal.js';

const n = v => (isNum(v) ? v : 0);
// 排序：紅 → 近期扣款（有時效）→ 黃 → 綠 → 一般
const LV_ORDER = { bad: 0, warn: 1, good: 2, info: 3 };
const rankOf = x => x.rank ?? LV_ORDER[x.lv];
const catLabel = k => label(CATS, k);
const money = (v, ccy) => (ccy === 'USD' ? usd(v) : twd(v));

// ===== 紀律清單（ok：1 通過、0.5 無法確認、0 沒通過）；p 是全家合計 =====
export function discipline(p, s, today) {
  const R = s.rules;
  const items = [];
  items.push({
    key: 'ef', label: `預備金至少 ${R.efMonths} 個月`, href: '#/holdings',
    ok: p.efMonths != null && p.efMonths >= R.efMonths ? 1 : 0,
    detail: p.efMonths == null ? '還沒填生活費' : `${p.efMonths.toFixed(1)} 個月`,
  });
  const off = p.alloc.filter(a => a.status === 'over' || a.status === 'under');
  items.push({
    key: 'alloc', label: `四大類都在目標 ±${R.bandPct}% 內`, href: '#/structure',
    ok: !p.invested ? 0.5 : off.length ? 0 : 1,
    detail: !p.invested ? '還沒有持倉' : off.length ? off.map(a => `${a.label}${a.status === 'over' ? '偏高' : '偏低'}`).join('、') : '都在範圍內',
  });
  const top = p.exposures[0];
  items.push({
    key: 'single', label: `單一標的不超過 ${R.singleCapPct}%`, href: '#/structure',
    ok: !top || top.ratio <= R.singleCapPct / 100 ? 1 : 0,
    detail: top ? `${top.name} ${pct(top.ratio)}` : '沒有個股',
  });
  if (p.platforms.length) {
    const tp = p.platforms[0];
    items.push({
      key: 'platform', label: `加密資產單一平台不超過 ${R.platformCapPct}%`, href: '#/structure',
      ok: tp.ratio <= R.platformCapPct / 100 ? 1 : 0, detail: `${tp.name} ${pct(tp.ratio, 0)}`,
    });
  }
  if (p.pledges.length) {
    const low = p.pledges.filter(x => x.status === 'bad' || x.status === 'warn').length;
    const unknown = p.pledges.filter(x => x.status === 'unknown').length;
    items.push({
      key: 'pledge', label: `質押維持率都在 ${R.pledgeWarnPct}% 以上`, href: '#/holdings',
      ok: low ? 0 : unknown ? 0.5 : 1,
      detail: low ? `${low} 筆偏低` : unknown ? `${unknown} 筆算不出來` : '都安全',
    });
  }
  if (s.dca.some(x => x.active !== false)) {
    const miss = unconfirmedPast(s, today).length;
    items.push({ key: 'dca', label: '本月扣款都確認過', href: '#/plan', ok: miss ? 0 : 1, detail: miss ? `${miss} 筆還沒確認` : '都確認了' });
  }
  items.push({
    key: 'opens', label: `今天打開不超過 ${R.opensPerDay} 次`, href: null,
    ok: s.opens.n <= R.opensPerDay ? 1 : 0, detail: `第 ${s.opens.n} 次`,
  });
  const score = Math.round((items.reduce((a, x) => a + x.ok, 0) / items.length) * 100);
  return { items, score };
}

// ===== 大跌分段加碼 =====
export function dipPlan(s, m) {
  const tiers = s.rules.dipTiers;
  const markets = [
    ['tw', '台股加權', IDX.tw, s.plan.twEtf || '0050'],
    ['us', 'S&P 500', IDX.us, s.plan.usEtf || 'VOO'],
  ].map(([key, name, idx, etf]) => {
    const d = drawdown(findSeries(m, idx));
    return { key, name, etf, info: d, dd: d ? d.dd : null, tier: d ? tiers.filter(t => d.dd * 100 >= t).length : 0 };
  });
  const reached = Math.max(0, ...markets.map(x => x.tier));
  const used = [1, 2, 3].filter(i => s.plan.dipUsed[i]);
  const remaining = 3 - used.length;
  const pool = Math.max(0, n(s.plan.pool));
  const perTier = remaining ? pool / remaining : 0;
  const nextTier = [1, 2, 3].find(i => i <= reached && !s.plan.dipUsed[i]) || null;
  let ready = null;
  if (nextTier && pool > 0) {
    const hit = markets.filter(x => x.tier >= nextTier);
    ready = {
      tier: nextTier,
      amount: perTier,
      market: hit.map(x => x.name).join('、'),
      dd: Math.max(...hit.map(x => x.dd)),
      lines: hit.map(x => ({ sym: x.etf, mkt: x.key, amount: perTier / hit.length })),
    };
  }
  const nearHigh = markets.every(x => x.dd != null && x.dd < 0.05);
  return { markets, tiers, reached, used, perTier, pool, ready, canReset: used.length > 0 && nearHigh };
}

// ===== 今日待辦；p 是全家合計 =====
export function todos(p, s, m, today, now = nowMs()) {
  const R = s.rules;
  const t = [];
  const add = (lv, icon, title, detail, href) => t.push({ lv, icon, title, detail, href });
  const who = id => memberName(s, id);

  if (!R.confirmed) add('info', '⚙️', '規則還是範例數字', '到「設定」看一遍，改成適合你的數字後按「確認規則」', '#/settings');
  if (s.updatedAt && daysBetween(s.updatedAt, today) >= 14) {
    add('info', '✏️', `持倉 ${daysBetween(s.updatedAt, today)} 天沒更新`, '打開券商和交易所 App，把最新市值抄進來', '#/holdings');
  }
  const age = marketAgeDays(m, today);
  if (age == null) add('info', '📡', '還沒有市場資料', 'GitHub 每天會自動抓兩次；抓到之前，均線和距高點的檢查會先跳過', '#/market');
  else if (age >= 4) add('info', '📡', `市場資料 ${age} 天沒更新`, '到 GitHub 的 Actions 看「更新市場資料」有沒有出錯', '#/market');

  // 定期定額：接下來 3 天要扣款的，先確認帳戶有錢
  const soon = upcoming(s, today, 3);
  if (soon.length) {
    const short = cashShortfalls(s, soon);
    const dates = [...new Set(soon.map(e => e.date))];
    for (const d of dates) {
      const es = soon.filter(e => e.date === d);
      const tight = es.some(e => short.some(x => x.owner === e.item.owner && x.ccy === e.item.ccy));
      add(tight ? 'warn' : 'info', '💳', `${d === today ? '今天' : dayLabel(d)}扣款 ${es.length} 筆`,
        es.map(e => `${who(e.item.owner)} ${e.item.sym} ${money(e.item.amount, e.item.ccy)}`).join('、'), '#/plan');
      t.at(-1).rank = 0.5;
    }
    for (const x of short) {
      add('warn', '💰', `${who(x.owner)}的${x.ccy === 'USD' ? '美元' : '台幣'}現金可能不夠扣`,
        `接下來要扣 ${money(x.need, x.ccy)}，帳戶記錄是 ${money(x.have, x.ccy)}。先轉帳，或更新「持倉」的現金數字`, '#/holdings');
    }
  }
  const miss = unconfirmedPast(s, today);
  if (miss.length) add('info', '✅', `${miss.length} 筆扣款還沒確認`, '到券商 App 看有沒有扣成功，到「定投」打勾', '#/plan');

  for (const a of p.alloc.filter(x => x.status === 'over')) {
    add('warn', '⚖️', `${a.label}占 ${pct(a.ratio, 0)}，高於目標 ${pct(a.target, 0)}`, `新資金先不買${a.label}；有獲利時可以把多出的約 ${twd(-a.gap)} 移到偏低的類別`, '#/structure');
  }
  for (const a of p.alloc.filter(x => x.status === 'under')) {
    add('info', '⚖️', `${a.label}占 ${pct(a.ratio, 0)}，低於目標 ${pct(a.target, 0)}`, `新資金優先補${a.label}，差約 ${twd(a.gap)}`, '#/structure');
  }
  for (const e of p.exposures.filter(x => x.ratio > R.singleCapPct / 100)) {
    add('warn', '🎯', `${e.name} 占 ${pct(e.ratio)}，超過單一標的上限 ${R.singleCapPct}%`, '這一檔不再加碼', '#/structure');
  }
  for (const x of p.platforms.filter(y => y.ratio > R.platformCapPct / 100)) {
    add('warn', '🏦', `加密資產有 ${pct(x.ratio, 0)} 放在 ${x.name}`, `超過單一平台上限 ${R.platformCapPct}%。交易所出事時可能一次領不出來，考慮分散或轉到自己的錢包`, '#/structure');
  }
  for (const x of p.pledges) {
    const name = `${who(x.owner)}的 ${x.sym || '質押'}${x.broker ? `（${x.broker}）` : ''}`;
    if (x.status === 'bad') {
      add('bad', '🚨', `${name}維持率 ${pct(x.ratio, 0)}，低於追繳線 ${R.pledgeCallPct}%`, '券商會要求補錢或補擔保品，不補會被賣掉。先準備資金，不要再借', '#/holdings');
    } else if (x.status === 'warn') {
      add('warn', '⚠️', `${name}維持率 ${pct(x.ratio, 0)}`, `再跌 ${pct(x.dropToCall)} 就會被追繳。考慮先還一部分借款`, '#/holdings');
    } else if (x.status === 'unknown') {
      add('info', '❓', `${name}算不出維持率`, '填擔保品市值，或填股數（有收盤價的標的會自動算）', '#/holdings');
    }
    if (x.due && daysBetween(today, x.due) >= 0 && daysBetween(today, x.due) <= 30) {
      add('info', '📆', `${name}借款 ${daysBetween(today, x.due)} 天後到期`, `借款 ${twd(x.loan)}：要還款還是展延，先決定好`, '#/holdings');
    }
  }
  if (p.efMonths == null) add('info', '🛟', '還沒填預備金和每月生活費', '先確定生活費有著落，才知道能投多少', '#/holdings');
  else if (p.efMonths < R.efMonths) add('warn', '🛟', `預備金 ${p.efMonths.toFixed(1)} 個月，目標 ${R.efMonths} 個月`, '先把預備金補足，再增加投資', '#/holdings');

  const dip = dipPlan(s, m);
  if (dip.ready) add('good', '🪙', `大跌加碼第 ${dip.ready.tier} 段觸發，可動用 ${twd(dip.ready.amount)}`, `${dip.ready.market}距一年高點 −${pct(dip.ready.dd)}`, '#/plan');

  for (const w of s.wishlist) {
    const c = coolOf(s, w, now);
    if (c.ready) add('info', '⏳', `${w.sym} 冷靜期已過`, '還想買的話，先到「下單前」跑一次檢查；不想買了就刪掉', '#/check');
  }
  const pend = pendingResults(s.journal, today);
  if (pend.length) add('info', '📓', `${pend.length} 筆交易還沒記結果`, '記下賺賠，才看得出哪種消息來源最常讓你賠錢', '#/journal');

  return t.sort((a, b) => rankOf(a) - rankOf(b));
}

// ===== 冷靜期 =====
function coolOf(s, w, now) {
  const hours = (now - Date.parse(w.addedAt)) / 3.6e6;
  return { item: w, hours, hoursLeft: Math.max(0, s.rules.coolHours - hours), ready: hours >= s.rules.coolHours };
}

export function coolStatus(s, sym, now = nowMs()) {
  const w = s.wishlist.find(x => baseSym(x.sym) === baseSym(sym));
  return w ? coolOf(s, w, now) : null;
}

// ===== 買進前檢查 =====
function trendChecks(add, sym, m, R) {
  if (!sym) {
    add('趨勢', true, '趨勢', '先填代號', true);
    return;
  }
  const t = trendOf(findSeries(m, sym));
  if (!t) {
    add('趨勢', true, '趨勢', `沒有 ${sym} 的價格資料，先跳過（要自動抓價，把它加進 data/watchlist.json）`, true);
    return;
  }
  if (t.ma200 == null) {
    add('趨勢', true, '長期趨勢（200 日線）', '資料不到 200 天，先跳過', true);
  } else {
    add('趨勢', t.above200, '長期趨勢（200 日線）',
      `收盤 ${fPrice(t.price)}，200 日線 ${fPrice(t.ma200)}：${t.above200 ? '在線上，順勢' : '在線下，逆勢接刀'}`);
  }
  if (t.ma60 == null) {
    add('趨勢', true, '不追高', '資料不到 60 天，先跳過', true);
  } else {
    const chase = t.ext60 > R.chasePct / 100;
    add('趨勢', !chase, '不追高', `現價比 60 日線 ${fPrice(t.ma60)} ${t.ext60 >= 0 ? '高' : '低'} ${pct(Math.abs(t.ext60))}${chase ? `，超過 ${R.chasePct}%` : ''}`);
  }
}

/**
 * 買進前：逐項檢查。p 要用全家合計
 * inp: { owner, cat, sym, kind（見 KINDS）, amount, ccy, funding:'cash'|'margin'|'pledge'|'contract', source }
 */
export function checkBuy(inp, p, s, m, now = nowMs()) {
  const R = s.rules;
  const sym = baseSym(inp.sym);
  const amt = n(inp.amount) * (inp.ccy === 'USD' ? p.fx : 1);
  const checks = [];
  const add = (group, ok, label_, detail, skip = false) => checks.push({ group, ok, label: label_, detail, skip });

  add('資金', inp.funding === 'cash', '只用自己的錢',
    inp.funding === 'cash' ? '用自己的現金' : '你已經決定戒掉合約和融資：用借來的錢（融資、質押借款）或槓桿的，這筆不做');
  add('資金', amt > 0, '金額', amt > 0 ? twd(amt) : '先填金額');
  add('資金', p.efMonths != null && p.efMonths >= R.efMonths, '預備金',
    p.efMonths == null ? '還沒填預備金和生活費' : `${p.efMonths.toFixed(1)} 個月${p.efMonths >= R.efMonths ? '' : `，不到 ${R.efMonths} 個月：先補預備金`}`);
  const mem = s.members.find(x => x.id === inp.owner) || s.members[0];
  const cash = inp.ccy === 'USD' ? n(mem.cashUsd) : n(mem.cashTwd);
  add('資金', n(inp.amount) <= cash, '現金夠用',
    `${mem.name}的${inp.ccy === 'USD' ? '美元' : '台幣'}現金 ${money(cash, inp.ccy)}${n(inp.amount) <= cash ? '' : '，不夠：不要借錢買'}`);

  const a = p.alloc.find(x => x.key === inp.cat);
  if (a) {
    const after = (a.value + amt) / (p.invested + amt || 1);
    const upper = a.target + R.bandPct / 100;
    add('配置', after <= upper, `${a.label}比例`, `買完${a.label}占 ${pct(after, 0)}，目標 ${pct(a.target, 0)}（最多 ${pct(upper, 0)}）`);
  }
  if (inp.kind === 'etf' || inp.cat === 'bond') {
    add('配置', true, '分散型標的', 'ETF 和債券照定期定額和大跌加碼的規則買，不用看時機');
  } else {
    const ex = p.exposures.find(e => e.sym === sym);
    const exR = p.total ? ((ex ? ex.value : 0) + amt) / p.total : null;
    add('配置', exR != null && exR <= R.singleCapPct / 100, '單一標的上限',
      exR == null ? '先到「持倉」填資料' : `買完 ${sym || '這檔'} 占投資資產 ${pct(exR, 0)}，上限 ${R.singleCapPct}%`);
    trendChecks(add, sym, m, R);
  }

  const src = label(SOURCES, inp.source);
  if (!EMO_SOURCES.includes(inp.source)) {
    add('冷靜期', true, '想法來源', `${src}，不用冷靜期`);
  } else {
    const c = coolStatus(s, sym, now);
    if (!c) add('冷靜期', false, '冷靜期', `因為${src}才想買：先放進想買清單，${R.coolHours} 小時後還想買再來`);
    else if (!c.ready) add('冷靜期', false, '冷靜期', `已放進清單，還要等 ${Math.ceil(c.hoursLeft)} 小時`);
    else add('冷靜期', true, '冷靜期', `放進清單 ${Math.floor(c.hours)} 小時，冷靜期已過`);
  }

  const fails = checks.filter(c => !c.ok).length;
  return { checks, ok: fails === 0, fails, amount: amt, catLabel: catLabel(inp.cat) };
}
