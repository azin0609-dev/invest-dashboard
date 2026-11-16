// 定投：定期定額扣款一覽（標的、金額、扣款日、誰的帳戶）、本月扣款月曆與確認、大跌分段加碼
import { getState, save, touch, memberName, CATS, CAT_CCY } from '../store.js';
import { getMarket, fxOf } from '../market.js';
import { dipPlan } from '../rules.js';
import { monthSchedule, monthlyTotals, parseDays, dayLabel, cashShortfalls, upcoming } from '../dca.js';
import { todayStr, monthOf, parseDate, twd, usd, pct, shortDate, esc, uid } from '../util.js';
import { pageHead, chip, numField, textField, selectField, readValue, confirmBox, toast, changed } from '../ui.js';
import { meter } from '../chart.js';

const open = new Set();
const money = (v, ccy) => (ccy === 'USD' ? usd(v) : twd(v));

function dcaSummary(s, it) {
  const days = (it.days || []).join('、');
  return `${it.active === false ? '⏸ ' : ''}每月 ${days || '?'} 日 · ${esc(it.sym || '新標的')} · ${money(it.amount, it.ccy)} · ${esc(memberName(s, it.owner))}${it.broker ? ` · ${esc(it.broker)}` : ''}`;
}

function dcaRow(s, it) {
  const b = f => `data-dca="${it.id}" data-f="${f}"`;
  return `
    <details class="row-card" data-row="${it.id}" ${open.has(it.id) ? 'open' : ''}>
      <summary><span data-sum="${it.id}">${dcaSummary(s, it)}</span></summary>
      <div class="form-grid">
        ${selectField('誰的帳戶', 'owner', it.owner, s.members.map(x => [x.id, x.name]), { attrs: b('owner') })}
        ${selectField('類別', 'cat', it.cat, CATS, { attrs: b('cat') })}
        ${textField('代號', 'sym', it.sym, { placeholder: '例如 0050', attrs: b('sym') })}
        ${textField('名稱', 'name', it.name, { placeholder: '自己看得懂就好', attrs: b('name') })}
        ${numField('每次扣款金額', 'amount', it.amount, { attrs: b('amount') })}
        ${selectField('幣別', 'ccy', it.ccy, [['TWD', '台幣'], ['USD', '美元']], { attrs: b('ccy') })}
        ${textField('每月扣款日', 'days', (it.days || []).join(', '), { placeholder: '例如 6, 16, 26', hint: '可以填好幾天，用逗號隔開', attrs: b('days') })}
        ${textField('券商／平台', 'broker', it.broker, { placeholder: '在哪裡扣款', attrs: b('broker') })}
        <label class="field check-field"><input type="checkbox" ${b('active')} ${it.active !== false ? 'checked' : ''}><span>扣款中（暫停就取消勾選）</span></label>
      </div>
      <button type="button" class="btn danger sm" data-del="${it.id}">刪除這筆</button>
    </details>`;
}

/** 本月月曆：有扣款的日子標金額 */
function calendar(sched, ym, today, fx) {
  const [y, mo] = ym.split('-').map(Number);
  const first = new Date(y, mo - 1, 1).getDay();
  const days = new Date(y, mo, 0).getDate();
  const byDay = {};
  for (const e of sched) {
    const d = (byDay[e.day] ||= { amt: 0, n: 0, done: 0 });
    d.amt += e.item.ccy === 'USD' ? (e.item.amount || 0) * fx : e.item.amount || 0;
    d.n++;
    if (e.confirmed) d.done++;
  }
  const cells = [];
  for (let i = 0; i < first; i++) cells.push('<div class="cal-cell empty"></div>');
  for (let d = 1; d <= days; d++) {
    const date = `${ym}-${String(d).padStart(2, '0')}`;
    const x = byDay[d];
    const cls = [x ? 'has' : '', date === today ? 'today' : '', x && x.done === x.n ? 'done' : ''].join(' ');
    cells.push(`<div class="cal-cell ${cls}"><span class="cd">${d}</span>${x ? `<span class="ca">${twd(x.amt).replace(' 元', '')}</span><span class="cn">${x.done === x.n ? '✓' : `${x.n} 筆`}</span>` : ''}</div>`);
  }
  return `<div class="cal" role="table" aria-label="${mo} 月扣款月曆">
    ${'日一二三四五六'.split('').map(w => `<div class="cal-head">${w}</div>`).join('')}
    ${cells.join('')}</div>`;
}

