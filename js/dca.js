// 定期定額：每月扣款日、扣款一覽、月總額、即將扣款與確認
import { isNum, addDays, parseDate, monthOf } from './util.js';
import { toTwd } from './calc.js';

const n = v => (isNum(v) ? v : 0);

/** 「6, 16, 26」→ [6, 16, 26]（1～31，去重複、排序） */
export function parseDays(text) {
  const out = String(text || '').split(/[^\d]+/).map(Number).filter(d => d >= 1 && d <= 31);
  return [...new Set(out)].sort((a, b) => a - b);
}

function lastDay(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** 某個月的扣款日期（31 號遇到小月就算月底） */
export function occurrences(item, ym) {
  const ld = lastDay(ym);
  return [...new Set((item.days || []).map(d => Math.min(d, ld)))]
    .sort((a, b) => a - b)
    .map(d => ({ day: d, date: `${ym}-${String(d).padStart(2, '0')}` }));
}

const keyOf = (item, day) => `${item.id}@${day}`;

/** 這個月的扣款行程（只算啟用中的項目），依日期排序 */
export function monthSchedule(state, ym) {
  const checks = state.dcaChecks[ym] || {};
  return state.dca
    .filter(it => it.active !== false)
    .flatMap(it => occurrences(it, ym).map(o => ({ ...o, item: it, key: keyOf(it, o.day), confirmed: checks[keyOf(it, o.day)] || null })))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** 每月扣款總額（台幣），也分成員、分類別 */
export function monthlyTotals(state, fx) {
  const byMember = {};
  const byCat = {};
  let total = 0;
  let count = 0;
  for (const it of state.dca.filter(x => x.active !== false)) {
    const times = (it.days || []).length;
    const v = toTwd(it.amount, it.ccy, fx) * times;
    total += v;
    count += times;
    byMember[it.owner] = (byMember[it.owner] || 0) + v;
    byCat[it.cat] = (byCat[it.cat] || 0) + v;
  }
  return { total, count, byMember, byCat };
}

/** 從今天起 days 天內要扣款的（可能跨到下個月） */
export function upcoming(state, today, days = 3) {
  const end = addDays(today, days);
  const months = [...new Set([monthOf(today), monthOf(end)])];
  return months.flatMap(ym => monthSchedule(state, ym)).filter(e => e.date >= today && e.date <= end);
}

/** 本月已經過了扣款日、還沒確認的 */
export function unconfirmedPast(state, today) {
  return monthSchedule(state, monthOf(today)).filter(e => e.date < today && !e.confirmed);
}

/**
 * 即將扣款的現金夠不夠：同一個人、同一種幣別加起來，跟他的帳戶現金比
 * 回傳不夠的：[{ owner, ccy, need, have }]
 */
export function cashShortfalls(state, entries) {
  const need = new Map();
  for (const e of entries) {
    const k = `${e.item.owner}|${e.item.ccy}`;
    need.set(k, (need.get(k) || 0) + n(e.item.amount));
  }
  const out = [];
  for (const [k, v] of need) {
    const [owner, ccy] = k.split('|');
    const mem = state.members.find(x => x.id === owner);
    const have = mem ? n(ccy === 'USD' ? mem.cashUsd : mem.cashTwd) : 0;
    if (v > have) out.push({ owner, ccy, need: v, have });
  }
  return out;
}

/** 「11/18（三）」 */
export function dayLabel(date) {
  const d = parseDate(date);
  return `${d.getMonth() + 1}/${d.getDate()}（${'日一二三四五六'[d.getDay()]}）`;
}

