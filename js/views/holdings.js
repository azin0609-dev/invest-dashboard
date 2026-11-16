// 持倉：每位家人的現金、台股、美股、債券、加密貨幣（現貨／質押）、台股質押借款；全家共用的預備金
import { getState, touch, CATS, CAT_CCY, KINDS } from '../store.js';
import { getMarket } from '../market.js';
import { portfolio, pledgeView } from '../calc.js';
import { esc, uid, twd, usd, pct } from '../util.js';
import { numField, textField, selectField, readValue, pageHead, confirmBox, modal, toast, changed, chip } from '../ui.js';

let current = 'me'; // 正在看哪位家人
const open = new Set();

const DEFAULT_KIND = { tw: 'stock', us: 'stock', bond: 'etf', crypto: 'spot' };
const PH = {
  tw: '例如 0050、2330',
  us: '例如 VOO、AAPL',
  bond: '例如 00679B、BND',
  crypto: '例如 BTC、ETH',
};

function kindLabel(h) {
  return (KINDS[h.cat].find(k => k[0] === h.kind) || ['', ''])[1];
}

function holdingSummary(h) {
  const money = h.ccy === 'USD' ? usd(h.value) : twd(h.value);
  return `${esc(h.sym || '新標的')}${h.name ? ` ${esc(h.name)}` : ''} · ${esc(kindLabel(h))}${h.cat === 'crypto' && h.platform ? ` · ${esc(h.platform)}` : ''} · ${money}`;
}

function pledgeSummary(x, m, R) {
  const v = pledgeView(x, m, R);
  const st = v.status === 'bad' ? '🚨 ' : v.status === 'warn' ? '⚠ ' : '';
  return `${st}${esc(x.sym || '擔保品')}${x.broker ? ` · ${esc(x.broker)}` : ''} · 借 ${twd(v.loan)} · 維持率 ${v.ratio == null ? '—' : pct(v.ratio, 0)}`;
}

function holdingRow(h) {
  const b = f => `data-list="holdings" data-id="${h.id}" data-f="${f}"`;
  const ccyName = h.ccy === 'USD' ? '美元' : '台幣';
  return `
    <details class="row-card" data-row="${h.id}" ${open.has(h.id) ? 'open' : ''}>
      <summary><span data-sum="${h.id}">${holdingSummary(h)}</span></summary>
      <div class="form-grid">
        ${textField('代號', 'sym', h.sym, { placeholder: PH[h.cat], attrs: b('sym') })}
        ${textField('名稱', 'name', h.name, { placeholder: '自己看得懂就好', attrs: b('name') })}
        ${selectField('類型', 'kind', h.kind, KINDS[h.cat], { attrs: b('kind') })}
        ${h.cat === 'bond' ? selectField('幣別', 'ccy', h.ccy, [['TWD', '台幣'], ['USD', '美元']], { attrs: b('ccy') }) : ''}
        ${h.cat === 'crypto' ? textField('放在哪', 'platform', h.platform, { placeholder: '交易所名稱，或「冷錢包」', attrs: b('platform') }) : ''}
        ${numField('目前市值', 'value', h.value, { suffix: ccyName, attrs: b('value') })}
        ${numField('總成本', 'cost', h.cost, { suffix: ccyName, hint: '算損益用，可以不填', attrs: b('cost') })}
      </div>
      <button type="button" class="btn danger sm" data-del="holdings" data-id="${h.id}">刪除這筆</button>
    </details>`;
}

function pledgeRow(x, m, R) {
  const b = f => `data-list="pledges" data-id="${x.id}" data-f="${f}"`;
  const v = pledgeView(x, m, R);
  return `
    <details class="row-card" data-row="${x.id}" ${open.has(x.id) ? 'open' : ''}>
      <summary><span data-sum="${x.id}">${pledgeSummary(x, m, R)}</span></summary>
      <div class="form-grid">
        ${textField('券商', 'broker', x.broker, { placeholder: '哪一家券商', attrs: b('broker') })}
        ${textField('擔保股票代號', 'sym', x.sym, { placeholder: '例如 2330', attrs: b('sym') })}
        ${numField('質押股數', 'shares', x.shares, { suffix: '股', attrs: b('shares') })}
        ${numField('擔保品市值', 'value', x.value, { suffix: '台幣', hint: v.valueSrc && v.valueSrc !== '手動' ? `空白時用${esc(v.valueSrc)}算：${twd(v.value)}` : '空白時用股數 × 收盤價', attrs: b('value') })}
        ${numField('借款金額', 'loan', x.loan, { suffix: '台幣', attrs: b('loan') })}
        ${numField('年利率', 'rate', x.rate, { suffix: '%', attrs: b('rate') })}
        <label class="field"><span>到期日</span><input type="date" value="${esc(x.due || '')}" ${b('due')}></label>
      </div>
      ${v.ratio != null ? `<p class="small" style="padding:0 12px">維持率 <b>${pct(v.ratio, 0)}</b> · 再跌 <b>${pct(v.dropToCall)}</b> 會被追繳 · 每月利息約 ${twd(v.interestMonth)}</p>` : ''}
      <button type="button" class="btn danger sm" data-del="pledges" data-id="${x.id}">刪除這筆</button>
    </details>`;
}

