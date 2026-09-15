#!/usr/bin/env node
/**
 * 薪資頁上線前檢查。失敗就不要 push / 不要跟使用者說修好。
 * 用法：node scripts/check_page.js
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

// 主程式是最後一個含 getWeekData 的 <script> IIFE（前面還有 fit 腳本）
const marker = "async function getWeekData";
const markerAt = html.indexOf(marker);
if (markerAt < 0) fail("找不到 getWeekData（主程式未載入？）");
const start = html.lastIndexOf("(() => {", markerAt);
if (start < 0) fail("找不到主程式 IIFE (() => {");
const end = html.indexOf("</script>", markerAt);
if (end < 0) fail("找不到 </script>");
const code = html.slice(start, end);
const tmp = path.join(root, "._payroll_syntax_check.js");
fs.writeFileSync(tmp, code, "utf8");
try {
  execFileSync(process.execPath, ["--check", tmp], { stdio: ["ignore", "pipe", "pipe"] });
} catch (err) {
  const stderr = (err.stderr && err.stderr.toString()) || err.message;
  fail("index.html 內嵌腳本語法錯誤\n" + stderr);
} finally {
  try { fs.unlinkSync(tmp); } catch {}
}

// 抓「同一行重複函式宣告」這種 patch 事故
const dup = code.match(/function\s+(\w+)\s*\([^)]*\)\s*\{\s*function\s+\1\s*\(/);
if (dup) fail(`偵測到重複函式宣告: ${dup[1]}（上次 push 壞頁就是這類）`);

const names = [...code.matchAll(/^\s*(?:async\s+)?function\s+(\w+)\s*\(/gm)].map((m) => m[1]);
const seen = new Map();
for (const n of names) seen.set(n, (seen.get(n) || 0) + 1);
const multi = [...seen.entries()].filter(([, c]) => c > 1);
// renderLoanLedgerPrint 等合法可重名以外：同名 function 宣告超過 1 次就警告失敗
if (multi.length) {
  fail("同名 function 宣告超過一次: " + multi.map(([n, c]) => `${n}×${c}`).join(", "));
}

if (!code.includes("LIVE_WINDOW") || !code.includes("getWeekData") || !code.includes("history.json")) {
  fail("活讀兩週相關符號缺失（LIVE_WINDOW / getWeekData / history.json）");
}
if (!code.includes("sheet_gids.json") || !code.includes("export?format=xlsx&gid=")) {
  fail("活週必須用 sheet_gids.json + 單分頁 gid 匯出,不准再抓整本 xlsx");
}
if (/apiGet\("week"/.test(code)) {
  fail("loadWeekData 不該再打 week API");
}

console.log("OK: syntax + no duplicate function headers");
