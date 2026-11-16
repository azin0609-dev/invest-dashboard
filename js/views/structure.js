// 配置：全家或單一家人的四大類比例、目標與再平衡、單一標的、加密資產平台、質押借款、損益（平日隱藏，週日才開放）
import { getState, save } from '../store.js';
import { getMarket } from '../market.js';
import { portfolio } from '../calc.js';
import { todayStr, weekday, monthOf, twd, pct, spct, esc } from '../util.js';
import { pageHead, chip, upDown } from '../ui.js';
import { stackBar, hbars } from '../chart.js';

let reveal = false;
let who = null; // null = 全家

const COLORS = { tw: 'var(--s1)', us: 'var(--s2)', bond: 'var(--s3)', crypto: 'var(--s4)' };
const ST = {
  over: ['warn', '偏高'],
  under: ['info', '偏低'],
  ok: ['good', '在範圍內'],
  none: ['info', '—'],
};

export function render(el) {
  const s = getState();
  const m = getMarket();
  const R = s.rules;
  const today = todayStr();
  if (who && !s.members.some(x => x.id === who)) who = null;
  const p = portfolio(s, m, who);
  const fam = who == null;
  const sunday = weekday(today) === 0;
  const showPnl = sunday || reveal;
  const peeks = s.peeks[monthOf(today)] || 0;
  const daysToSunday = (7 - weekday(today)) % 7;
  const single = R.singleCapPct / 100;
  const pick = `<div class="member-pick" role="group" aria-label="看誰的配置">
    <button type="button" data-who="" class="${fam ? 'on' : ''}">全家</button>
    ${s.members.map(x => `<button type="button" data-who="${x.id}" class="${who === x.id ? 'on' : ''}">${esc(x.name)}</button>`).join('')}
  </div>`;

  if (!p.total) {
    el.innerHTML = `<div class="view">${pageHead('資產配置')}${pick}<section class="card"><p>還沒有資料。先到 <a href="#/holdings">持倉</a> 填數字。</p></section></div>`;
    bind(el);
    return;
  }

  el.innerHTML = `<div class="view">
    ${pageHead('資產配置', '四大類：台股、美股、債券、加密貨幣。比例偏離目標太多才調整。')}
    ${pick}

    <section class="card">
      <div class="card-head"><h2>${fam ? '全家' : esc(s.members.find(x => x.id === who).name)}投資資產</h2><span class="small muted">不含預備金 · 匯率 ${p.fx.toFixed(2)}</span></div>
      <p class="big-num">${twd(p.total)}</p>
      ${p.loans ? `<p class="small muted">扣掉質押借款 ${twd(p.loans)}，淨資產 ${twd(p.net)}</p>` : ''}
      ${stackBar(p.alloc.map(a => ({ label: a.label, value: a.value, color: COLORS[a.key], text: twd(a.value) })))}
      <p class="small muted" style="margin-top:6px">另有現金 ${twd(p.cash)}（不算在比例裡）</p>
    </section>

    <section class="card">
      <div class="card-head"><h2>目標配置</h2><span class="small muted">${fam ? `偏離 ±${R.bandPct}% 內不用動` : '目標是全家的，這裡只當參考'}</span></div>
      <div class="table-scroll"><table class="data">
        <thead><tr><th>類別</th><th>實際</th><th>目標</th><th>差距</th><th>狀態</th></tr></thead>
        <tbody>${p.alloc.map(a => `<tr><td>${a.label}</td><td>${pct(a.ratio, 0)}</td><td>${pct(a.target, 0)}</td><td>${spct(a.diff, 0)}</td><td>${chip(...ST[a.status])}</td></tr>`).join('')}</tbody>
      </table></div>
      ${fam ? (() => {
        const over = p.alloc.filter(a => a.status === 'over');
        const under = p.alloc.filter(a => a.status === 'under');
        if (!over.length && !under.length) return '<p class="note ok">✓ 四大類都在目標範圍內，不用調整。</p>';
        return `<p class="note warn">${[
          ...over.map(a => `${a.label}多了約 ${twd(-a.gap)}：先停止加碼，有獲利時分批移出`),
          ...under.map(a => `${a.label}少了約 ${twd(a.gap)}：新資金優先買這類`),
        ].join('<br>')}</p>`;
      })() : ''}
    </section>

    <section class="card">
      <div class="card-head"><h2>單一標的</h2><span class="small muted">個股和幣（ETF、債券不算）</span></div>
      ${hbars(p.exposures.map(e => ({ label: e.name, value: e.ratio, text: `${pct(e.ratio)} · ${twd(e.value)}`, over: e.ratio > single })), { cap: single, capLabel: `上限 ${R.singleCapPct}%` })}
    </section>

    ${p.byCat.crypto ? `
    <section class="card">
      <div class="card-head"><h2>加密貨幣</h2><span class="small muted">${twd(p.byCat.crypto)}</span></div>
      <ul class="mini-list"><li><span>現貨</span><b>${twd(p.cryptoSpot)}</b></li><li><span>質押（鎖倉中）</span><b>${twd(p.cryptoStaked)}</b></li></ul>
      <h3 style="margin-top:14px">放在哪些平台</h3>
      ${hbars(p.platforms.map(x => ({ label: x.name, value: x.ratio, text: `${pct(x.ratio)} · ${twd(x.value)}`, over: x.ratio > R.platformCapPct / 100 })), { cap: R.platformCapPct / 100, capLabel: `上限 ${R.platformCapPct}%` })}
      <p class="small muted">交易所出事時可能領不出來，放太集中風險就大。質押中的幣通常要等解鎖才能賣。</p>
    </section>` : ''}

    ${p.pledges.length ? `
    <section class="card">
      <div class="card-head"><h2>台股質押借款</h2><a class="small" href="#/holdings">管理 ›</a></div>
      <ul class="mini-list">
        <li><span>借款合計</span><b>${twd(p.loans)}</b></li>
        <li><span>每月利息約</span><b>${twd(p.interestMonth)}</b></li>
        ${p.pledges.map(x => `<li><span>${esc(x.sym || '擔保品')}${x.broker ? ` · ${esc(x.broker)}` : ''}</span><b>維持率 ${x.ratio == null ? '—' : pct(x.ratio, 0)} ${x.status === 'bad' ? chip('bad', '低於追繳線') : x.status === 'warn' ? chip('warn', '偏低') : x.status === 'ok' ? chip('good', '安全') : ''}</b></li>`).join('')}
      </ul>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>損益</h2><span class="small muted">每週日開放</span></div>
      ${showPnl ? `
        <div class="grid-2 stats">
          ${p.alloc.map(a => `<div class="stat"><div class="sv">${upDown(p.pnl.byCat[a.key], twd(p.pnl.byCat[a.key]))}</div><div class="sl">${a.label}未實現</div></div>`).join('')}
        </div>
        <p class="small muted" style="margin-top:10px">只算有填成本的持倉。看完記得：已經發生的賺賠，不會改變下一步該做什麼。${!sunday ? ` 本月提前看了 ${peeks} 次。` : ''}</p>`
      : `
        <div class="lock">
          <p>🔒 <b>損益金額先藏起來</b></p>
          <p class="small muted">還有 ${daysToSunday} 天到週日。平日只看配置和紀律，避免賺賠的數字影響判斷。</p>
          <button type="button" class="btn ghost sm" data-act="peek">我了解，仍要提前看（會記錄次數）</button>
          ${peeks ? `<p class="small muted">本月已提前看 ${peeks} 次</p>` : ''}
        </div>`}
    </section>
  </div>`;
  bind(el);

  el.querySelector('[data-act="peek"]')?.addEventListener('click', () => {
    const k = monthOf(today);
    s.peeks[k] = (s.peeks[k] || 0) + 1;
    save();
    reveal = true;
    render(el);
  });
  // 離開這頁就重新藏起來
  return () => { reveal = false; };
}

function bind(el) {
  el.querySelectorAll('[data-who]').forEach(b => b.addEventListener('click', () => {
    who = b.dataset.who || null;
    render(el);
  }));
}
