"""
spidev（pi-like-os 模擬版）

介面跟真正的 spidev 相同（SpiDev().open(0, 0)、xfer2([...]) 等），
差別只在於：真機會讀寫 /dev/spidev0.0，這個版本把資料送到「虛擬麵包板」伺服器，
由網頁上接好的 SPI 晶片（例如 MCP3008）回覆。

常見的 MCP3008 寫法不用改：
    spi = spidev.SpiDev()
    spi.open(0, 0)
    spi.max_speed_hz = 1350000
    r = spi.xfer2([1, (8 + channel) << 4, 0])
    value = ((r[1] & 3) << 8) + r[2]

本模組只使用 Python 標準函式庫。
"""

import json
import os
import socket
import sys
import threading

__version__ = "3.7"

_BRIDGE = os.environ.get("PISIM_BRIDGE", "sim:8765")


class _Bridge:
    """與虛擬麵包板伺服器的連線（每行一個 JSON，一問一答）"""

    def __init__(self, address):
        host, _, port = address.rpartition(":")
        self.address = (host or "sim", int(port))
        self.sock = None
        self.file = None
        self.next_id = 1
        self.warned = False
        self.lock = threading.Lock()
        self.opened = {}             # 目前開著的 (bus, ce) -> 開啟次數，重新連線時補回

    def call(self, op, **fields):
        with self.lock:
            for _ in range(2):           # 斷線時重連一次
                if self.sock is None and not self._connect():
                    return None
                try:
                    return self._request(dict(fields, op=op))
                except (OSError, ValueError):
                    self._drop()
            return None

    def _connect(self):
        try:
            sock = socket.create_connection(self.address, timeout=2)
        except OSError:
            if not self.warned:
                self.warned = True
                sys.stderr.write(
                    "[pi-like-os] 連不到虛擬麵包板（{}:{}），SPI 讀到的資料都會是 0。\n"
                    .format(*self.address))
            return False
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        self.sock, self.file = sock, sock.makefile("r", encoding="utf-8")
        try:
            self._request({"op": "hello", "pid": os.getpid(), "argv": sys.argv})
            for bus, ce in list(self.opened):
                self._request({"op": "spi_open", "bus": bus, "ce": ce})
        except (OSError, ValueError):
            self._drop()
            return False
        self.warned = False
        return True

    def _request(self, msg):
        msg["id"] = self.next_id
        self.next_id += 1
        self.sock.sendall((json.dumps(msg) + "\n").encode("utf-8"))
        while True:
            raw = self.file.readline()
            if not raw:
                raise OSError("連線中斷")
            reply = json.loads(raw)
            if reply.get("id") == msg["id"]:
                return reply
            # 沒有編號的是 GPIO 事件（spidev 用不到），略過

    def _drop(self):
        sock, self.sock = self.sock, None
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


_bridge = _Bridge(_BRIDGE)


class SpiDev(object):
    """SPI 裝置。SpiDev(bus, device) 等於先建立、再 open(bus, device)。"""

    def __init__(self, bus=None, client=None):
        self._dev = None
        self.mode = 0
        self.bits_per_word = 8
        self.max_speed_hz = 125000000
        self.cshigh = False
        self.lsbfirst = False
        self.threewire = False
        self.loop = False
        self.no_cs = False
        self.read0 = False
        if bus is not None:
            self.open(bus, client if client is not None else 0)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    def open(self, bus, device):
        """開啟 /dev/spidev<bus>.<device>。模擬環境只有 bus 0、device 0 或 1。"""
        if self._dev is not None:
            self.close()
        # 模擬的是 SPI0 的兩個晶片選擇腳：/dev/spidev0.0（CE0）與 /dev/spidev0.1（CE1）
        if bus != 0 or device not in (0, 1):
            raise FileNotFoundError(2, "No such file or directory")
        self._dev = (bus, device)
        _bridge.opened[self._dev] = _bridge.opened.get(self._dev, 0) + 1
        _bridge.call("spi_open", bus=bus, ce=device)

    def close(self):
        """關閉 SPI 裝置。"""
        if self._dev is None:
            return
        dev, self._dev = self._dev, None
        left = _bridge.opened.get(dev, 1) - 1
        if left > 0:
            _bridge.opened[dev] = left
        else:
            _bridge.opened.pop(dev, None)
        _bridge.call("spi_close", bus=dev[0], ce=dev[1])

    def fileno(self):
        """回傳一個代表這個裝置的數字（模擬值）。"""
        return -1 if self._dev is None else 100 + self._dev[0] * 2 + self._dev[1]

    def _check(self):
        if self._dev is None:
            raise TypeError("I/O operation on closed file")

    def _transfer(self, values):
        self._check()
        tx = []
        for v in values:
            v = int(v)
            if not 0 <= v <= 255:
                raise OverflowError("Byte value out of range")
            tx.append(v)
        if not tx:
            return []
        if self.lsbfirst:
            tx = [_reverse_bits(b) for b in tx]
        reply = _bridge.call("spi_xfer", bus=self._dev[0], ce=self._dev[1], tx=tx)
        rx = reply.get("rx") if reply is not None else None
        if not isinstance(rx, list) or len(rx) != len(tx):
            rx = [0] * len(tx)
        if self.lsbfirst:
            rx = [_reverse_bits(b) for b in rx]
        return list(rx)

    def readbytes(self, length):
        """讀取 length 個位元組（送出的都是 0）。"""
        return self._transfer([0] * int(length))

    def writebytes(self, values):
        """送出位元組，不回傳收到的資料。"""
        self._transfer(values)

    def writebytes2(self, values):
        """送出位元組，不回傳收到的資料（可以傳 list 或 bytes）。"""
        self._transfer(values)

    def xfer(self, values, speed_hz=0, delay_usecs=0, bits_per_word=0):
        """送出位元組，回傳同時收到的位元組（list）。"""
        return self._transfer(values)

    def xfer2(self, values, speed_hz=0, delay_usecs=0, bits_per_word=0):
        """送出位元組，整個傳輸期間 CS 保持低電位，回傳收到的位元組（list）。"""
        return self._transfer(values)

    def xfer3(self, values, speed_hz=0, delay_usecs=0, bits_per_word=0):
        """與 xfer2 相同；真機上可以傳很長的資料。"""
        return self._transfer(values)


def _reverse_bits(b):
    return int("{:08b}".format(b)[::-1], 2)
