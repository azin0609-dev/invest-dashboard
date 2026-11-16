// 資料儲存：所有個人資料（家人、持倉、規則、日誌）都放在這台裝置瀏覽器的 localStorage，不會上傳
import { todayStr, uid } from './util.js';

const KEY = 'invest-desk-v1';
export const SCHEMA_VERSION = 2;
export const APP_ID = 'invest-dashboard';

/** 四大類資產 */
export const CATS = [
  ['tw', '台股'],
  ['us', '美股'],
  ['bond', '債券'],
  ['crypto', '加密貨幣'],
];
export const CAT_CCY = { tw: 'TWD', us: 'USD', bond: 'TWD', crypto: 'USD' };
/** 各類別的細分：個股／ETF；加密貨幣分現貨、質押 */
export const KINDS = {
  tw: [['etf', 'ETF'], ['stock', '個股']],
  us: [['etf', 'ETF'], ['stock', '個股']],
  bond: [['etf', '債券 ETF'], ['bond', '單一債券']],
  crypto: [['spot', '現貨'], ['staked', '質押']],
};

/** 規則預設值（範例數字，使用者要到「設定」改成自己的） */
export function defaultRules() {
  return {
    targets: { tw: 40, us: 30, bond: 20, crypto: 10 }, // 全家投資資產的目標配置 %
    bandPct: 5, // 實際比例偏離目標超過幾 % 才算要調整
    singleCapPct: 15, // 單一個股／單一幣（不含 ETF）最多占投資資產 %
    platformCapPct: 50, // 加密資產放在同一個交易所／平台最多 %
    pledgeWarnPct: 160, // 台股質押維持率低於這個就提醒
    pledgeCallPct: 130, // 維持率低於這個會被券商追繳（一般是 130%）
    efMonths: 6, // 預備金目標：幾個月生活費
    opensPerDay: 3, // 每天打開 App 的次數上限
    coolHours: 24, // 看到別人推薦才想買：冷靜期（小時）
    dipTiers: [10, 20, 30], // 大盤距一年高點跌幾 % 觸發第 1／2／3 段加碼
    chasePct: 15, // 價格高於 60 日線幾 % 算追高
    confirmed: false, // 使用者是否已確認過規則數字
  };
}

export function defaultState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: todayStr(),
    updatedAt: null, // 最後一次改持倉的日期
    // 家人：每個人的投資帳戶現金分開記；第一個固定是自己
    members: [{ id: 'me', name: '我', cashTwd: 0, cashUsd: 0 }],
    // 全家共用
    accounts: { emergency: 0, monthlyExpense: 0 },
    // 持倉：{ id, owner, cat, sym, name, kind（見 KINDS）, value, cost, ccy:'TWD'|'USD', platform（加密貨幣放在哪）}
    holdings: [],
    // 台股質押借款：{ id, owner, broker, sym, shares, value（擔保品市值，空白用收盤價算）, loan, rate, due }
    pledges: [],
    // 定期定額：{ id, owner, cat, sym, name, amount, ccy, days:[6,16,26], broker, active }
    dca: [],
    dcaChecks: {}, // 已確認扣款：{ 'YYYY-MM': { '項目id@日': 確認日期 } }
    rules: defaultRules(),
    plan: {
      twEtf: '0050', // 大跌加碼買的 ETF
      usEtf: 'VOO',
      pool: 0, // 大跌加碼池（台幣）
      dipUsed: {}, // { 段數: 執行日期 }
      fngManual: null, // 手動輸入的恐懼貪婪指數（自動抓不到時用）
    },
    // 交易日誌：{ id, date, owner, sym, action, amount, source, mood, reason, wrongIf, result }
    journal: [],
    // 想買清單（冷靜期）：{ id, sym, note, source, addedAt(ISO) }
    wishlist: [],
    opens: { date: '', n: 0 },
    peeks: {},
    settings: { fx: null, lastExport: null },
  };
}

let state = null;
let storageOk = true;

function isObj(x) {
  return x && typeof x === 'object' && !Array.isArray(x);
}
const arr = x => (Array.isArray(x) ? x : []);

