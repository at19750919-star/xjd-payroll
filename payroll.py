"""
週薪資結算。靠 M 欄標籤定位(不寫死行號),算式全在 payroll_config.js。

唯讀:只會從試算表讀資料,絕不寫回。只印終端機報表——
即時網頁版(index.html)自己直接讀寫試算表,不靠這支腳本產生。

用法:
  python payroll.py                 # 最新分頁,印在終端機
  python payroll.py 0810            # 指定分頁
"""
import sys, json
from pathlib import Path
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

sys.stdout.reconfigure(encoding="utf-8")

BASE = Path(__file__).parent
SECRETS = Path(r"C:\Users\at197\.secrets\新巨蛋")
MASTER_SID = "13f8OR_e4B4vTXgzoNQ0sswBbkfmj6jOJGfnweNaJx1c"
SCAN_RANGE = "M1:V60"          # 彙總區掃描範圍(M 欄是標籤欄)


def load_config():
    # 設定檔包成 JS(window.PAYROLL_CONFIG = {...};)好讓 index.html 用 <script> 載入,
    # 這裡把包裝剝掉再當 JSON 解析,兩邊共用同一份設定,不會分岔。
    raw = (BASE / "payroll_config.js").read_text(encoding="utf-8")
    body = raw.split("=", 1)[1].strip().rstrip(";").strip()
    return json.loads(body)


def get_sheets():
    creds = Credentials.from_authorized_user_file(str(SECRETS / "gtoken.json"))
    return build("sheets", "v4", credentials=creds)


def read_grid(sheets, tab):
    """讀彙總區,回傳補齊寬度的二維陣列(index 0 = M 欄)"""
    res = sheets.spreadsheets().values().get(
        spreadsheetId=MASTER_SID, range=f"'{tab}'!{SCAN_RANGE}",
        valueRenderOption="UNFORMATTED_VALUE").execute()
    rows = res.get("values", [])
    width = max((len(r) for r in rows), default=0)
    return [list(r) + [""] * (width - len(r)) for r in rows]


def label_of(row):
    return str(row[0]).strip() if row else ""


def find_row(grid, label, start=0):
    """找 M 欄等於 label 的列,回傳 0-based index;找不到回 None"""
    for i in range(start, len(grid)):
        if label_of(grid[i]) == label:
            return i
    return None


def find_total_col(grid, header_idx, want):
    """在表頭列找『合計』欄,回傳 index"""
    for j, cell in enumerate(grid[header_idx]):
        if str(cell).strip() == want:
            return j
    return None


def num(v):
    if v == "" or v is None:
        return 0.0
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


class Bail(Exception):
    pass


def locate(grid, cfg):
    """定位所有需要的東西;抓不到就 Bail(不猜)"""
    L = cfg["標籤"]
    out = {}

    # 主彙總區:第一個含「合計」的列就是日期表頭
    hdr = None
    for i, row in enumerate(grid):
        if L["合計欄"] in [str(c).strip() for c in row]:
            hdr = i
            break
    if hdr is None:
        raise Bail(f"找不到主表頭(含「{L['合計欄']}」的列)")
    out["主表頭"] = hdr
    out["合計欄"] = find_total_col(grid, hdr, L["合計欄"])

    for key in ("勝負列", "洗碼列", "營業額列"):
        idx = find_row(grid, L[key])
        if idx is None:
            raise Bail(f"找不到「{L[key]}」這一列")
        out[key] = idx

    idx = find_row(grid, L["退水列"])
    out["退水列"] = idx          # 舊分頁可能沒有,允許 None

    # 正式荷官區
    head = find_row(grid, L["正式區標題"])
    if head is None:
        raise Bail(f"找不到「{L['正式區標題']}」區塊")
    tail = find_row(grid, L["正式區結尾"], head)
    if tail is None:
        raise Bail(f"找不到「{L['正式區結尾']}」(正式荷官區的結尾)")
    out["正式區"] = (head, tail)

    # 實習區(可有可無)
    ihead = find_row(grid, L["實習區標題"])
    out["實習區標題列"] = ihead
    return out


