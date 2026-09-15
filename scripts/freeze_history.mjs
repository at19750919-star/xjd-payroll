// 把「除了最新 LIVE_WINDOW 週以外」的試算表週分頁凍結成 history.json。
// 資料形狀跟 index.html 的 loadWeekData() 完全一樣,getWeekData() 可以直接吃。
// 全量覆寫、可重跑;不寫回試算表、不動分頁結構。
//
// 用法:node scripts/freeze_history.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

function extractConst(name) {
  const m = html.match(new RegExp(`const ${name} = "([^"]+)"`));
  if (!m) throw new Error(`index.html 裡找不到 const ${name}(格式可能改了,請對照 index.html)`);
  return m[1];
}

const API_URL = extractConst("API_URL");
const API_SECRET = extractConst("API_SECRET");
const SHEET_ID = extractConst("SHEET_ID");
const LIVE_WINDOW = Number(html.match(/const LIVE_WINDOW = (\d+)/)?.[1]);
if (!Number.isFinite(LIVE_WINDOW)) throw new Error("index.html 裡找不到 const LIVE_WINDOW(格式可能改了)");

async function parseApiResponse(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`伺服器回應不是預期格式,請重試。原始回應開頭:${text.slice(0, 80)}`);
  }
}
async function withRetry(fn) {
  try { return await fn(); } catch { return await fn(); }
}
async function apiGet(op, params) {
  return withRetry(async () => {
    const u = new URL(API_URL);
    u.searchParams.set("op", op);
    u.searchParams.set("secret", API_SECRET);
    Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u.toString());
    const j = await parseApiResponse(res);
    if (j.error) throw new Error(j.error);
    return j;
  });
}

async function listTabs() {
  const j = await apiGet("tabs");
  // 跟 index.html 的 listTabs() 一樣:API 回傳新到舊,這裡排成舊到新。
  return (j.tabs || []).slice().sort((a, b) => String(a).localeCompare(String(b)));
}

// xlsx 函式庫不裝進 node_modules,直接抓跟前端相同版本的 CDN 檔到暫存後 require 進來
async function loadXlsxLib() {
  const url = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下載 xlsx 函式庫失敗(${res.status})`);
  const code = await res.text();
  const tmpFile = path.join(os.tmpdir(), "xjd-payroll-xlsx.full.min.js");
  fs.writeFileSync(tmpFile, code, "utf8");
  return require(tmpFile);
}

async function loadWorkbook(XLSX) {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`);
  if (!res.ok) throw new Error(`試算表匯出失敗(${res.status})`);
  const buffer = await res.arrayBuffer();
  return XLSX.read(buffer, { type: "array", cellDates: true });
}

