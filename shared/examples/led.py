from gpiozero import LED
from time import sleep
led = LED(18)
try:
    while True:
        led.on(); print(led.is_lit); sleep(3)
        led.off(); sleep(1)
except KeyboardInterrupt:
    print("實驗已停止。")
finally:
    led.off(); led.close()
