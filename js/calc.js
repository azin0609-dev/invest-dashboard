// 資產計算：四大類配置、現金、預備金、單一標的曝險、加密資產放在哪些平台、台股質押借款
import { isNum } from './util.js';
import { fxOf, findSeries, lastOf } from './market.js';
import { CATS } from './store.js';

const n = v => (isNum(v) ? v : 0);
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);

/** 代號統一寫法：「2330.TW」「2330」都當成 2330；「BTC-USD」當成 BTC */
export function baseSym(sym) {
  return String(sym || '').trim().toUpperCase().replace(/\.(TW|TWO)$/, '').replace(/-USDT?$/, '');
}

export function toTwd(v, ccy, fx) {
  return n(v) * (ccy === 'USD' ? fx : 1);
}

/**
 * 一筆台股質押：擔保品市值、維持率、再跌多少會被追繳、每月利息
 * 擔保品市值空白時，用股數 × 自動抓的收盤價
 */
export function pledgeView(x, m, R) {
  const auto = lastOf(findSeries(m, x.sym));
  const manual = isNum(x.value) && x.value > 0;
  const value = manual ? x.value : auto && n(x.shares) ? n(x.shares) * auto.v : null;
  const loan = n(x.loan);
  const ratio = value != null && loan > 0 ? value / loan : null;
  const call = R.pledgeCallPct / 100;
  return {
    ...x,
    value,
    valueSrc: manual ? '手動' : auto && n(x.shares) ? `收盤 ${auto.date}` : null,
    loan,
    ratio,
    // 擔保品再跌多少，維持率就會掉到追繳線
    dropToCall: ratio != null ? 1 - call / ratio : null,
    interestMonth: (loan * n(x.rate)) / 100 / 12,
    status: ratio == null ? 'unknown' : ratio < call ? 'bad' : ratio < R.pledgeWarnPct / 100 ? 'warn' : 'ok',
  };
}

/**
 * 資產總覽（全部換算成台幣）
 * owner：null = 全家合計；給成員 id 就只算那個人
 */
export function portfolio(state, m, owner = null) {
  const fx = fxOf(state, m).v;
  const R = state.rules;
  const mine = x => owner == null || x.owner === owner;
  const H = state.holdings.filter(mine).map(h => ({ ...h, twd: toTwd(h.value, h.ccy, fx), twdCost: toTwd(h.cost, h.ccy, fx) }));
  const members = state.members.filter(x => owner == null || x.id === owner);
  const cash = sum(members, x => n(x.cashTwd) + n(x.cashUsd) * fx);

  const byCat = Object.fromEntries(CATS.map(([k]) => [k, 0]));
  H.forEach(h => { if (h.cat in byCat) byCat[h.cat] += h.twd; });
  const crypto = H.filter(h => h.cat === 'crypto');
  const cryptoStaked = sum(crypto.filter(h => h.kind === 'staked'), h => h.twd);
  const invested = sum(Object.values(byCat), v => v);
  const total = invested + cash;
  const a = state.accounts;
  const efMonths = n(a.monthlyExpense) > 0 ? n(a.emergency) / a.monthlyExpense : null;

  // 配置：比例以四大類加總為分母（現金另外看）
  const band = R.bandPct / 100;
  const alloc = CATS.map(([key, label]) => {
    const value = byCat[key];
    const ratio = invested ? value / invested : null;
    const target = n(R.targets[key]) / 100;
    const diff = ratio == null ? null : ratio - target;
    const status = diff == null ? 'none' : diff > band ? 'over' : diff < -band ? 'under' : 'ok';
    return { key, label, value, ratio, target, diff, status, gap: target * invested - value };
  });

  // 單一標的曝險：個股和幣（ETF、債券不算），現貨和質押的同一種幣合併
  const ex = new Map();
  for (const h of H.filter(x => x.kind === 'stock' || x.cat === 'crypto')) {
    const k = baseSym(h.sym) || h.name || '未命名';
    const e = ex.get(k) || { sym: k, name: h.name || k, value: 0 };
    e.value += h.twd;
    ex.set(k, e);
  }
  const exposures = [...ex.values()]
    .map(e => ({ ...e, ratio: total ? e.value / total : null }))
    .sort((x, y) => y.value - x.value);

  // 加密資產放在哪些平台（交易所倒閉風險）
  const pl = new Map();
  crypto.forEach(h => { const k = h.platform || '沒填平台'; pl.set(k, (pl.get(k) || 0) + h.twd); });
  const platforms = [...pl.entries()]
    .map(([name, value]) => ({ name, value, ratio: byCat.crypto ? value / byCat.crypto : null }))
    .sort((x, y) => y.value - x.value);

  // 台股質押借款（負債）
  const pledges = state.pledges.filter(mine).map(x => pledgeView(x, m, R));
  const loans = sum(pledges, x => x.loan);

  const withCost = H.filter(h => n(h.cost) > 0);
  const pnlByCat = Object.fromEntries(CATS.map(([k]) => [k, sum(withCost.filter(h => h.cat === k), h => h.twd - h.twdCost)]));
  return {
    fx, owner, holdings: H, cash, byCat, invested, total, efMonths, alloc, exposures, platforms,
    cryptoSpot: byCat.crypto - cryptoStaked, cryptoStaked,
    pledges, loans, net: total - loans, interestMonth: sum(pledges, x => x.interestMonth),
    pnl: { byCat: pnlByCat, total: sum(Object.values(pnlByCat), v => v) },
  };
}
