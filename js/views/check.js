// 下單前：買進前逐項檢查，全部通過才寫日誌；看別人推薦才想買的，先進想買清單冷靜
import { getState, save, CATS, CAT_CCY, KINDS } from '../store.js';
import { getMarket, findSeries, closes, sma } from '../market.js';
import { portfolio, baseSym } from '../calc.js';
import { checkBuy, coolStatus } from '../rules.js';
import { SOURCES, EMO_SOURCES, label } from '../journal.js';
import { esc, uid, nowMs } from '../util.js';
import { pageHead, chip, checkList, numField, textField, selectField, readValue, toast, changed } from '../ui.js';
import { lineChart, bindCharts } from '../chart.js';
import { prefillJournal } from './journal.js';

const FUNDING = [['cash', '自己的現金'], ['margin', '融資'], ['pledge', '質押借來的錢'], ['contract', '合約／槓桿']];
const DEFAULT_KIND = { tw: 'stock', us: 'stock', bond: 'etf', crypto: 'spot' };

let f = null; // 表單
const wf = { sym: '', note: '', source: 'kol' }; // 想買清單表單

function priceChart(m, sym) {
  const ser = findSeries(m, sym);
  if (!ser) return '';
  const c = closes(ser);
  const m60 = sma(c, 60);
  const m200 = sma(c, 200);
  const from = Math.max(0, ser.d.length - 250);
  const rows = ser.d.slice(from).map((r, i) => ({ date: r[0], price: r[1], ma60: m60[from + i], ma200: m200[from + i] }));
  return `<div style="margin-top:14px"><h3>${esc(ser.name || ser.key)} 最近一年</h3>${lineChart(rows, [
    { key: 'price', label: '收盤', color: 'var(--s1)' },
    { key: 'ma60', label: '60 日線', color: 'var(--s2)' },
    { key: 'ma200', label: '200 日線', color: 'var(--s3)' },
  ], { height: 200, title: `${ser.key} 收盤與均線` })}</div>`;
}

function wishCard(s, now) {
  const R = s.rules;
  const rows = s.wishlist.map(w => {
    const c = coolStatus(s, w.sym, now);
    return `<li class="list-item">
      <div class="li-main"><div class="li-title">${esc(w.sym)} ${c.ready ? chip('good', '冷靜期已過') : chip('warn', `還要 ${Math.ceil(c.hoursLeft)} 小時`)}</div>
        <div class="li-sub">${esc(label(SOURCES, w.source))}${w.note ? ` · ${esc(w.note)}` : ''}</div></div>
      <div class="li-side"><button type="button" class="btn ghost sm" data-wdel="${w.id}">刪除</button></div>
    </li>`;
  }).join('');
  return `
    <section class="card">
      <div class="card-head"><h2>想買清單</h2><span class="small muted">冷靜期 ${R.coolHours} 小時</span></div>
      <p class="small muted">看到 KOL、新聞或朋友推薦才想買的，先放這裡。${R.coolHours} 小時後還想買，再來跑檢查。很多「一定要現在買」的念頭，隔天就不見了。</p>
      ${rows ? `<ul class="list">${rows}</ul>` : ''}
      <div class="form-grid" data-wform>
        ${textField('代號', 'sym', wf.sym, { placeholder: '例如 2330、BTC', attrs: 'data-w="sym"' })}
        ${selectField('從哪裡看到', 'source', wf.source, SOURCES.filter(x => EMO_SOURCES.includes(x[0])), { attrs: 'data-w="source"' })}
        ${textField('為什麼想買', 'note', wf.note, { placeholder: '一句話就好', attrs: 'data-w="note"' })}
      </div>
      <button type="button" class="btn sm" data-act="wadd">＋ 放進想買清單</button>
    </section>`;
}