/** 把讀進來的資料補齊缺少的欄位（也用在匯入） */
export function normalize(data) {
  const d = defaultState();
  if (!isObj(data)) return d;
  const s = migrate({ ...data });
  const out = {
    ...d,
    ...s,
    members: arr(s.members).length ? s.members : d.members,
    accounts: { ...d.accounts, ...(isObj(s.accounts) ? s.accounts : {}) },
    holdings: arr(s.holdings),
    pledges: arr(s.pledges),
    dca: arr(s.dca),
    dcaChecks: isObj(s.dcaChecks) ? s.dcaChecks : {},
    rules: { ...d.rules, ...(isObj(s.rules) ? s.rules : {}) },
    plan: { ...d.plan, ...(isObj(s.plan) ? s.plan : {}) },
    journal: arr(s.journal),
    wishlist: arr(s.wishlist),
    opens: { ...d.opens, ...(isObj(s.opens) ? s.opens : {}) },
    peeks: isObj(s.peeks) ? s.peeks : {},
    settings: { ...d.settings, ...(isObj(s.settings) ? s.settings : {}) },
  };
  out.rules.targets = { ...d.rules.targets, ...(isObj(out.rules.targets) ? out.rules.targets : {}) };
  if (!arr(out.rules.dipTiers).length || out.rules.dipTiers.length !== 3) out.rules.dipTiers = d.rules.dipTiers;
  if (!isObj(out.plan.dipUsed)) out.plan.dipUsed = {};
  if (!out.members.some(m => m.id === 'me')) out.members.unshift({ ...d.members[0] });
  out.schemaVersion = SCHEMA_VERSION;
  return out;
}

// 資料格式改版：把舊版轉成新版
function migrate(s) {
  if ((s.schemaVersion || 1) < 2) {
    // 第一版：台股／美股分核心、衛星，有合約；第二版改成四大類＋家人，不再記合約
    const a = isObj(s.accounts) ? s.accounts : {};
    s.members = [{ id: 'me', name: '我', cashTwd: Number(a.cashTwd) || 0, cashUsd: Number(a.cashUsd) || 0 }];
    s.accounts = { emergency: a.emergency || 0, monthlyExpense: a.monthlyExpense || 0 };
    s.holdings = arr(s.holdings).map(h => ({
      id: h.id || uid(),
      owner: 'me',
      cat: h.mkt === 'us' ? 'us' : 'tw',
      sym: h.sym || '',
      name: h.name || '',
      kind: h.bucket === 'core' ? 'etf' : 'stock',
      value: h.value ?? null,
      cost: h.cost ?? null,
      ccy: h.mkt === 'us' ? 'USD' : 'TWD',
      platform: '',
    }));
    delete s.contracts;
    if (isObj(s.rules)) {
      const keep = ['efMonths', 'opensPerDay', 'coolHours', 'dipTiers', 'chasePct'];
      s.rules = Object.fromEntries(Object.entries(s.rules).filter(([k]) => keep.includes(k)));
    }
    if (isObj(s.plan)) {
      const { twEtf, usEtf, pool, dipUsed, fngManual } = s.plan;
      s.plan = { twEtf, usEtf, pool, dipUsed, fngManual };
    }
  }
  return s;
}

export function load() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    storageOk = false;
  }
  let data = null;
  if (raw) {
    try { data = JSON.parse(raw); } catch { data = null; }
  }
  state = normalize(data);
  return state;
}

export function getState() {
  if (!state) load();
  return state;
}

/** 測試用：直接換掉目前資料（不存檔） */
export function setStateForTest(s) {
  state = s;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch (e) {
    storageOk = false;
    console.error('儲存失敗', e);
  }
}

/** 改了持倉數字：記下更新日期再存檔 */
export function touch() {
  getState().updatedAt = todayStr();
  save();
}

export function isStorageOk() {
  return storageOk;
}

/** 每次打開 App 算一次 */
export function countOpen(today = todayStr()) {
  const s = getState();
  if (s.opens.date !== today) s.opens = { date: today, n: 0 };
  s.opens.n++;
  save();
  return s.opens.n;
}

export function hasHoldings(s = getState()) {
  return s.holdings.length + s.pledges.length + s.dca.length > 0;
}

export function memberName(s, id) {
  return (s.members.find(m => m.id === id) || { name: '—' }).name;
}

// ===== 匯出／匯入 =====

export function exportData(s = getState()) {
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), data: s };
}

/** 檢查匯入檔案是不是這個 App 的備份 */
export function validateImport(obj) {
  if (!isObj(obj)) return { ok: false, error: '檔案內容不是有效的 JSON 物件。' };
  if (obj.app !== APP_ID || !isObj(obj.data)) return { ok: false, error: '這不是「投資儀表板」的備份檔。' };
  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: '這個備份來自較新版本的 App，請先更新 App。' };
  }
  const d = obj.data;
  for (const k of ['members', 'holdings', 'pledges', 'dca', 'journal', 'wishlist']) {
    if (d[k] !== undefined && !Array.isArray(d[k])) return { ok: false, error: `備份裡的 ${k} 格式錯誤。` };
  }
  return { ok: true, data: d };
}

export function importData(obj) {
  const v = validateImport(obj);
  if (!v.ok) throw new Error(v.error);
  state = normalize(v.data);
  save();
  return state;
}

export function clearAll() {
  try { localStorage.removeItem(KEY); } catch { /* 忽略 */ }
  state = defaultState();
  save();
}
