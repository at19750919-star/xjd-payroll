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

test("行政營業抽成欄頭顯示為獎金", () => {
  assert.match(html, /<th>固定薪<\/th><th>獎金<\/th><th>合計<\/th>/);
});

function loadIsLiveTab(tabs) {
  const fnMatch = html.match(/function isLiveTab\([^]*?\n  }/);
  assert.ok(fnMatch, "isLiveTab 必須存在於 index.html");
  const liveWindowMatch = html.match(/const LIVE_WINDOW = (\d+)/);
  assert.ok(liveWindowMatch, "LIVE_WINDOW 必須存在於 index.html");
  const context = { TABS: tabs, LIVE_WINDOW: Number(liveWindowMatch[1]) };
  vm.createContext(context);
  vm.runInContext(`${fnMatch[0]}; this.result = isLiveTab;`, context);
  return context.result;
}

test("isLiveTab 只把排序後最後 LIVE_WINDOW 個 tab 當活週", () => {
  const isLiveTab = loadIsLiveTab(["0810", "0817", "0824", "0831", "0907"]);
  assert.equal(isLiveTab("0810"), false);
  assert.equal(isLiveTab("0824"), false);
  assert.equal(isLiveTab("0831"), true);
  assert.equal(isLiveTab("0907"), true);
});

test("舊週一律走 getWeekData,不直接呼叫 loadWeekData/WEEK_CACHE", () => {
  assert.doesNotMatch(html, /WEEK_CACHE\[\w+\] \|\| \(WEEK_CACHE\[\w+\] = await loadWeekData/);
  assert.match(html, /async function getWeekData\(tab\)/);
});

test("活週 xlsx 只抓單一 gid,不匯出整本", () => {
  assert.match(html, /export\?format=xlsx&gid=/);
  assert.match(html, /sheet_gids\.json/);
  assert.doesNotMatch(html, /export\?format=xlsx`\)/);
  assert.doesNotMatch(html, /export\?format=xlsx"\)/);
});

test("loadWeekData 不再打 week API", () => {
  const start = html.indexOf("async function loadWeekData");
  const end = html.indexOf("async function getWeekData");
  assert.ok(start >= 0 && end > start, "找不到 loadWeekData/getWeekData");
  assert.doesNotMatch(html.slice(start, end), /apiGet\("week"/);
});


test("實習預設時薪 325，寶(²) 個別時薪 187.5", () => {
  const cfgSrc = fs.readFileSync("payroll_config.js", "utf8");
  assert.match(cfgSrc, /"時薪":\s*325/);
  assert.match(cfgSrc, /"個別時薪":\s*\{\s*"寶\(²\)":\s*187\.5\s*\}/);
  assert.match(html, /function internWageFor\(/);
  assert.doesNotMatch(html, /data-edit="internPersonWage"/);
  assert.match(html, /id="loan-wage-block"/);
  assert.match(html, /id="loan-wage"/);
  // 實習列時薪欄渲染的是時薪金額（時數×時薪），不是單價
  assert.match(html, /<td>\$\{money\(p\.時薪金額\)\}<\/td>/);
  // 抽 internWageForCfg 行為：預設 325、寶(²) 覆寫 187.5
  const fnMatch = html.match(/function internWageForCfg\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, "internWageForCfg 函式應存在於 index.html");
  const nmMatch = html.match(/function normalizedName\([\s\S]*?\n  \}/);
  assert.ok(nmMatch, "normalizedName 函式應存在");
  const context = {};
  const vm = require("node:vm");
  vm.runInNewContext(
    nmMatch[0] + ";" + fnMatch[0] + "; this.internWageForCfg = internWageForCfg;",
    context,
  );
  const cfg = { 實習: { 時薪: 325, 個別時薪: { "寶(²)": 187.5 } } };
  assert.equal(context.internWageForCfg(cfg, "寶(²)"), 187.5);
  assert.equal(context.internWageForCfg(cfg, "其他人(x)"), 325);
  assert.equal(context.internWageForCfg({ 實習: {} }, "寶(²)"), null);
});

function loadCompute() {
  const fnSrc = (name) => {
    const m = html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n  \\}`));
    assert.ok(m, `${name} 必須存在於 index.html`);
    return m[0];
  };
  const computeMatch = html.match(/function compute\(cfg, sourceData\) \{[\s\S]*?\n  \}\n\n  function internWage/);
  assert.ok(computeMatch, "compute 必須存在於 index.html");
  const computeSrc = computeMatch[0].replace(/\n\n  function internWage$/, "");
  const src = [
    fnSrc("normalizedName"),
    fnSrc("pyRound"),
    fnSrc("internWageChargedToCompany"),
    fnSrc("isInternBonusIncluded"),
    fnSrc("findSoloBonusDay"),
    fnSrc("soloShareOf"),
    fnSrc("internWageForCfg"),
    fnSrc("calculateAtCardBonus"),
    fnSrc("applyLoan"),
    computeSrc,
    "; this.compute = compute;",
  ].join(";\n");
  const context = {
    ADMIN_NAMES: new Set(["阿生", "at"]),
    CONFIG: {
      實習: { 向公司收起始週: "0817" },
      行政: { AT補牌單價: 300 },
      納入正式分獎金自: { "Vicky(V)": "2026-09-21" },
      獨立分配日: { "2026-09-30": { "小安(報班專用)": 0.4, "溜(xiao)": 0.4, "Vicky(V)": 0.1, "寶(²)": 0.1 } },
    },
  };
  vm.runInNewContext(src, context);
  return context.compute;
}

