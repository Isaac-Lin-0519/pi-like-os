# 其他專案的授權

pi-like-os 本身使用 [MIT 授權](LICENSE)。
以下的內容來自其他專案，或在建立 image 時從其他專案下載。

## 在這個 repo 裡

| 檔案 | 來源 | 授權 | 說明 |
|---|---|---|---|
| `sim/lgpio/lgpio.py` | [lgpio](https://abyz.me.uk/lg/py_lgpio.html)（joan2937） | Unlicense（公有領域） | 常數、錯誤訊息和部分函式說明沿用 lgpio，讓程式的行為和真的 lgpio 相同。程式碼是 pi-like-os 自己寫的 |
| `sim/spidev/spidev.py` | [py-spidev](https://github.com/doceme/py-spidev) | MIT | 只沿用函式名稱與參數（API），讓程式不用改。程式碼和說明是 pi-like-os 自己寫的 |
| 虛擬麵包板的圖（`sim/static/board.js`） | — | MIT（pi-like-os） | 樹莓派、麵包板和零件的圖都是 pi-like-os 自己用 SVG 畫的，沒有使用 Fritzing 或其他圖庫 |

## 建立 image 時下載的軟體

這些軟體不在這個 repo 裡。建立 image 時，Docker 從它們的官方來源下載。各軟體使用自己的授權。

| 軟體 | 授權 | 用途 |
|---|---|---|
| Debian trixie 和它的套件 | 各套件的授權（多數是 GPL、LGPL、BSD、MIT） | Pi 容器的作業系統 |
| [gpiozero](https://github.com/gpiozero/gpiozero) 2.0.1 | BSD-3-Clause | 建立 image 時產生 `pinout` 指令的輸出 |
| [tini](https://github.com/krallin/tini) | MIT | Pi 容器的 init 程式 |
| Python 3.13（`python:3.13-slim`） | PSF License | sim 容器 |
| [aiohttp](https://github.com/aio-libs/aiohttp) | Apache-2.0 | sim 容器的網頁伺服器 |

## 商標

Raspberry Pi 是 Raspberry Pi Ltd 的商標。pi-like-os 和 Raspberry Pi Ltd 沒有關係，也沒有得到它的認可。
