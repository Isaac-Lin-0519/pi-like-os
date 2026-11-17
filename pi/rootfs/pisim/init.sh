#!/bin/bash
# ------------------------------------------------------------------
# pi-like-os 的「開機程式」
#
# 真正的樹莓派由 systemd 負責開機；Docker 容器裡沒有 systemd，
# 所以改用 Debian 傳統的 sysvinit 方式：
#   開機 → 依序執行 /etc/rc2.d/S* 腳本（啟動服務）
#   關機 → 依序執行 /etc/rc0.d/K* 腳本（停止服務）
#
# apt 安裝 mariadb-server、apache2 等套件時，會自動在 /etc/rc2.d 建立連結，
# 所以重開機後這些服務會自己啟動，跟真機一樣。
#
# 關機與重開機：
#   SIGTERM（docker compose stop、sudo poweroff）→ 停止服務後以 0 結束（關機）
#   SIGUSR1（sudo reboot）                       → 停止服務後以 1 結束，
#                                                  docker 的 restart: on-failure 會再把容器開起來
# ------------------------------------------------------------------

echo $$ > /run/pisim-init.pid

log() { echo "[開機] $*"; }

# 第一次開機時產生 ssh 主機金鑰（之後存在 /etc 的 volume 裡，不會再變）
ssh-keygen -A >/dev/null 2>&1

# 更新 image 後新增的模擬工具（例如 raspi-config），在舊的「SD 卡」裡補上連結
/pisim/links.sh

log "啟動服務（/etc/rc2.d）"
for script in /etc/rc2.d/S*; do
    [ -x "$script" ] || continue
    "$script" start
done

# 保險：就算 ssh 的開機連結被刪掉，也要能連進來
if ! pgrep -x sshd >/dev/null; then
    service ssh start
fi

log "開機完成，可以用 ssh pi@localhost -p 2222 連線"

stop_services() {
    log "停止服務（/etc/rc0.d）"
    for script in /etc/rc0.d/K*; do
        [ -x "$script" ] || continue
        "$script" stop
    done
}

poweroff() { stop_services; log "關機"; exit 0; }
reboot()   { stop_services; log "重新開機"; exit 1; }

trap poweroff TERM INT
trap reboot USR1

# 等待關機或重開機的訊號
while true; do
    sleep infinity &
    wait $!
done
