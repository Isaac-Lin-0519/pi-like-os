#!/bin/bash
# ------------------------------------------------------------------
# 用 docker buildx 建立多架構 image（arm64：Apple Silicon Mac；amd64：Windows / Intel）
#
#   scripts/build-multiarch.sh                 只在本機建立 amd64 版本並載入（測試用）
#   scripts/build-multiarch.sh --push <前綴> <版本>   建立 amd64 + arm64 並推到 registry
#                     例如：--push ghcr.io/你的帳號/pi-like-os 0.2.0（不使用 latest）
#
# 平常不需要這個腳本：推到 GitHub 後，GitHub Actions（.github/workflows/images.yml）
# 會自動建立 amd64 + arm64 並推到 ghcr.io。這個腳本留給在本機測試 amd64 版本用。
# ------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

# Docker Desktop 預設的 containerd image store 可以直接建立多架構 image；
# 如果出現「Multi-platform build is not supported for the docker driver」，
# 請到 Docker Desktop → Settings → General 勾選「Use containerd for pulling and storing images」

if [ "${1:-}" = "--push" ]; then
    prefix=${2:?請提供 image 前綴，例如 ghcr.io/你的帳號/pi-like-os}
    version=${3:?請提供版本號，例如 0.2.0}
    for svc in pi sim; do
        docker buildx build \
            --platform linux/amd64,linux/arm64 \
            -t "$prefix/$svc:$version" --push "./$svc"
    done
else
    for svc in pi sim; do
        docker buildx build \
            --platform linux/amd64 \
            -t "pi-like-os/$svc:amd64" --load "./$svc"
    done
    echo "完成：pi-like-os/pi:amd64、pi-like-os/sim:amd64"
fi
