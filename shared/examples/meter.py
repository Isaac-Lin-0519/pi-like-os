# 三段旋鈕儀表：轉可變電阻，三顆 LED 依序亮起
#
# 電路：在虛擬麵包板的「範例電路」選「三段旋鈕儀表」
#   可變電阻中間腳 → MCP3008 CH0（SPI0、CE0）
#   LED：GPIO17（紅）、GPIO27（綠）、GPIO22（黃），各串 1kΩ 到 GND
from gpiozero import MCP3008, LED
from time import sleep

pot = MCP3008(channel=0)
leds = [LED(17), LED(27), LED(22)]

try:
    while True:
        v = pot.value                     # 0.0 ～ 1.0
        lit = 0
        for i, led in enumerate(leds):
            if v > (i + 1) / 4:           # 超過 0.25、0.50、0.75 就多亮一顆
                led.on()
                lit += 1
            else:
                led.off()
        print("{:.2f} [{:<3}]".format(v, "#" * lit))
        sleep(0.2)
except KeyboardInterrupt:
    print("實驗已停止。")
finally:
    for led in leds:
        led.off()
        led.close()
    pot.close()
