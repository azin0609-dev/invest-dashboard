// 總覽：今日待辦、紀律清單、全家資產、近期扣款、市場溫度
import { getState, hasHoldings, memberName } from '../store.js';
import { getMarket, fngOf, fngLabel, findSeries, drawdown, marketAgeDays, IDX } from '../market.js';
import { portfolio } from '../calc.js';
import { discipline, todos } from '../rules.js';
import { upcoming, dayLabel } from '../dca.js';
import { todayStr, twd, usd, pct, esc } from '../util.js';
import { todoRow, discRow, pageHead } from '../ui.js';
import { stackBar } from '../chart.js';

let showAll = false;
const COLORS = { tw: 'var(--s1)', us: 'var(--s2)', bond: 'var(--s3)', crypto: 'var(--s4)' };

function welcome() {
  return `
    ${pageHead('歡迎使用投資儀表板', '先把規則和數字填好，之後每天打開看「今日待辦」就好。')}
    <section class="card">
      <h2>三個步驟開始</h2>
      <ol class="steps">
        <li><a href="#/settings"><b>看一遍規則</b></a><br><span class="muted small">四大類的目標比例、單一標的上限、預備金……都是範例數字，改成你的。</span></li>
        <li><a href="#/holdings"><b>加入家人、填持倉</b></a><br><span class="muted small">每個人分開記：台股、美股、債券、加密貨幣（現貨／質押），有台股質押借款也記上。</span></li>
        <li><a href="#/plan"><b>建立定期定額清單</b></a><br><span class="muted small">標的、金額、每月扣款日、誰的帳戶。扣款前會提醒你確認帳戶有錢。</span></li>
      </ol>
      <p class="note">所有數字只存在這台裝置的瀏覽器，不會上傳。換裝置要用「設定 → 匯出備份」搬過去。</p>
    </section>`;
}

function marketCard(s, m, today) {
  const f = fngOf(s, m);
  const age = marketAgeDays(m, today);
  const dd = [['台股', IDX.tw], ['美股', IDX.us]].map(([n, k]) => [n, drawdown(findSeries(m, k))]);
  return `
    <section class="card">
      <div class="card-head"><h2>市場溫度</h2><a class="small" href="#/market">詳情 ›</a></div>
      <div class="grid-3 stats">
        <div class="stat"><div class="sv">${f ? f.v : '—'}</div><div class="sl">恐懼貪婪<br>${f ? esc(fngLabel(f.v)) : '沒有資料'}</div></div>
        ${dd.map(([n, d]) => `<div class="stat"><div class="sv">${d ? `−${pct(d.dd)}` : '—'}</div><div class="sl">${n}距一年高點</div></div>`).join('')}
      </div>
      <p class="small muted" style="margin-top:8px">${age == null ? '還沒有市場資料' : `資料 ${age === 0 ? '今天' : `${age} 天前`}更新`} · 只當參考，不是買賣訊號</p>
    </section>`;
}

export function render(el) {
  const s = getState();
  const m = getMarket();
  const today = todayStr();
  const p = portfolio(s, m);

  if (!hasHoldings(s) && !p.total) {
    el.innerHTML = welcome() + marketCard(s, m, today);
    return;
  }

  const t = todos(p, s, m, today);
  const d = discipline(p, s, today);
  const urgent = t.filter(x => x.lv === 'bad').length;
  const list = showAll ? t : t.slice(0, 4);
  const soon = upcoming(s, today, 14).slice(0, 5);
  const money = (v, ccy) => (ccy === 'USD' ? usd(v) : twd(v));

  el.innerHTML = `
    ${pageHead('今日總覽', `${today.replace(/-/g, '/')} · 持倉更新 ${s.updatedAt ? s.updatedAt.replace(/-/g, '/') : '—'}`)}

    <section class="card">
      <div class="card-head"><h2>今日待辦</h2><span class="small muted">${t.length ? `${t.length} 項${urgent ? `，${urgent} 項要先處理` : ''}` : ''}</span></div>
      ${t.length ? `<div class="todos">${list.map(todoRow).join('')}</div>` : '<p class="note ok">✓ 今天沒有要做的事。照規則來，不用一直看盤。</p>'}
      ${t.length > 4 ? `<button type="button" class="btn ghost block" data-act="more">${showAll ? '收起' : `看全部 ${t.length} 項`}</button>` : ''}
    </section>

    <div class="grid-2 wide">
      <section class="card">
        <div class="card-head"><h2>紀律清單</h2><span class="chip ${d.score >= 80 ? 'ok' : d.score >= 50 ? 'warn' : 'bad'}">${d.score} 分</span></div>
        <div class="discs">${d.items.map(discRow).join('')}</div>
      </section>

      <div>
        <section class="card">
          <div class="card-head"><h2>全家資產</h2><a class="small" href="#/structure">配置 ›</a></div>
          <p class="big-num">${twd(p.total)}</p>
          <p class="small muted">投資資產（不含預備金）· 預備金 ${p.efMonths == null ? '—' : `${p.efMonths.toFixed(1)} 個月`}${p.loans ? ` · 質押借款 ${twd(p.loans)}` : ''}</p>
          ${stackBar(p.alloc.map(a => ({ label: a.label, value: a.value, color: COLORS[a.key], text: twd(a.value) })))}
          <p class="small muted" style="margin-top:6px">另有現金 ${twd(p.cash)}（不算在比例裡）</p>
          ${s.members.length > 1 ? `<ul class="mini-list">${s.members.map(x => `<li><span>${esc(x.name)}</span><b>${twd(portfolio(s, m, x.id).total)}</b></li>`).join('')}</ul>` : ''}
        </section>
        ${soon.length ? `
        <section class="card">
          <div class="card-head"><h2>近期扣款</h2><a class="small" href="#/plan">定投 ›</a></div>
          <ul class="mini-list">${soon.map(e => `<li><span>${dayLabel(e.date)} ${esc(memberName(s, e.item.owner))}</span><b>${esc(e.item.sym)} ${money(e.item.amount, e.item.ccy)}</b></li>`).join('')}</ul>
        </section>` : ''}
        ${marketCard(s, m, today)}
      </div>
    </div>`;

  el.querySelector('[data-act="more"]')?.addEventListener('click', () => {
    showAll = !showAll;
    render(el);
  });
}