function baseCfg(overrides) {
  return Object.assign({
    時薪: 650,
    獎金率: 0.02,
    獎金分配方式: "工時佔比",
    固定比例: {},
    對場主: { 業績率: 0.12 },
    實習: { 時薪: 325, 個別時薪: { "寶(²)": 187.5 }, 獎金率: 0 },
    行政: { AT補牌單價: 300 },
    退水每點: 200,
    納入正式分獎金自: { "Vicky(V)": "2026-09-21" },
  }, overrides);
}

function baseData(tab, extraInterns) {
  return {
    tab,
    勝負合計: -100000,
    洗碼合計: 100,
    正式: [
      { 名字: "布(laire)", 時數: 40 },
      { 名字: "阿花(hua)", 時數: 60 },
    ],
    實習: [
      { 名字: "寶(²)", 時數: 30 },
      { 名字: "Vicky(V)", 時數: 20 },
      ...(extraInterns || []),
    ],
  };
}

test("tab 0914(納入正式分獎金自 0921 之前)：Vicky 獎金為 0，正式分母不含她", () => {
  const compute = loadCompute();
  const r = compute(baseCfg(), baseData("0914"));
  const vicky = r.實習.find((p) => p.名字 === "Vicky(V)");
  assert.equal(vicky.獎金, 0);
  assert.equal(vicky.納入正式分獎金, false);
  assert.equal(r.獎金分母, r.正式總時數);
  const formal = r.正式.find((p) => p.名字 === "布(laire)");
  assert.equal(formal.比例, 40 / r.正式總時數);
});

test("tab 0921(納入正式分獎金自生效)：分母含 Vicky 時數，她有獎金，正式比例用新分母", () => {
  const compute = loadCompute();
  const r = compute(baseCfg(), baseData("0921"));
  const vicky = r.實習.find((p) => p.名字 === "Vicky(V)");
  assert.equal(vicky.納入正式分獎金, true);
  const 分母 = r.正式總時數 + 20;
  assert.equal(r.獎金分母, 分母);
  assert.equal(vicky.比例, 20 / 分母);
  assert.equal(vicky.獎金, Math.round(r.獎金池 * (20 / 分母)));
  const formal = r.正式.find((p) => p.名字 === "布(laire)");
  assert.equal(formal.比例, 40 / 分母);
});

