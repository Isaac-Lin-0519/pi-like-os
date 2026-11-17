#!/bin/bash
# ------------------------------------------------------------------
# 發布新版：scripts/release.sh 0.2.0
#
#   1. 把 docker-compose.yml 裡兩個 image 的版本改成 0.2.0
#   2. commit，並加上 v0.2.0 標籤
#   3. 告訴你要執行的 git push 指令（推送由你自己執行）
#
# 推送 v0.2.0 標籤後，GitHub Actions 會建立並推送 0.2.0 版的 image。
# 使用者下載新版的 pi-like-os 後執行 docker compose up -d，就會自動下載 0.2.0 版。
# ------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

version=${1:-}
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "用法：scripts/release.sh <版本號>，例如 scripts/release.sh 0.2.0" >&2
    exit 1
fi
if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
    echo "標籤 v$version 已經存在。請用新的版本號。" >&2
    exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
    echo "還有沒 commit 的修改。請先 commit，再發布。" >&2
    git status --short >&2
    exit 1
fi

echo "執行電路求解器測試…"
node sim/tests/circuit.test.mjs >/dev/null

sed -E -i.bak "s#(ghcr\.io/[^ ]+/pi-like-os/(pi|sim)):[^ ]+#\1:$version#" docker-compose.yml
rm -f docker-compose.yml.bak
grep -n "image:" docker-compose.yml

git add docker-compose.yml
git commit -q -m "發布 $version"
git tag -a "v$version" -m "pi-like-os $version"

echo
echo "完成：commit 並加上標籤 v$version。請執行下面的指令推送："
echo
echo "  git push && git push origin v$version"
