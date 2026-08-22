@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 啟動本機伺服器,瀏覽器會自動開啟。關掉這個視窗即停止。
start "" http://127.0.0.1:8765/index.html
python -m http.server 8765 --bind 127.0.0.1
