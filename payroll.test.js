const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");

function loadFunction(name) {
  const match = html.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  assert.ok(match, `${name} 必須存在於 index.html`);
  const context = {};
  vm.runInNewContext(`${match[0]}; this.result = ${name};`, context);
  return context.result;
}

test("AT 補牌金額為有效數量乘以每牌 300 元", () => {
  const calculateAtCardBonus = loadFunction("calculateAtCardBonus");
  assert.deepEqual(
    JSON.parse(JSON.stringify(calculateAtCardBonus([0, 2, -1, 1.8, "3"], 300))),
    { 數量: 5, 金額: 1500 },
  );
});

test("AT 空白日期不顯示加號，補牌改由姓名視窗寫入", () => {
  assert.doesNotMatch(html, /data-edit="atCard"/);
  assert.match(html, /id="at-card-toggle"[^>]*>寫入補牌</);
  assert.match(html, /<th>補牌<\/th>/);
});

test("補牌紀錄按日期列出數量", () => {
  const collectAtCardHistory = loadFunction("collectAtCardHistory");
  const rows = collectAtCardHistory(
    {
      "0817": { 行政: { AT補牌: [0, 1, 0, 0, 0, 0, 0] } },
      "0824": { 行政: { AT補牌: [0, 0, 0, 0, 2, 0, 0] } },
    },
    {
      "0817": [{ date: "8/17", day: "一" }, { date: "8/18", day: "二" }],
      "0824": [null, null, null, null, { date: "8/28", day: "五" }],
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { tab: "0817", 日期: "8/18", 星期: "二", 數量: 1 },
    { tab: "0824", 日期: "8/28", 星期: "五", 數量: 2 },
  ]);
});

test("設定紀錄旁提供補牌紀錄按鈕與明細欄位", () => {
  assert.match(html, /id="at-card-history"[^>]*>補牌紀錄<\/button>/);
  assert.match(html, /<th>日期<\/th><th>數量<\/th>/);
});

test("AT 每日格只顯示有顏色的數量，補牌欄只顯示總金額", () => {
  const renderer = html.match(/const atCardCells[^]*?\.join\(""\);/)?.[0] || "";
  assert.match(renderer, /class="at-card-count"/);
  assert.match(renderer, />\$\{count\}<\/span>/);
  assert.doesNotMatch(renderer, /\$\{count\}牌/);
  assert.match(html, /p\.補牌數量 \? money\(p\.補牌金額\) : ""/);
  assert.match(html, /\.at-card-count\{[^}]*color:/);
});
