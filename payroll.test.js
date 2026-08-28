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

test("行政表格提供 AT 專用的每日補牌輸入", () => {
  assert.match(html, /data-edit="atCard"/);
  assert.match(html, /AT補牌/);
});