async function loadSheetGids() {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/htmlview`);
  if (!res.ok) throw new Error(`htmlview 讀取失敗(${res.status})`);
  const html = await res.text();
  const gids = {};
  const re = /items\.push\(\{name: "([^"]+)",[\s\S]*?gid: "(\d+)"/g;
  let match;
  while ((match = re.exec(html))) {
    if (/^\d{4}$/.test(match[1]) && match[2] && match[2] !== "0") gids[match[1]] = match[2];
  }
  if (!Object.keys(gids).length) throw new Error("htmlview 裡找不到週分頁 gid");
  return gids;
}

// ---------- 以下逐一對照 index.html 裡同名函式,邏輯必須一致 ----------
function dailyNameKey(name) {
  return String(name || "").replace(/\s+/g, "").toLowerCase();
}
function isRealPerson(name) {
  const n = String(name || "").trim();
  return !!n && !/^(https?:\/\/|www\.)/i.test(n);
}
function sumDailyHours(values) {
  return (values || []).slice(0, 7).reduce((sum, v) => {
    const n = Number(v);
    return sum + (v == null || v === "" || !Number.isFinite(n) ? 0 : n);
  }, 0);
}
function cellCommentText(cell) {
  const text = ((cell && cell.c) || []).map((comment) => comment.t || "").join("\n").trim();
  if (!text) return "";
  const times = text.match(/\d{1,2}:\d{2}/g);
  return times && times.length >= 2 ? `${times[0]} ～ ${times[1]}` : text;
}
function loadDailyHours(XLSX, workbook, tab) {
  const sheet = workbook.Sheets[tab];
  if (!sheet) throw new Error(`試算表找不到分頁 ${tab}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: "M1:V60", raw: true, defval: null });
  const details = {};
  let inPeopleBlock = false;
  rows.forEach((row, rowIndex) => {
    const label = row[0] == null ? "" : String(row[0]).trim();
    if (label.includes("荷官工作時數統計")) { inPeopleBlock = true; return; }
    if (label === "全部總時數") { inPeopleBlock = false; return; }
    if (!inPeopleBlock || !label || label === "時數/HR") return;
    const values = [];
    const notes = [];
    for (let i = 0; i < 7; i += 1) {
      const raw = row[i + 1];
      const value = Number(raw);
      values.push(raw == null || raw === "" || !Number.isFinite(value) ? null : value);
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: 13 + i });
      notes.push(cellCommentText(sheet[address]));
    }
    details[dailyNameKey(label)] = { values, notes };
  });
  return details;
}
function sheetDate(XLSX, value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  }
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
  }
  return null;
}
function dateKey(date) {
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, "0"), String(date.getUTCDate()).padStart(2, "0")].join("-");
}
function loadDailyOperations(XLSX, workbook, tab) {
  const sheet = workbook.Sheets[tab];
  if (!sheet) throw new Error(`試算表找不到分頁 ${tab}`);
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  const grouped = {};
  const dates = [];
  rows.slice(1).forEach((row) => {
    const date = sheetDate(XLSX, row[0]);
    if (!date) return;
    const key = dateKey(date);
    if (!grouped[key]) { grouped[key] = { 勝負原值: 0, 洗碼量: 0, 筆數: 0 }; dates.push(date); }
    const win = Number(row[6]);
    const wash = Number(row[7]);
    if (Number.isFinite(win)) grouped[key].勝負原值 += win;
    if (Number.isFinite(wash)) grouped[key].洗碼量 += wash;
    grouped[key].筆數 += 1;
  });
  let monday;
  if (dates.length) {
    const earliest = new Date(Math.min(...dates.map((date) => date.getTime())));
    const offset = (earliest.getUTCDay() + 6) % 7;
    monday = new Date(earliest);
    monday.setUTCDate(monday.getUTCDate() - offset);
  } else {
    const match = String(tab).match(/^(\d{2})(\d{2})$/);
    monday = match
      ? new Date(Date.UTC(new Date().getFullYear(), Number(match[1]) - 1, Number(match[2])))
      : new Date();
  }
  const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
  return weekdays.map((day, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    const rec = grouped[dateKey(date)] || { 勝負原值: 0, 洗碼量: 0, 筆數: 0 };
    return { day, date: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`, ...rec };
  });
}

async function loadWeekData(XLSX, workbook, tab) {
  const [week, dailyHours, dailyOperations] = await Promise.all([
    apiGet("week", { tab }),
    Promise.resolve(loadDailyHours(XLSX, workbook, tab)),
    Promise.resolve(loadDailyOperations(XLSX, workbook, tab)),
  ]);
  week.正式 = (week.正式 || []).filter((p) => isRealPerson(p.名字));
  week.實習 = (week.實習 || []).filter((p) => isRealPerson(p.名字));
  week.正式.concat(week.實習).forEach((person) => {
    const daily = dailyHours[dailyNameKey(person.名字)] || {};
    person.每日時數 = daily.values || Array(7).fill(null);
    person.每日備註 = daily.notes || Array(7).fill("");
    person.時數 = sumDailyHours(person.每日時數);
  });
  week.每日營運 = dailyOperations;
  return week;
}

async function main() {
  const TABS = await listTabs();
  if (!TABS.length) throw new Error("試算表沒有可用的週分頁");

  const liveCount = Math.min(LIVE_WINDOW, TABS.length);
  const liveTabs = TABS.slice(TABS.length - liveCount);
  const frozenTabs = TABS.slice(0, TABS.length - liveCount);

  const XLSX = await loadXlsxLib();
  const workbook = await loadWorkbook(XLSX);

  const weeks = {};
  for (const tab of frozenTabs) {
    console.log(`凍結 ${tab} …`);
    weeks[tab] = await loadWeekData(XLSX, workbook, tab);
  }

  const history = {
    version: 1,
    generatedAt: new Date().toISOString(),
    liveWindow: LIVE_WINDOW,
    weeks,
  };
  fs.writeFileSync(path.join(ROOT, "history.json"), JSON.stringify(history, null, 2) + "\n", "utf8");

  const gids = await loadSheetGids();
  fs.writeFileSync(path.join(ROOT, "sheet_gids.json"), JSON.stringify(gids, null, 2) + "\n", "utf8");

  console.log(`凍結完成(${frozenTabs.length} 週):${frozenTabs.join(", ") || "(無)"}`);
  console.log(`保留活讀(${liveTabs.length} 週):${liveTabs.join(", ")}`);
  console.log(`gid 對照(${Object.keys(gids).length}):${Object.keys(gids).join(", ")}`);
}

main().catch((err) => {
  console.error("凍結失敗:", err.message);
  process.exit(1);
});