export function render(el) {
  const s = getState();
  const m = getMarket();
  const R = s.rules;
  const today = todayStr();
  const ym = monthOf(today);
  const fx = fxOf(s, m).v;
  const sched = monthSchedule(s, ym);
  const tot = monthlyTotals(s, fx);
  const dip = dipPlan(s, m);
  const short = cashShortfalls(s, upcoming(s, today, 7));
  const list = [...s.dca].sort((a, b) => ((a.days || [99])[0] - (b.days || [99])[0]) || String(a.owner).localeCompare(String(b.owner)));

  el.innerHTML = `<div class="view">
    ${pageHead('定投與加碼', '每月扣款一覽：什麼時候、誰的帳戶、扣多少。大跌時照規則分段加碼。')}

    <section class="card">
      <div class="card-head"><h2>每月扣款合計</h2><span class="small muted">${tot.count} 次扣款</span></div>
      <p class="big-num">${twd(tot.total)}</p>
      ${tot.count ? `
        <div class="grid-2">
          <ul class="mini-list">${s.members.filter(x => tot.byMember[x.id]).map(x => `<li><span>${esc(x.name)}</span><b>${twd(tot.byMember[x.id])}</b></li>`).join('')}</ul>
          <ul class="mini-list">${CATS.filter(([k]) => tot.byCat[k]).map(([k, l]) => `<li><span>${l}</span><b>${twd(tot.byCat[k])}</b></li>`).join('')}</ul>
        </div>` : '<p class="note">在下面「扣款標的一覽」新增第一筆定期定額。</p>'}
      ${short.map(x => `<p class="note warn">💰 ${esc(memberName(s, x.owner))}的${x.ccy === 'USD' ? '美元' : '台幣'}現金 ${money(x.have, x.ccy)}，未來 7 天要扣 ${money(x.need, x.ccy)}，可能不夠。</p>`).join('')}
    </section>

    ${sched.length ? `
    <section class="card">
      <div class="card-head"><h2>${Number(ym.slice(5))} 月扣款</h2><span class="small muted">扣款後到券商 App 確認，再打勾</span></div>
      ${calendar(sched, ym, today, fx)}
      <ul class="list" style="margin-top:12px">${sched.map(e => {
        const past = e.date <= today;
        const st = e.confirmed ? chip('good', '已確認') : e.date < today ? chip('warn', '待確認') : e.date === today ? chip('info', '今天') : `<span class="chip">${Math.round((parseDate(e.date) - parseDate(today)) / 864e5)} 天後</span>`;
        return `<li class="list-item">
          <div class="li-main"><div class="li-title">${dayLabel(e.date)} ${esc(e.item.sym)} ${esc(e.item.name || '')}</div>
            <div class="li-sub">${esc(memberName(s, e.item.owner))} · ${money(e.item.amount, e.item.ccy)}${e.item.broker ? ` · ${esc(e.item.broker)}` : ''}</div></div>
          <div class="li-side">${st}${past ? `<label class="small"><input type="checkbox" data-chk="${e.key}" ${e.confirmed ? 'checked' : ''}> 扣到了</label>` : ''}</div>
        </li>`;
      }).join('')}</ul>
      <p class="small muted">遇到假日，券商通常會順延到下一個營業日。</p>
    </section>` : ''}

    <section class="card">
      <div class="card-head"><h2>扣款標的一覽</h2><span class="small muted">${s.dca.length} 筆</span></div>
      ${list.map(it => dcaRow(s, it)).join('') || '<p class="muted small">還沒有定期定額。</p>'}
      <button type="button" class="btn sm" data-act="add">＋ 新增定期定額</button>
    </section>

    <section class="card">
      <div class="card-head"><h2>大跌分段加碼</h2>${dip.ready ? chip('good', `第 ${dip.ready.tier} 段可執行`) : chip('info', '未觸發')}</div>
      <p class="small muted">大盤從一年高點跌 ${R.dipTiers.join('／')}% 時，各動用一段加碼池，只買大盤 ETF。跌越多買越多，但分三次，不會一次用完。這是定期定額以外，額外單筆買進。</p>
      <div class="form-grid">
        ${numField('加碼池', 'pool', s.plan.pool, { suffix: '台幣', hint: '平常存著、專門等大跌用的錢', attrs: 'data-p="pool"' })}
        ${textField('台股加碼標的', 'twEtf', s.plan.twEtf, { placeholder: '0050', attrs: 'data-p="twEtf"' })}
        ${textField('美股加碼標的', 'usEtf', s.plan.usEtf, { placeholder: 'VOO', attrs: 'data-p="usEtf"' })}
      </div>
      ${dip.markets.map(x => `
        <div class="dd-block">
          <div class="row between"><b>${x.name}</b><span class="small">${x.dd == null ? '沒有資料' : `距高點 −${pct(x.dd)}`}</span></div>
          ${meter(x.dd ?? 0, { max: 0.4, status: x.tier ? 'warn' : 'neutral', ticks: R.dipTiers.map(t => ({ at: t / 100, label: `${t}%` })), label: `${x.name}距一年高點 ${pct(x.dd)}` })}
        </div>`).join('')}
      <div class="table-scroll" style="margin-top:22px"><table class="data">
        <thead><tr><th>段數</th><th>觸發條件</th><th>金額</th><th>狀態</th></tr></thead>
        <tbody>${[1, 2, 3].map(i => {
          const used = s.plan.dipUsed[i];
          const status = used ? `已執行 ${shortDate(used)}` : i <= dip.reached ? '已觸發' : '未觸發';
          return `<tr><td>第 ${i} 段</td><td>跌 ${R.dipTiers[i - 1]}%</td><td>${used ? '—' : twd(dip.perTier)}</td><td>${status}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      ${dip.ready ? `
        <p class="note ok">${esc(dip.ready.market)}距高點 −${pct(dip.ready.dd)}：買 ${dip.ready.lines.map(l => `<b>${esc(l.sym)}</b> ${twd(l.amount)}`).join('、')}。</p>
        <button type="button" class="btn primary" data-act="dip">我已照做第 ${dip.ready.tier} 段（從加碼池扣 ${twd(dip.ready.amount)}）</button>` : ''}
      ${!dip.pool && dip.reached ? '<p class="note">已經觸發，但加碼池是 0。要用這個規則，先在上面填加碼池金額。</p>' : ''}
      ${dip.used.length ? `<p class="small muted" style="margin-top:10px">${dip.canReset ? '大盤已經回到高點附近，可以重新開始，並把加碼池補滿。' : '等大盤回到高點附近（5% 以內），再重新開始。'}</p>
        <button type="button" class="btn ghost sm" data-act="reset">重新開始三段加碼</button>` : ''}
    </section>
  </div>`;

  const view = el.firstElementChild;

  view.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.chk) {
      const c = (s.dcaChecks[ym] ||= {});
      if (t.checked) c[t.dataset.chk] = today;
      else delete c[t.dataset.chk];
      save();
      changed();
      render(el);
      return;
    }
    if (t.dataset.p) {
      const k = t.dataset.p;
      const val = readValue(t);
      s.plan[k] = k === 'pool' ? val : String(val || '').toUpperCase();
      save();
      changed();
      render(el);
      return;
    }
    if (t.dataset.dca) {
      const it = s.dca.find(x => x.id === t.dataset.dca);
      if (!it) return;
      const f = t.dataset.f;
      let val = readValue(t);
      if (f === 'days') {
        val = parseDays(val);
        t.value = val.join(', ');
      }
      if (f === 'sym') val = String(val).toUpperCase();
      if (f === 'cat') it.ccy = CAT_CCY[val];
      it[f] = val;
      touch();
      changed();
      // 類別、日期、帳戶改了會影響排序和月曆，重畫；其他只更新摘要
      if (['cat', 'days', 'owner', 'active', 'amount', 'ccy'].includes(f)) render(el);
      else view.querySelector(`[data-sum="${it.id}"]`).innerHTML = dcaSummary(s, it);
    }
  });

  view.addEventListener('toggle', e => {
    const row = e.target.closest?.('[data-row]');
    if (!row) return;
    if (row.open) open.add(row.dataset.row);
    else open.delete(row.dataset.row);
  }, true);

  view.querySelector('[data-act="add"]').addEventListener('click', () => {
    const id = uid();
    s.dca.push({ id, owner: 'me', cat: 'tw', sym: '', name: '', amount: null, ccy: 'TWD', days: [], broker: '', active: true });
    open.add(id);
    touch();
    render(el);
    el.querySelector(`[data-row="${id}"] input`)?.focus();
  });

  view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const it = s.dca.find(x => x.id === b.dataset.del);
    if (!it) return;
    const ok = await confirmBox(`刪除「${esc(it.sym || '這筆')}」的定期定額？`, { ok: '刪除', danger: true });
    if (!ok) return;
    s.dca = s.dca.filter(x => x.id !== it.id);
    touch();
    changed();
    render(el);
  }));

  view.querySelector('[data-act="dip"]')?.addEventListener('click', async () => {
    const r = dip.ready;
    const ok = await confirmBox(`記錄第 ${r.tier} 段已執行，並從加碼池扣掉 ${twd(r.amount)}？`, { ok: '記錄' });
    if (!ok) return;
    s.plan.dipUsed[r.tier] = today;
    s.plan.pool = Math.max(0, Math.round((s.plan.pool || 0) - r.amount));
    save();
    changed();
    render(el);
  });
  view.querySelector('[data-act="reset"]')?.addEventListener('click', async () => {
    const ok = await confirmBox('清除三段加碼的執行紀錄？記得同時把加碼池補到想要的金額。', { ok: '重新開始' });
    if (!ok) return;
    s.plan.dipUsed = {};
    save();
    changed();
    render(el);
  });
}