test("寶(²) 永遠不進分母、獎金為 0", () => {
  const compute = loadCompute();
  const rBefore = compute(baseCfg(), baseData("0914"));
  const rAfter = compute(baseCfg(), baseData("0921"));
  const baoBefore = rBefore.實習.find((p) => p.名字 === "寶(²)");
  const baoAfter = rAfter.實習.find((p) => p.名字 === "寶(²)");
  assert.equal(baoBefore.獎金, 0);
  assert.equal(baoAfter.獎金, 0);
  assert.equal(rAfter.獎金分母, rAfter.正式總時數 + 20);
});

test("Vicky 時薪仍是實習預設 325，寶(²) 仍是 187.5，不受分獎金納入影響", () => {
  const compute = loadCompute();
  const r = compute(baseCfg(), baseData("0921"));
  const vicky = r.實習.find((p) => p.名字 === "Vicky(V)");
  const bao = r.實習.find((p) => p.名字 === "寶(²)");
  assert.equal(vicky.用時薪, 325);
  assert.equal(bao.用時薪, 187.5);
});


// 0928 週實際資料(試算表 0928 分頁):9/30 獨立分配,其他天照時數比例
function data0928() {
  const days = ["9/28", "9/29", "9/30", "10/1", "10/2", "10/3", "10/4"];
  const ops = [[-550700, 293], [0, 0], [-9682500, 3428], [820300, 826], [0, 0], [0, 0], [0, 0]];
  const h = (arr) => ({ 每日時數: arr, 時數: arr.reduce((a, v) => a + (v || 0), 0) });
  return {
    tab: "0928",
    勝負合計: -9412900,
    洗碼合計: 4547,
    正式: [
      { 名字: "布(laire)", ...h([8, null, null, 4.5, null, null, null]) },
      { 名字: "瑄", ...h([null, null, null, null, null, null, null]) },
      { 名字: "溜(xiao)", ...h([8, null, 7, 4.5, null, null, null]) },
      { 名字: "小安(報班專用)", ...h([null, null, 7, null, null, null, null]) },
    ],
    實習: [
      { 名字: "寶(²)", ...h([8, null, 10.5, null, null, null, null]) },
      { 名字: "Vicky(V)", ...h([7, null, 7, null, null, null, null]) },
    ],
    每日營運: days.map((date, i) => ({ day: "", date, 勝負原值: ops[i][0], 洗碼量: ops[i][1], 筆數: ops[i][0] || ops[i][1] ? 1 : 0 })),
  };
}

test("0928 週:9/30 獨立分配(小安40/溜40/V10/寶10),其他天扣掉 9/30 時數照比例", () => {
  const compute = loadCompute();
  const r = compute(baseCfg(), data0928());
  assert.equal(r.總營業額, 8503500);
  assert.equal(r.獨立分配日, "2026-09-30");
  assert.equal(r.獨立日營業額, 8996900);
  assert.equal(r.獨立日獎金池, 179938);
  assert.equal(r.其他日獎金池, -9868);
  assert.equal(r.獎金分母, 32);
  const all = r.正式.concat(r.實習);
  const bonus = (n) => all.find((p) => p.名字 === n).獎金;
  assert.equal(bonus("布(laire)"), -3855);
  assert.equal(bonus("瑄"), 0);
  assert.equal(bonus("溜(xiao)"), 68121);
  assert.equal(bonus("小安(報班專用)"), 71975);
  assert.equal(bonus("Vicky(V)"), 15835);
  assert.equal(bonus("寶(²)"), 17994);
  // 時薪照常含 9/30 時數
  assert.equal(all.find((p) => p.名字 === "小安(報班專用)").時薪金額, 7 * 650);
  assert.equal(all.find((p) => p.名字 === "寶(²)").時薪金額, Math.round(18.5 * 187.5));
});

test("沒有獨立分配日的週(0921)計算不變", () => {
  const compute = loadCompute();
  const r = compute(baseCfg(), baseData("0921"));
  assert.equal(r.獨立分配日, null);
  assert.equal(r.獨立日獎金池, 0);
});
