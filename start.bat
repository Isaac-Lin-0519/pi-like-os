@echo off
rem Windows：雙擊這個檔案，就會啟動 pi-like-os 並打開虛擬麵包板網頁
chcp 65001 >nul
cd /d "%~dp0"

docker info >nul 2>&1
if errorlevel 1 (
    echo Docker Desktop 還沒啟動，請先打開 Docker Desktop，等它顯示 running 後再執行一次。
    pause
    exit /b 1
)

echo 啟動 pi-like-os（第一次要下載程式，需要幾分鐘）…
docker compose up -d
if errorlevel 1 (
    echo 啟動失敗
    pause
    exit /b 1
)

start http://localhost:8080
echo.
echo 已啟動！
echo   虛擬麵包板：http://localhost:8080
echo   連進樹莓派：ssh pi@localhost -p 2222（密碼 raspberry）
echo.
echo 要關機請執行：docker compose stop
pause