export function render(el) {
  const s = getState();
  const m = getMarket();
  if (!f || !s.members.some(x => x.id === f.owner)) f = { owner: 'me', cat: 'tw', sym: '', kind: 'stock', amount: null, ccy: 'TWD', funding: 'cash', source: 'self' };
  const now = nowMs();

  el.innerHTML = `<div class="view">
    ${pageHead('買進前檢查', '每一筆都先在這裡跑一次。沒看到「可以買」，就不買。')}
    <section class="card">
      <div class="form-grid" data-form>
        ${selectField('誰的帳戶', 'owner', f.owner, s.members.map(x => [x.id, x.name]), { attrs: 'data-k="owner"' })}
        ${selectField('類別', 'cat', f.cat, CATS, { attrs: 'data-k="cat"' })}
        ${textField('代號', 'sym', f.sym, { placeholder: '例如 2330、VOO、BTC', attrs: 'data-k="sym"' })}
        ${selectField('類型', 'kind', f.kind, KINDS[f.cat], { attrs: 'data-k="kind"' })}
        ${numField('打算買多少', 'amount', f.amount, { attrs: 'data-k="amount"' })}
        ${selectField('幣別', 'ccy', f.ccy, [['TWD', '台幣'], ['USD', '美元']], { attrs: 'data-k="ccy"' })}
        ${selectField('錢從哪裡來', 'funding', f.funding, FUNDING, { attrs: 'data-k="funding"' })}
        ${selectField('這個想法從哪來', 'source', f.source, SOURCES, { attrs: 'data-k="source"' })}
      </div>
    </section>
    <section class="card" data-out></section>
    ${wishCard(s, now)}
  </div>`;

  const v = el.firstElementChild;
  const out = v.querySelector('[data-out]');

  const update = () => {
    const p = portfolio(s, m);
    const r = checkBuy(f, p, s, m, nowMs());
    const coolFail = r.checks.some(c => c.group === '冷靜期' && !c.ok) && !coolStatus(s, f.sym, nowMs());
    out.innerHTML = `
      <div class="card-head"><h2>規則判定</h2>${r.ok ? chip('good', '可以買') : chip('bad', `先不要買 · ${r.fails} 項沒通過`)}</div>
      ${checkList(r.checks)}
      <div class="actions">
        ${coolFail && f.sym ? `<button type="button" class="btn" data-act="towish">放進想買清單（${esc(baseSym(f.sym))}）</button>` : ''}
        <button type="button" class="btn primary" data-act="journal" ${r.ok ? '' : 'disabled'}>通過，寫進交易日誌</button>
      </div>
      ${f.kind !== 'etf' && f.cat !== 'bond' ? priceChart(m, f.sym) : ''}`;
    bindCharts(out);
    out.querySelector('[data-act="journal"]').addEventListener('click', () => {
      prefillJournal({ owner: f.owner, sym: baseSym(f.sym), action: 'buy', amount: Math.round(r.amount), source: f.source });
      location.hash = '#/journal';
    });
    out.querySelector('[data-act="towish"]')?.addEventListener('click', () => {
      s.wishlist.push({ id: uid(), sym: baseSym(f.sym), note: '', source: EMO_SOURCES.includes(f.source) ? f.source : 'kol', addedAt: new Date(nowMs()).toISOString() });
      save();
      changed();
      toast(`已放進想買清單，${s.rules.coolHours} 小時後再來`);
      render(el);
    });
  };

  // 打字只更新結果，不重畫表單（才不會打斷輸入）；換類別要換「類型」和「幣別」選項，才重畫
  const form = v.querySelector('[data-form]');
  form.addEventListener('input', e => {
    const k = e.target.dataset.k;
    if (!k) return;
    const val = readValue(e.target);
    f[k] = k === 'sym' ? String(val).toUpperCase() : val;
    if (k === 'cat') {
      f.kind = DEFAULT_KIND[val];
      f.ccy = CAT_CCY[val];
      render(el);
      return;
    }
    update();
  });

  v.querySelector('[data-wform]').addEventListener('input', e => {
    const k = e.target.dataset.w;
    if (k) wf[k] = readValue(e.target);
  });
  v.querySelector('[data-act="wadd"]').addEventListener('click', () => {
    const sym = baseSym(wf.sym);
    if (!sym) { toast('先填代號'); return; }
    if (s.wishlist.some(w => baseSym(w.sym) === sym)) { toast('清單裡已經有了'); return; }
    s.wishlist.push({ id: uid(), sym, note: wf.note, source: wf.source, addedAt: new Date(nowMs()).toISOString() });
    wf.sym = '';
    wf.note = '';
    save();
    changed();
    render(el);
  });
  v.querySelectorAll('[data-wdel]').forEach(b => b.addEventListener('click', () => {
    s.wishlist = s.wishlist.filter(w => w.id !== b.dataset.wdel);
    save();
    changed();
    render(el);
  }));

  update();
}