export function render(el) {
  const s = getState();
  const m = getMarket();
  const R = s.rules;
  if (!s.members.some(x => x.id === current)) current = 'me';
  const mem = s.members.find(x => x.id === current);
  const mine = s.holdings.filter(h => h.owner === current);
  const pledges = s.pledges.filter(x => x.owner === current);
  const pm = portfolio(s, m, current);
  const a = s.accounts;

  el.innerHTML = `<div class="view">
    ${pageHead('持倉', '從券商、交易所 App 抄最新數字。只存在這台裝置，不會上傳。')}

    <div class="member-pick" role="group" aria-label="選擇家人">
      ${s.members.map(x => `<button type="button" data-mem="${x.id}" class="${x.id === current ? 'on' : ''}">${esc(x.name)}<small>${twd(portfolio(s, m, x.id).total)}</small></button>`).join('')}
      <button type="button" data-act="add-member" class="add">＋ 新增家人</button>
    </div>

    <section class="card">
      <div class="card-head"><h2>${esc(mem.name)}的帳戶現金</h2><span class="small muted">投資資產 ${twd(pm.total)}</span></div>
      <div class="form-grid">
        ${numField('台幣現金', 'cashTwd', mem.cashTwd, { suffix: '台幣', hint: '券商交割帳戶裡準備投資、扣款的錢', attrs: 'data-cash="cashTwd"' })}
        ${numField('美元現金', 'cashUsd', mem.cashUsd, { suffix: '美元', attrs: 'data-cash="cashUsd"' })}
      </div>
    </section>

    ${CATS.map(([cat, label]) => {
      const rows = mine.filter(h => h.cat === cat);
      const extra = cat === 'crypto' && rows.length
        ? `<p class="small muted">現貨 ${twd(pm.cryptoSpot)} · 質押 ${twd(pm.cryptoStaked)}</p>` : '';
      return `
      <section class="card">
        <div class="card-head"><h2>${label}</h2><span class="small muted">${rows.length} 筆 · ${twd(pm.byCat[cat])}</span></div>
        ${extra}
        ${rows.map(holdingRow).join('') || `<p class="muted small">還沒有${label}。</p>`}
        <button type="button" class="btn sm" data-add="${cat}">＋ 新增${label}</button>
      </section>`;
    }).join('')}

    <section class="card">
      <div class="card-head"><h2>台股質押借款</h2>${pledges.length ? (pm.pledges.some(x => x.status === 'bad') ? chip('bad', '有部位低於追繳線') : pm.pledges.some(x => x.status === 'warn') ? chip('warn', '有部位維持率偏低') : chip('good', '維持率安全')) : ''}</div>
      <p class="small muted">股票拿去質押借錢，股票本身還是要記在上面的「台股」裡；這裡只記借款。維持率＝擔保品市值 ÷ 借款，低於 ${R.pledgeCallPct}% 券商會追繳。</p>
      ${pledges.length ? `<ul class="mini-list"><li><span>借款合計</span><b>${twd(pm.loans)}</b></li><li><span>每月利息約</span><b>${twd(pm.interestMonth)}</b></li><li><span>扣掉借款的淨資產</span><b>${twd(pm.net)}</b></li></ul>` : ''}
      ${pledges.map(x => pledgeRow(x, m, R)).join('') || '<p class="muted small">沒有質押借款。</p>'}
      <button type="button" class="btn sm" data-add="pledge">＋ 新增質押</button>
    </section>

    <section class="card">
      <h2>全家共用</h2>
      <div class="form-grid">
        ${numField('預備金', 'emergency', a.emergency, { suffix: '台幣', hint: '緊急時才動用的錢，不算投資', attrs: 'data-acct="emergency"' })}
        ${numField('全家每月生活費', 'monthlyExpense', a.monthlyExpense, { suffix: '台幣', attrs: 'data-acct="monthlyExpense"' })}
      </div>
    </section>

    ${current !== 'me' ? `
    <section class="card">
      <h2>家人設定</h2>
      <div class="form-grid">${textField('名稱', 'mname', mem.name, { attrs: 'data-mname' })}</div>
      <button type="button" class="btn danger sm" data-act="del-member">刪除${esc(mem.name)}和他的所有資料</button>
    </section>` : ''}
  </div>`;

  // 事件掛在這次畫出來的外框上，重畫時跟著舊畫面一起消失，不會重複
  const view = el.firstElementChild;

  // 改數字：直接存，只更新摘要列（不重畫整頁，才不會打斷輸入）
  view.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.cash) mem[t.dataset.cash] = readValue(t);
    else if (t.dataset.acct) a[t.dataset.acct] = readValue(t);
    else if ('mname' in t.dataset) {
      mem.name = readValue(t) || mem.name;
      touch();
      changed();
      render(el);
      return;
    } else if (t.dataset.list) {
      const item = s[t.dataset.list].find(x => x.id === t.dataset.id);
      if (!item) return;
      let val = readValue(t);
      if (t.dataset.f === 'sym' && typeof val === 'string') val = val.toUpperCase();
      if (t.dataset.f === 'due' && !val) val = null;
      item[t.dataset.f] = val;
      const sum = view.querySelector(`[data-sum="${item.id}"]`);
      if (sum) sum.innerHTML = t.dataset.list === 'pledges' ? pledgeSummary(item, m, R) : holdingSummary(item);
    } else {
      return;
    }
    touch();
    changed();
  });

  view.addEventListener('toggle', e => {
    const row = e.target.closest?.('[data-row]');
    if (!row) return;
    if (row.open) open.add(row.dataset.row);
    else open.delete(row.dataset.row);
  }, true);

  view.querySelectorAll('[data-mem]').forEach(b => b.addEventListener('click', () => {
    current = b.dataset.mem;
    render(el);
  }));

  view.querySelector('[data-act="add-member"]').addEventListener('click', async () => {
    let name = '';
    const pr = modal({
      title: '新增家人',
      body: textField('名稱', 'name', '', { placeholder: '例如：老婆、大兒子' }),
      actions: [{ label: '取消', value: false, kind: 'ghost' }, { label: '新增', value: true, kind: 'primary' }],
      dismissValue: false,
    });
    const inp = document.querySelector('.modal-overlay input[name="name"]');
    inp.addEventListener('input', () => { name = inp.value.trim(); });
    inp.focus();
    if (!(await pr) || !name) return;
    const id = uid();
    s.members.push({ id, name, cashTwd: 0, cashUsd: 0 });
    current = id;
    touch();
    changed();
    render(el);
  });

  view.querySelector('[data-act="del-member"]')?.addEventListener('click', async () => {
    const n = s.holdings.filter(h => h.owner === current).length + s.pledges.filter(x => x.owner === current).length + s.dca.filter(x => x.owner === current).length;
    const ok = await confirmBox(`刪除「${esc(mem.name)}」，連同他的 ${n} 筆持倉、質押和定期定額？`, { ok: '刪除', danger: true });
    if (!ok) return;
    const gone = current;
    s.members = s.members.filter(x => x.id !== gone);
    s.holdings = s.holdings.filter(x => x.owner !== gone);
    s.pledges = s.pledges.filter(x => x.owner !== gone);
    s.dca = s.dca.filter(x => x.owner !== gone);
    current = 'me';
    touch();
    changed();
    toast('已刪除');
    render(el);
  });

  view.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
    const id = uid();
    const kind = btn.dataset.add;
    if (kind === 'pledge') {
      s.pledges.push({ id, owner: current, broker: '', sym: '', shares: null, value: null, loan: null, rate: null, due: null });
    } else {
      s.holdings.push({ id, owner: current, cat: kind, sym: '', name: '', kind: DEFAULT_KIND[kind], value: null, cost: null, ccy: CAT_CCY[kind], platform: '' });
    }
    open.add(id);
    touch();
    render(el);
    el.querySelector(`[data-row="${id}"] input`)?.focus();
  }));

  view.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
    const list = s[btn.dataset.del];
    const item = list.find(x => x.id === btn.dataset.id);
    if (!item) return;
    const ok = await confirmBox(`確定刪除「${esc(item.sym || '這筆')}」？`, { ok: '刪除', danger: true });
    if (!ok) return;
    list.splice(list.indexOf(item), 1);
    open.delete(item.id);
    touch();
    changed();
    toast('已刪除');
    render(el);
  }));
}

