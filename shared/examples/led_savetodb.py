# LED 閃爍 + 把狀態寫進 MariaDB（測試用範例）
#
# 這是依照課堂 SavetoDB 的描述寫的測試版本，請換成課堂上的原始程式。
# 執行前請先在 MariaDB 建好資料庫、帳號與資料表，例如：
#
#   sudo mariadb
#   CREATE DATABASE myschool;
#   CREATE USER 'pma'@'localhost' IDENTIFIED BY 'pma1234';
#   GRANT ALL PRIVILEGES ON myschool.* TO 'pma'@'localhost';
#   USE myschool;
#   CREATE TABLE led_log (
#       id INT AUTO_INCREMENT PRIMARY KEY,
#       status INT,
#       record_time DATETIME
#   );
from datetime import datetime
from time import sleep

import pymysql
from gpiozero import LED

DB = dict(host="localhost", user="pma", password="pma1234", database="myschool", charset="utf8mb4")
TABLE_NAME = "led_log"


def save_data(**values):
    values.setdefault("record_time", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    columns = ", ".join(values)
    marks = ", ".join(["%s"] * len(values))
    conn = pymysql.connect(**DB)
    try:
        with conn.cursor() as cur:
            cur.execute(f"INSERT INTO {TABLE_NAME} ({columns}) VALUES ({marks})", list(values.values()))
        conn.commit()
    finally:
        conn.close()


led = LED(18)
try:
    while True:
        led.on(); print(led.is_lit); save_data(status=1); sleep(3)
        led.off(); save_data(status=0); sleep(1)
except KeyboardInterrupt:
    print("實驗已停止。")
finally:
    led.off(); led.close()