def collect_people(grid, head_idx, end_idx, total_col):
    """從區塊標題往下抓人:標題+1 是表頭,之後到 end_idx 為止,M 欄有名字就算一個人"""
    people = []
    for i in range(head_idx + 2, end_idx):
        name = label_of(grid[i])
        if not name:
            continue
        hours = num(grid[i][total_col]) if total_col < len(grid[i]) else 0.0
        if hours == 0:                       # 合計欄空的就自己加日資料
            hours = sum(num(c) for c in grid[i][1:total_col])
        people.append({"名字": name, "時數": hours, "列": i})
    return people


def compute(grid, loc, cfg):
    tc = loc["合計欄"]
    r = {}

    勝負合計 = num(grid[loc["勝負列"]][tc])
    洗碼合計 = num(grid[loc["洗碼列"]][tc])

    r["勝負合計"] = 勝負合計
    r["洗碼合計"] = 洗碼合計
    r["總勝負"] = 勝負合計 * -1
    r["總退水"] = 洗碼合計 * cfg["退水每點"]
    r["總營業額"] = r["總勝負"] - r["總退水"]

    # 交叉檢查:跟「總計」列的合計比(舊分頁可能沒乘 -1,故比絕對值)
    表上營業額 = num(grid[loc["營業額列"]][tc])
    r["_營業額對照"] = 表上營業額
    r["_營業額相符"] = abs(abs(表上營業額) - r["總營業額"]) < 1

    # 荷官
    fh, ft = loc["正式區"]
    正式 = collect_people(grid, fh, ft, tc)
    if not 正式:
        raise Bail("正式荷官區沒抓到任何人")

    實習 = []
    if loc["實習區標題列"] is not None:
        實習 = collect_people(grid, loc["實習區標題列"], len(grid), tc)

    正式總時數 = sum(p["時數"] for p in 正式)
    if 正式總時數 <= 0:
        raise Bail("正式荷官總時數為 0,無法分獎金")

    表上總時數 = num(grid[ft][tc])
    r["_總時數相符"] = abs(表上總時數 - 正式總時數) < 0.01
    r["_總時數對照"] = 表上總時數

    獎金池 = r["總營業額"] * cfg["獎金率"]
    固定 = cfg.get("固定比例") or {}
    用固定 = cfg["獎金分配方式"] == "固定比例"

    借支 = cfg.get("借支") or {}

    def apply_loan(p):
        rec = 借支.get(p["名字"]) or {}
        餘額 = float(rec.get("餘額") or 0)
        週還 = float(rec.get("週還") or 0)
        pay = p["合計"]
        if pay is None:
            p["還款"] = None
            p["實發"] = None
            p["總欠款"] = 餘額
            return p
        還款 = max(0, min(週還, 餘額, pay))
        p["還款"] = 還款
        p["實發"] = pay - 還款
        p["總欠款"] = 餘額 - 還款
        return p

    for p in 正式:
        p["比例"] = 固定.get(p["名字"], 0.0) if 用固定 else p["時數"] / 正式總時數
        p["時薪金額"] = round(p["時數"] * cfg["時薪"])
        p["獎金"] = round(獎金池 * p["比例"])
        p["合計"] = p["時薪金額"] + p["獎金"]
        apply_loan(p)

    ic = cfg.get("實習") or {}
    intern_wage = ic.get("時薪")
    for p in 實習:
        if intern_wage in (None, ""):
            p["時薪金額"] = None
            p["獎金"] = None
            p["合計"] = None
        else:
            p["時薪金額"] = round(p["時數"] * intern_wage)
            p["獎金"] = round(r["總營業額"] * ic.get("獎金率", 0) )
            p["合計"] = p["時薪金額"] + p["獎金"]
        apply_loan(p)

    r["正式"] = 正式
    r["實習"] = 實習
    r["正式總時數"] = 正式總時數
    r["獎金池"] = round(獎金池)

    # 對場主（只算正式時數）
    收時數 = 正式總時數
    r["對場主_業績"] = round(r["總營業額"] * cfg["對場主"]["業績率"])
    r["對場主_荷官時數"] = 收時數
    r["對場主_荷官薪資"] = round(收時數 * cfg["時薪"])
    r["對場主_合計"] = r["對場主_業績"] + r["對場主_荷官薪資"]

    # 老闆損益
    付正式 = sum(p["實發"] for p in 正式)
    r["付_正式荷官"] = 付正式
    r["付_實習"] = sum(p["實發"] for p in 實習 if p["實發"] is not None)
    r["還款小計"] = sum(p["還款"] or 0 for p in 正式) + sum(p["還款"] or 0 for p in 實習)
    r["實習未定"] = any(p["合計"] is None for p in 實習)
    r["行政未定"] = not cfg["行政"]["人員"]
    r["淨額"] = r["對場主_合計"] - 付正式 - r["付_實習"]
    return r


