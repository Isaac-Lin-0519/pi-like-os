#!/bin/bash
# Mac：在 Finder 裡雙擊這個檔案，就會啟動 pi-like-os 並打開虛擬麵包板網頁
cd "$(dirname "$0")"

if ! docker info >/dev/null 2>&1; then
    echo "Docker Desktop 還沒啟動，請先打開 Docker Desktop，等它顯示 running 後再執行一次。"
    read -r -p "按 Enter 關閉視窗…"
    exit 1
fi

echo "啟動 pi-like-os（第一次要下載程式，需要幾分鐘）…"
docker compose up -d || { read -r -p "啟動失敗，按 Enter 關閉視窗…"; exit 1; }

open http://localhost:8080
echo
echo "已啟動！"
echo "  虛擬麵包板：http://localhost:8080"
echo "  連進樹莓派：ssh pi@localhost -p 2222（密碼 raspberry）"
echo
echo "要關機請執行：docker compose stop"
