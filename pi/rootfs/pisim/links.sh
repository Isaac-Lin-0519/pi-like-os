#!/bin/sh
# ------------------------------------------------------------------
# 在系統路徑建立指向 /pisim 模擬工具的連結。
#
# /usr 是 volume（SD 卡），只有第一次建立時才會從 image 複製內容；
# 之後更新 image 新增的工具不會自動出現在舊的 volume 裡。
# 所以 image 建置時跑一次，每次開機（init.sh）也再跑一次，缺少的連結會自動補上。
# ------------------------------------------------------------------
link() {
    [ -L "$2" ] && [ "$(readlink "$2")" = "$1" ] && return 0
    # 不覆蓋使用者自己裝的同名程式（例如真的 raspi-config）
    [ -e "$2" ] && [ ! -L "$2" ] && return 0
    ln -sf "$1" "$2"
}

link /pisim/bin/pinout       /usr/local/bin/pinout
link /pisim/bin/systemctl    /usr/local/bin/systemctl
link /pisim/bin/raspi-config /usr/local/bin/raspi-config
link /pisim/bin/runlevel     /usr/sbin/runlevel
link /pisim/bin/init         /usr/sbin/init
for n in reboot poweroff halt shutdown; do
    link "/pisim/bin/$n" "/usr/local/sbin/$n"
done