def money(v):
    return f"{v:,.0f}" if isinstance(v, (int, float)) else "—"


def report(tab, r, cfg):
    print(f"\n===== {tab} 薪資結算 =====")
    print(f"總勝負    {money(r['總勝負']):>12}")
    print(f"總退水    {money(-r['總退水']):>12}")
    print(f"總營業額  {money(r['總營業額']):>12}"
          + ("" if r["_營業額相符"] else f"   ⚠ 表上「總計」= {money(r['_營業額對照'])},不符!"))
    if not r["_總時數相符"]:
        print(f"⚠ 表上「全部總時數」= {r['_總時數對照']},我算出 {r['正式總時數']},不符!")

    print(f"\n-- 正式荷官(時薪 {cfg['時薪']}/hr,獎金池 {money(r['獎金池'])} = 營業額×{cfg['獎金率']:.0%}) --")
    print(f"{'荷官':<14}{'時數':>7}{'比例':>8}{'時薪':>10}{'獎金':>9}{'合計':>10}")
    for p in r["正式"]:
        print(f"{p['名字']:<14}{p['時數']:>7.1f}{p['比例']:>7.1%}"
              f"{money(p['時薪金額']):>11}{money(p['獎金']):>10}{money(p['合計']):>11}")
    print(f"{'小計':<14}{r['正式總時數']:>7.1f}{'':>7}"
          f"{money(sum(p['時薪金額'] for p in r['正式'])):>11}"
          f"{money(sum(p['獎金'] for p in r['正式'])):>10}"
          f"{money(r['付_正式荷官']):>11}")

    if r["實習"]:
        print(f"\n-- 實習荷官 --")
        for p in r["實習"]:
            note = "(算法未定,預留)" if p["合計"] is None else ""
            print(f"{p['名字']:<14}{p['時數']:>7.1f}   {money(p['合計'])} {note}")

    if r["行政未定"]:
        print(f"\n-- 行政人員 --\n(2 位,算法未定,預留)")

    print(f"\n-- 向場主收 --")
    print(f"業績({cfg['對場主']['業績率']:.0%})        {money(r['對場主_業績']):>12}")
    print(f"荷官薪資({r['對場主_荷官時數']:g}h×{cfg['時薪']}) {money(r['對場主_荷官薪資']):>12}")
    print(f"合計應收         {money(r['對場主_合計']):>12}")

    print(f"\n-- 老闆損益 --")
    print(f"收  {money(r['對場主_合計']):>12}")
    print(f"付  {money(-(r['付_正式荷官'] + r['付_實習'])):>12}  (正式荷官時薪+獎金"
          + ("；實習/行政未計" if r["實習未定"] or r["行政未定"] else "") + ")")
    print(f"淨  {money(r['淨額']):>12}"
          + ("   ← 尚未扣實習與行政" if r["實習未定"] or r["行政未定"] else ""))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cfg = load_config()
    sheets = get_sheets()

    if args:
        tab = args[0]
    else:
        meta = sheets.spreadsheets().get(spreadsheetId=MASTER_SID).execute()
        tab = meta["sheets"][0]["properties"]["title"]
        print(f"(未指定分頁,用第一個分頁 {tab})")

    grid = read_grid(sheets, tab)
    try:
        loc = locate(grid, cfg)
        r = compute(grid, loc, cfg)
    except Bail as e:
        print(f"✗ 定位失敗:{e}")
        print("  → 這週彙總區的版型跟 payroll_config.js 的『標籤』對不上,"
              "請確認標籤文字或補上缺的區塊,不要硬跑。")
        sys.exit(1)

    report(tab, r, cfg)


if __name__ == "__main__":
    main()
