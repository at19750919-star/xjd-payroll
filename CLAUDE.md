# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Static single-page casino/dealer payroll dashboard. No build step, no bundler, no package manager, no test suite, no lint config.

- `index.html` — the live, authoritative app. Reads/writes the Google Sheet directly from the browser (fetches the sheet's public xlsx export URL).
- `payroll_config.js` — shared config (`window.PAYROLL_CONFIG`), loaded by `index.html` via `<script>` tag and also parsed by `payroll.py` (strip the `window.PAYROLL_CONFIG = ... ;` wrapper, then `json.loads`). This is the single source of truth for business rules — labels, rates, name lists.
- `payroll.py` — **read-only** CLI report tool (`python payroll.py [tab_name]`) using the real Google Sheets API. It cross-checks `index.html`'s output and must never write to the sheet. Comments in the file explicitly say: to change a business rule, edit `payroll_config.js`, not `payroll.py`.
- `設定記錄.html` — settings-change audit log viewer.
- `開啟.bat` — local dev launcher: runs `python -m http.server 8765` then opens `index.html` through it. Required because opening `index.html` via `file://` breaks the sheet export fetch (CORS); `file://` access auto-redirects to the deployed GitHub Pages copy instead.

Spreadsheet ID (hardcoded in both `index.html` and `payroll.py`): `13f8OR_e4B4vTXgzoNQ0sswBbkfmj6jOJGfnweNaJx1c`. `payroll.py`'s OAuth token lives outside the repo at `C:\Users\at197\.secrets\新巨蛋\gtoken.json`.

## Key conventions and gotchas

- **Sheet layout is label-driven, not position-driven.** Rows/columns in `M1:V60` are located by scanning for label text defined in `payroll_config.js`'s `標籤` block (e.g. `"正式區標題": "荷官工作時數統計"`). If sheet headers change, update the labels config — not row/column indices.
- **顯示名稱 (display name) format is `外號(TG帳號)`** (nickname + Telegram handle). This exact string is a shared key across multiple systems (Telegram group display name, dealer-hours cron, this sheet, this dashboard) — a name change must be kept in sync everywhere. See the global `荷官異動` skill for the full cross-system checklist.
- `normalizedName()` (index.html) strips whitespace and lowercases before comparing names — used everywhere names are matched, since raw strings vary in case/spacing.
- `FORCED_INTERNS` and `ADMIN_NAMES` are hardcoded name sets in `index.html` that override sheet-driven categorization for specific people. Renaming or replacing one of these people requires updating these sets too, not just the sheet.
- 借支 (loan/advance) handling: `餘額` (balance) carries forward week to week; repayment each week is `min(週還, 餘額, 應發)`. There's a `LOAN_SCHEMA_VERSION` / `LOAN_CARRY_VERSION` migration mechanism for evolving the per-person loan JSON shape stored in sheet-backed settings — bump it when changing that shape.
- Column M can accidentally pick up a stray URL row from the sheet; `payroll.py` filters these out. Keep equivalent filtering in mind if touching `index.html`'s row-scanning logic.
- Config terms: 對場主 = the business owner paying the dealers; 業績率 = revenue-share rate; 退水每點 = rake-per-point.

## UI style — do not drift

`index.html` has one established visual language, named in its own CSS comment: **「百家3.0 設計系統(黑金)」**(black-gold casino theme). Any UI change must reuse this system, not invent a new look:

- Colors: only the `:root` variables — `--ink`(#07090b 底) `--panel`(#10171a 面板) `--felt-1/2`(綠桌墊) `--gold-1/2/3`(金色系,由亮到暗) `--gold-line`(金色漸層邊框) `--txt`/`--txt-dim`(文字) `--banker`(#e05c4f 紅) `--ok`(#67c98f 綠)。新元件的顏色一律從這組變數挑,不要手打新的 hex。
- Fonts: only the three `--serif`/`--sans`/`--disp` families already defined — `--disp`(Cinzel/Noto Serif TC)用於數字與標題強調、`--serif`用於窄letter-spacing的標籤字、`--sans`(Noto Sans TC)用於一般內文。不要引入新字體。
- Spacing/letter-spacing/border patterns: copy from the nearest existing similar element (e.g. a new label should match an existing label's `letter-spacing`/`text-indent` pattern) rather than guessing a new value.
- Before claiming a UI edit is done, actually look at it rendered — per global rule, use `mcp__claude-in-chrome__*` (real Chrome) for anything involving size/layout/cropping, never the built-in browser panel for those judgments.

## Workflow

Solo-dev, direct-to-`main` commits, no PRs. Commit messages are short, imperative, Traditional Chinese.
