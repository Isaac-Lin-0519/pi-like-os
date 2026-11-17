"""
lgpio（pi-like-os 模擬版）

這個模組的名稱、常數與函式介面都跟真正的 lgpio 0.2.2.0 相同。
差別只在於：真機的 lgpio 會控制 /dev/gpiochip0，
這個版本則把腳位變化透過網路送到「虛擬麵包板」伺服器（sim），網頁上的元件就會跟著動。

gpiozero 會優先選用 lgpio，所以課堂程式完全不用改；
回到真正的樹莓派時，pip 裝到的就是真正的 lgpio。

連線方式：讀取環境變數 PISIM_BRIDGE（預設 sim:8765），每行一個 JSON 訊息。
連不上伺服器時程式仍會照常執行（只在本機記錄腳位狀態），並在畫面上提醒一次。

本模組只使用 Python 標準函式庫，不依賴任何 pip 套件。
真正的 lgpio 以 Unlicense（公有領域）釋出，這裡的常數與錯誤訊息沿用自它。
"""

import json
import os
import queue
import socket
import sys
import threading
import time
import traceback

LGPIO_PY_VERSION = 0x00020200

exceptions = True

# GPIO levels

OFF = 0
LOW = 0
CLEAR = 0

ON = 1
HIGH = 1
SET = 1

TIMEOUT = 2

GROUP_ALL = 0xffffffffffffffff

# GPIO line flags

SET_ACTIVE_LOW = 4
SET_OPEN_DRAIN = 8
SET_OPEN_SOURCE = 16
SET_PULL_UP = 32
SET_PULL_DOWN = 64
SET_PULL_NONE = 128

# GPIO event flags

RISING_EDGE = 1
FALLING_EDGE = 2
BOTH_EDGES = 3

# tx constants

TX_PWM = 0
TX_WAVE = 1

SPI_MODE_0 = 0
SPI_MODE_1 = 1
SPI_MODE_2 = 2
SPI_MODE_3 = 3

# lgpio error numbers

OKAY = 0
INIT_FAILED = -1
BAD_MICROS = -2
BAD_PATHNAME = -3
NO_HANDLE = -4
BAD_HANDLE = -5
BAD_SOCKET_PORT = -6
NOT_PERMITTED = -7
SOME_PERMITTED = -8
BAD_SCRIPT = -9
BAD_TX_TYPE = -10
GPIO_IN_USE = -11
BAD_PARAM_NUM = -12
DUP_TAG = -13
TOO_MANY_TAGS = -14
BAD_SCRIPT_CMD = -15
BAD_VAR_NUM = -16
NO_SCRIPT_ROOM = -17
NO_MEMORY = -18
SOCK_READ_FAILED = -19
SOCK_WRIT_FAILED = -20
TOO_MANY_PARAM = -21
SCRIPT_NOT_READY = -22
BAD_TAG = -23
BAD_MICS_DELAY = -24
BAD_MILS_DELAY = -25
I2C_OPEN_FAILED = -26
SERIAL_OPEN_FAILED = -27
SPI_OPEN_FAILED = -28
BAD_I2C_BUS = -29
BAD_I2C_ADDR = -30
BAD_SPI_CHANNEL = -31
BAD_I2C_FLAGS = -32
BAD_SPI_FLAGS = -33
BAD_SERIAL_FLAGS = -34
BAD_SPI_SPEED = -35
BAD_SERIAL_DEVICE = -36
BAD_SERIAL_SPEED = -37
BAD_FILE_PARAM = -38
BAD_I2C_PARAM = -39
BAD_SERIAL_PARAM = -40
I2C_WRITE_FAILED = -41
I2C_READ_FAILED = -42
BAD_SPI_COUNT = -43
SERIAL_WRITE_FAILED = -44
SERIAL_READ_FAILED = -45
SERIAL_READ_NO_DATA = -46
UNKNOWN_COMMAND = -47
SPI_XFER_FAILED = -48
BAD_POINTER = -49
MSG_TOOBIG = -50
BAD_MALLOC_MODE = -51
TOO_MANY_SEGS = -52
BAD_I2C_SEG = -53
BAD_SMBUS_CMD = -54
BAD_I2C_WLEN = -55
BAD_I2C_RLEN = -56
BAD_I2C_CMD = -57
FILE_OPEN_FAILED = -58
BAD_FILE_MODE = -59
BAD_FILE_FLAG = -60
BAD_FILE_READ = -61
BAD_FILE_WRITE = -62
FILE_NOT_ROPEN = -63
FILE_NOT_WOPEN = -64
BAD_FILE_SEEK = -65
NO_FILE_MATCH = -66
NO_FILE_ACCESS = -67
FILE_IS_A_DIR = -68
BAD_SHELL_STATUS = -69
BAD_SCRIPT_NAME = -70
CMD_INTERRUPTED = -71
BAD_EVENT_REQUEST = -72
BAD_GPIO_NUMBER = -73
BAD_GROUP_SIZE = -74
BAD_LINEINFO_IOCTL = -75
BAD_READ = -76
BAD_WRITE = -77
CANNOT_OPEN_CHIP = -78
GPIO_BUSY = -79
GPIO_NOT_ALLOCATED = -80
NOT_A_GPIOCHIP = -81
NOT_ENOUGH_MEMORY = -82
POLL_FAILED = -83
TOO_MANY_GPIOS = -84
UNEGPECTED_ERROR = -85
BAD_PWM_MICROS = -86
NOT_GROUP_LEADER = -87
SPI_IOCTL_FAILED = -88
BAD_GPIOCHIP = -89
BAD_CHIPINFO_IOCTL = -90
BAD_CONFIG_FILE = -91
BAD_CONFIG_VALUE = -92
NO_PERMISSIONS = -93
BAD_USERNAME = -94
BAD_SECRET = -95
TX_QUEUE_FULL = -96
BAD_CONFIG_ID = -97
BAD_DEBOUNCE_MICS = -98
BAD_WATCHDOG_MICS = -99
BAD_SERVO_FREQ = -100
BAD_SERVO_WIDTH = -101
BAD_PWM_FREQ = -102
BAD_PWM_DUTY = -103
GPIO_NOT_AN_OUTPUT = -104
INVALID_GROUP_ALERT = -105

# 錯誤訊息（與真正 lgpio 的 lgErr.c 相同）
_ERROR_TEXT = {
   -1: "initialisation failed",
   -2: "micros not 0-999999",
   -3: "can not open pathname",
   -4: "no handle available",
   -5: "unknown handle",
   -6: "socket port not 1024-32000",
   -7: "GPIO operation not permitted",
   -8: "one or more GPIO not permitted",
   -9: "invalid script",
   -10: "bad tx type for GPIO and group",
   -11: "GPIO already in use",
   -12: "script parameter id not 0-9",
   -13: "script has duplicate tag",
   -14: "script has too many tags",
   -15: "illegal script command",
   -16: "script variable id not 0-149",
   -17: "no more room for scripts",
   -18: "can not allocate temporary memory",
   -19: "socket read failed",
   -20: "socket write failed",
   -21: "too many script parameters (> 10)",
   -22: "script initialising",
   -23: "script has unresolved tag",
   -24: "bad MICS delay (too large)",
   -25: "bad MILS delay (too large)",
   -26: "can not open I2C device",
   -27: "can not open serial device",
   -28: "can not open SPI device",
   -29: "bad I2C bus",
   -30: "bad I2C address",
   -31: "bad SPI channel",
   -32: "bad I2C open flags",
   -33: "bad SPI open flags",
   -34: "bad serial open flags",
   -35: "bad SPI speed",
   -36: "bad serial device name",
   -37: "bad serial baud rate",
   -38: "bad file parameter",
   -39: "bad I2C parameter",
   -40: "bad serial parameter",
   -41: "i2c write failed",
   -42: "i2c read failed",
   -43: "bad SPI count",
   -44: "ser write failed",
   -45: "ser read failed",
   -46: "ser read no data available",
   -47: "unknown command",
   -48: "spi xfer/read/write failed",
   -49: "bad (NULL) pointer",
   -50: "socket/pipe message too big",
   -51: "bad memory allocation mode",
   -52: "too many I2C transaction segments",
   -53: "an I2C transaction segment failed",
   -54: "SMBus command not supported by driver",
   -55: "bad I2C write length",
   -56: "bad I2C read length",
   -57: "bad I2C command",
   -58: "file open failed",
   -59: "bad file mode",
   -60: "bad file flag",
   -61: "bad file read",
   -62: "bad file write",
   -63: "file not open for read",
   -64: "file not open for write",
   -65: "bad file seek",
   -66: "no files match pattern",
   -67: "no permission to access file",
   -68: "file is a directory",
   -69: "bad shell return status",
   -70: "bad script name",
   -71: "Python socket command interrupted",
   -72: "bad event request",
   -73: "bad GPIO number",
   -74: "bad group size",
   -75: "bad lineinfo IOCTL",
   -76: "bad GPIO read",
   -77: "bad GPIO write",
   -78: "can not open gpiochip",
   -79: "GPIO busy",
   -80: "GPIO not allocated",
   -81: "not a gpiochip",
   -82: "not enough memory",
   -83: "GPIO poll failed",
   -84: "too many GPIO",
   -85: "unexpected error",
   -86: "bad PWM micros",
   -87: "GPIO not the group leader",
   -88: "SPI iOCTL failed",
   -89: "bad gpiochip",
   -90: "bad chipinfo IOCTL",
   -91: "bad configuration file",
   -92: "bad configuration value",
   -93: "no permission to perform action",
   -94: "bad user name",
   -95: "bad secret for user",
   -96: "TX queue full",
   -97: "bad configuration id",
   -98: "bad debounce microseconds",
   -99: "bad watchdog microseconds",
   -100: "bad servo frequency",
   -101: "bad servo pulsewidth",
   -102: "bad PWM frequency",
   -103: "bad PWM dutycycle",
   -104: "GPIO not set as an output",
   -105: "can not set a group to alert",
}


class error(Exception):
   """
   rgpio module exception
   """
   def __init__(self, value):
      self.value = value
   def __str__(self):
      return repr(self.value)


class pulse:
   """
   A class to store pulse information.
   """
   def __init__(self, group_bits, group_mask, pulse_delay):
      self.group_bits = group_bits
      self.group_mask = group_mask
      self.pulse_delay = pulse_delay


def u2i(uint32):
   """
   Converts a 32 bit unsigned number to signed.
   """
   mask = (2 ** 32) - 1
   if uint32 & (1 << 31):
      v = uint32 | ~mask
   else:
      v = uint32 & mask
   return v


def _u2i(status):
   """
   狀態碼為負數表示錯誤；exceptions 為 True 時改為丟出 lgpio.error（與真機相同）。
   """
   v = u2i(status)
   if v < 0:
      if exceptions:
         raise error(error_text(v))
   return v


def error_text(errnum):
   """
   Returns a description of an error number.
   """
   return _ERROR_TEXT.get(errnum, "unknown error")


def get_module_version():
   """
   Returns the version number of the lgpio Python module as a dotted quad.
   """
   return "lgpio.py_{}.{}.{}.{}".format(
      (LGPIO_PY_VERSION>>24)&0xff, (LGPIO_PY_VERSION>>16)&0xff,
      (LGPIO_PY_VERSION>>8)&0xff, LGPIO_PY_VERSION&0xff)


# ==================================================================
# 模擬用的內部狀態
# ==================================================================

# Raspberry Pi 4 的 gpiochip0 有 58 條線（GPIO0～GPIO57），40 pin 排針上是 GPIO0～GPIO27
_NUM_LINES = 58
# GPIO2、GPIO3（I2C）板子上有實體的上拉電阻，沒接東西時讀到 1
_PHYSICAL_PULL_UP = {2, 3}
_LINE_FLAG_MASK = (SET_ACTIVE_LOW | SET_OPEN_DRAIN | SET_OPEN_SOURCE |
                   SET_PULL_UP | SET_PULL_DOWN | SET_PULL_NONE)

# 所有內部狀態與網路連線共用這一把鎖。
# 鎖只會由呼叫 lgpio 函式的執行緒，以及處理輸入事件的執行緒取得；
# 負責讀取網路的執行緒從不取得這把鎖，所以等待伺服器回覆時不會互相卡住。
_lock = threading.RLock()


class _Line:
   """一條已被 claim 的 GPIO 線"""
   def __init__(self, mode, flags, level=0):
      self.mode = mode          # 'input' / 'output' / 'alert'
      self.flags = flags & _LINE_FLAG_MASK
      self.level = level        # 實體電位（0 或 1）
      self.pwm = None           # (頻率, 工作週期%)，沒有 PWM 時為 None
      self.edge = BOTH_EDGES
      self.debounce = 0
      self.watchdog = 0
      self.group = None         # 群組的帶頭 GPIO

   @property
   def active_low(self):
      return 1 if self.flags & SET_ACTIVE_LOW else 0


class _Chip:
   def __init__(self, number):
      self.number = number
      self.lines = {}           # gpio -> _Line
      self.groups = {}          # 帶頭 GPIO -> [gpio, ...]


_chips = {}                     # handle（低 16 位元）-> _Chip
_next_handle = 0
_callbacks = []


def _default_level(gpio, flags):
   """沒有接任何東西時，輸入腳讀到的電位"""
   if flags & SET_PULL_UP:
      return 1
   if flags & SET_PULL_DOWN:
      return 0
   return 1 if gpio in _PHYSICAL_PULL_UP else 0


def _chip(handle):
   chip = _chips.get(handle & 0xffff)
   if chip is None:
      _u2i(BAD_HANDLE)
   return chip


def _check_gpio(gpio):
   if not isinstance(gpio, int) or not 0 <= gpio < _NUM_LINES:
      _u2i(BAD_GPIO_NUMBER)


def _line(handle, gpio):
   chip = _chip(handle)
   _check_gpio(gpio)
   line = chip.lines.get(gpio)
   if line is None:
      _u2i(GPIO_NOT_ALLOCATED)
   return chip, line


# ==================================================================
# 與虛擬麵包板伺服器的連線
# ==================================================================

class _Bridge:
   RETRY_SECONDS = 2.0
   REPLY_TIMEOUT = 2.0

   def __init__(self, address):
      host, _, port = address.rpartition(":")
      self.address = (host or "sim", int(port))
      self.sock = None
      self.replies = None
      self.next_id = 1
      self.last_try = -1e9
      self.warned = False
      self.events = queue.Queue()
      threading.Thread(target=self._dispatch, name="lgpio-events",
                       daemon=True).start()

   def call(self, op, **fields):
      """
      送出一個請求並等待回覆。
      連不上伺服器時回傳 None，由呼叫端自行在本機模擬。
      （呼叫前必須已經持有 _lock）
      """
      if self.sock is None and not self._connect():
         return None
      try:
         return self._request(dict(fields, op=op))
      except OSError:
         self._drop()
         return None

   # ---- 內部 ----

   def _connect(self):
      now = time.monotonic()
      if now - self.last_try < self.RETRY_SECONDS:
         return False
      self.last_try = now
      try:
         sock = socket.create_connection(self.address, timeout=0.5)
      except OSError:
         if not self.warned:
            self.warned = True
            sys.stderr.write(
               "[pi-like-os] 連不到虛擬麵包板（{}:{}），程式會照常執行，"
               "但網頁上看不到腳位變化。\n".format(*self.address))
         return False
      sock.settimeout(None)
      sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
      self.sock = sock
      self.replies = queue.Queue()
      threading.Thread(target=self._reader, args=(sock, self.replies),
                       name="lgpio-bridge", daemon=True).start()
      try:
         self._request({"op": "hello", "pid": os.getpid(), "argv": sys.argv})
         self._resync()
      except OSError:
         self._drop()
         return False
      if self.warned:
         self.warned = False
         sys.stderr.write("[pi-like-os] 已連上虛擬麵包板。\n")
      return True

   def _resync(self):
      """（重新）連上時，把目前持有的腳位狀態告訴伺服器"""
      for chip in _chips.values():
         for gpio, line in chip.lines.items():
            self._request({"op": "claim", "chip": chip.number, "gpio": gpio,
                           "mode": line.mode, "flags": line.flags,
                           "level": line.level})
            if line.pwm:
               self._request({"op": "pwm", "chip": chip.number, "gpio": gpio,
                              "freq": line.pwm[0], "duty": line.pwm[1]})
      for spi in _spis.values():
         self._request({"op": "spi_open", "bus": spi.bus, "ce": spi.ce})

   def _request(self, msg):
      msg["id"] = self.next_id
      self.next_id += 1
      self.sock.sendall((json.dumps(msg) + "\n").encode("utf-8"))
      while True:
         try:
            reply = self.replies.get(timeout=self.REPLY_TIMEOUT)
         except queue.Empty:
            raise OSError("虛擬麵包板沒有回應")
         if reply is None:
            raise OSError("連線中斷")
         if reply.get("id") == msg["id"]:
            return reply
         # 其他編號的回覆是先前被 Ctrl+C 打斷的請求，略過

   def _drop(self):
      sock, self.sock = self.sock, None
      if sock is not None:
         try:
            sock.close()
         except OSError:
            pass
      if not self.warned:
         self.warned = True
         sys.stderr.write("[pi-like-os] 與虛擬麵包板的連線中斷，會自動重新連線。\n")

   def _reader(self, sock, replies):
      try:
         with sock.makefile("r", encoding="utf-8") as f:
            for raw in f:
               msg = json.loads(raw)
               if "id" in msg:
                  replies.put(msg)
               else:
                  self.events.put(msg)
      except (OSError, ValueError):
         pass
      replies.put(None)
      self._reconnect_later(sock)

   def _reconnect_later(self, lost):
      """
      連線中斷（例如虛擬麵包板伺服器重開）時，在背景自動重新連線並補回腳位狀態。
      這樣就算程式正在 sleep、沒有呼叫 lgpio，網頁上的狀態也會恢復。
      """
      def retry():
         while True:
            time.sleep(self.RETRY_SECONDS)
            with _lock:
               if self.sock is lost:
                  self._drop()
               elif self.sock is not None:
                  return            # 已經被其他呼叫重新連上了
               if self._connect():
                  return
      threading.Thread(target=retry, name="lgpio-reconnect", daemon=True).start()

   def _dispatch(self):
      # 這個執行緒在模組載入途中就啟動了，要先等到事件再去找 _on_event（那時它已經定義好）
      while True:
         msg = self.events.get()
         try:
            _on_event(msg)
         except Exception:
            # 通常是使用者的 when_pressed 等回呼函式出錯；印出錯誤後繼續處理之後的事件
            traceback.print_exc()


_bridge = _Bridge(os.environ.get("PISIM_BRIDGE", "sim:8765"))


def _send(op, chip, gpio=None, **fields):
   """把動作送到伺服器；伺服器回報錯誤時丟出 lgpio.error"""
   if gpio is not None:
      fields["gpio"] = gpio
   reply = _bridge.call(op, chip=chip.number, **fields)
   if reply is not None and reply.get("err"):
      _u2i(reply["err"])
   return reply


def _on_event(msg):
   """伺服器通知：網頁上的元件（按鈕等）改變了某支輸入腳的電位"""
   if msg.get("ev") != "level":
      return
   chip_no, gpio, level = msg.get("chip", 0), msg["gpio"], 1 if msg["level"] else 0
   fire = []
   with _lock:
      for chip in _chips.values():
         if chip.number != chip_no:
            continue
         line = chip.lines.get(gpio)
         if line is None or line.mode == "output" or line.level == level:
            continue
         line.level = level
         if line.mode == "alert":
            if (level and line.edge & RISING_EDGE) or (not level and line.edge & FALLING_EDGE):
               fire.append(level ^ line.active_low)
   if fire:
      tick = time.monotonic_ns()
      for cb in list(_callbacks):
         if cb.chip == chip_no and cb.gpio == gpio:
            for lvl in fire:
               cb.func(chip_no, gpio, lvl, tick)


def _claim(handle, gpio, mode, lFlags, level=0, edge=BOTH_EDGES):
   with _lock:
      chip = _chip(handle)
      _check_gpio(gpio)
      flags = lFlags & _LINE_FLAG_MASK
      active_low = 1 if flags & SET_ACTIVE_LOW else 0
      if mode == "output":
         physical = (1 if level else 0) ^ active_low
      else:
         old = chip.lines.get(gpio)
         physical = old.level if old is not None and old.mode != "output" else _default_level(gpio, flags)
      reply = _send("claim", chip, gpio, mode=mode, flags=flags, level=physical)
      if reply is not None and mode != "output":
         physical = 1 if reply.get("level") else 0
      line = _Line(mode, flags, physical)
      line.edge = edge
      old = chip.lines.get(gpio)
      if old is not None:
         line.debounce, line.watchdog, line.group = old.debounce, old.watchdog, old.group
      chip.lines[gpio] = line
      return _u2i(OKAY)


# ==================================================================
# GPIO
# ==================================================================

def gpiochip_open(gpiochip):
   """
   This returns a handle to a gpiochip device.
   """
   global _next_handle
   with _lock:
      # Raspberry Pi 4 只有 gpiochip0 接到 40 pin 排針
      if gpiochip != 0:
         return _u2i(CANNOT_OPEN_CHIP)
      h = _next_handle
      _next_handle += 1
      chip = _Chip(gpiochip)
      _chips[h] = chip
      _send("open", chip)
      return _u2i(h | (gpiochip << 16))


def gpiochip_close(handle):
   """
   This closes a gpiochip device.
   """
   with _lock:
      chip = _chip(handle)
      _send("close", chip, gpios=list(chip.lines))
      del _chips[handle & 0xffff]
      return _u2i(OKAY)


def gpio_get_chip_info(handle):
   """
   This returns information about a gpiochip.
   """
   with _lock:
      chip = _chip(handle)
      return [OKAY, _NUM_LINES, "gpiochip{}".format(chip.number), "pinctrl-bcm2711"]


def gpio_get_line_info(handle, gpio):
   """
   This returns information about a GPIO.
   """
   with _lock:
      chip = _chip(handle)
      _check_gpio(gpio)
      line = chip.lines.get(gpio)
      flags = 0 if line is None else (gpio_get_mode(handle, gpio) & 0xff)
      user = "" if line is None else "lg"
      return [OKAY, gpio, flags, "GPIO{}".format(gpio), user]


def gpio_get_mode(handle, gpio):
   """
   This returns the mode of a GPIO.
   """
   with _lock:
      chip = _chip(handle)
      _check_gpio(gpio)
      line = chip.lines.get(gpio)
      if line is None:
         return 1 << 16                     # Kernel: Input
      mode = 1 | line.flags                 # Kernel: In use + line flags
      if line.mode == "output":
         mode |= 2 | 512                    # Kernel: Output, LG: Output
      else:
         mode |= (1 << 16) | 256            # Kernel: Input, LG: Input
         if line.mode == "alert":
            mode |= 1024                    # LG: Alert
            if line.edge & RISING_EDGE:
               mode |= 1 << 17
            if line.edge & FALLING_EDGE:
               mode |= 1 << 18
      if line.group is not None:
         mode |= 2048                       # LG: Group
      return mode


def gpio_claim_input(handle, gpio, lFlags=0):
   """
   This claims a GPIO for input.
   """
   return _claim(handle, gpio, "input", lFlags)


def gpio_claim_output(handle, gpio, level=0, lFlags=0):
   """
   This claims a GPIO for output.
   """
   return _claim(handle, gpio, "output", lFlags, level=level)


def gpio_claim_alert(handle, gpio, eFlags, lFlags=0, notify_handle=None):
   """
   This claims a GPIO to be used as a source of alerts on level changes.
   """
   if eFlags not in (RISING_EDGE, FALLING_EDGE, BOTH_EDGES):
      return _u2i(BAD_EVENT_REQUEST)
   return _claim(handle, gpio, "alert", lFlags, edge=eFlags)


def gpio_free(handle, gpio):
   """
   This frees a GPIO.
   """
   with _lock:
      chip, line = _line(handle, gpio)
      _send("free", chip, gpio)
      del chip.lines[gpio]
      return _u2i(OKAY)


def gpio_read(handle, gpio):
   """
   This returns the level of a GPIO.
   """
   with _lock:
      chip, line = _line(handle, gpio)
      return line.level ^ line.active_low


def gpio_write(handle, gpio, level):
   """
   This sets the GPIO level.
   """
   with _lock:
      chip, line = _line(handle, gpio)
      if line.mode != "output":
         return _u2i(GPIO_NOT_AN_OUTPUT)
      physical = (1 if level else 0) ^ line.active_low
      _send("write", chip, gpio, level=physical)
      line.level = physical
      line.pwm = None
      return _u2i(OKAY)


def group_claim_input(handle, gpio, lFlags=0):
   """
   This claims a group of GPIO for inputs.
   """
   with _lock:
      if not gpio:
         return _u2i(BAD_GROUP_SIZE)
      for g in gpio:
         gpio_claim_input(handle, g, lFlags)
      chip = _chip(handle)
      chip.groups[gpio[0]] = list(gpio)
      for g in gpio:
         chip.lines[g].group = gpio[0]
      return _u2i(OKAY)


def group_claim_output(handle, gpio, levels=[0], lFlags=0):
   """
   This claims a group of GPIO for outputs.
   """
   with _lock:
      if not gpio:
         return _u2i(BAD_GROUP_SIZE)
      for i, g in enumerate(gpio):
         level = levels[i] if i < len(levels) else 0
         gpio_claim_output(handle, g, level, lFlags)
      chip = _chip(handle)
      chip.groups[gpio[0]] = list(gpio)
      for g in gpio:
         chip.lines[g].group = gpio[0]
      return _u2i(OKAY)


def _group(handle, gpio):
   chip = _chip(handle)
   members = chip.groups.get(gpio)
   if members is None:
      _u2i(NOT_GROUP_LEADER)
   return chip, members


def group_free(handle, gpio):
   """
   This frees all the GPIO associated with a group.
   """
   with _lock:
      chip, members = _group(handle, gpio)
      for g in members:
         gpio_free(handle, g)
      del chip.groups[gpio]
      return _u2i(OKAY)


def group_read(handle, gpio):
   """
   This returns the levels read from a group.
   """
   with _lock:
      chip, members = _group(handle, gpio)
      bits = 0
      for i, g in enumerate(members):
         if gpio_read(handle, g):
            bits |= 1 << i
      return (len(members), bits)


def group_write(handle, gpio, group_bits, group_mask=GROUP_ALL):
   """
   This sets the levels of an output group.
   """
   with _lock:
      chip, members = _group(handle, gpio)
      for i, g in enumerate(members):
         if group_mask & (1 << i):
            gpio_write(handle, g, (group_bits >> i) & 1)
      return _u2i(OKAY)


def tx_pwm(handle, gpio,
   pwm_frequency, pwm_duty_cycle, pulse_offset=0, pulse_cycles=0):
   """
   This starts software timed PWM on an output GPIO.
   """
   with _lock:
      chip, line = _line(handle, gpio)
      if line.mode != "output":
         return _u2i(GPIO_NOT_AN_OUTPUT)
      if pwm_frequency == 0:
         _send("pwm", chip, gpio, freq=0, duty=0)
         line.pwm = None
         line.level = 0
         return 1
      if not 0.1 <= pwm_frequency <= 10000:
         return _u2i(BAD_PWM_FREQ)
      if not 0 <= pwm_duty_cycle <= 100:
         return _u2i(BAD_PWM_DUTY)
      _send("pwm", chip, gpio, freq=pwm_frequency, duty=pwm_duty_cycle)
      line.pwm = (pwm_frequency, pwm_duty_cycle)
      line.level = 1 if pwm_duty_cycle >= 50 else 0
      return 1


def tx_pulse(handle, gpio,
   pulse_on, pulse_off, pulse_offset=0, pulse_cycles=0):
   """
   This starts software timed pulses on an output GPIO.
   """
   period = pulse_on + pulse_off
   if pulse_on == 0 and pulse_off == 0:
      return tx_pwm(handle, gpio, 0, 0)
   if pulse_on < 0 or pulse_off < 0:
      return _u2i(BAD_PWM_MICROS)
   return tx_pwm(handle, gpio, 1e6 / period, 100.0 * pulse_on / period)


def tx_servo(handle, gpio, pulse_width,
   servo_frequency=50, pulse_offset=0, pulse_cycles=0):
   """
   This starts software timed servo pulses on an output GPIO.
   """
   if pulse_width == 0:
      return tx_pwm(handle, gpio, 0, 0)
   if not 500 <= pulse_width <= 2500:
      return _u2i(BAD_SERVO_WIDTH)
   if not 40 <= servo_frequency <= 500:
      return _u2i(BAD_SERVO_FREQ)
   return tx_pwm(handle, gpio, servo_frequency,
                 pulse_width * servo_frequency / 1e4)


def tx_wave(handle, gpio, pulses):
   """
   This starts a wave on a group of output GPIO.
   """
   return _unsupported("tx_wave")


def tx_busy(handle, gpio, kind):
   """
   This returns true if transmissions of the specified kind
   are active on the GPIO or group.
   """
   with _lock:
      chip, line = _line(handle, gpio)
      return 1 if (kind == TX_PWM and line.pwm) else 0


def tx_room(handle, gpio, kind):
   """
   This returns the number of slots there are to queue further
   transmissions of the specified kind on a GPIO or group.
   """
   with _lock:
      _line(handle, gpio)
      return 1


def gpio_set_debounce_micros(handle, gpio, debounce_micros):
   """
   This sets the debounce time for a GPIO.
   """
   with _lock:
      chip, line = _line(handle, gpio)
      if not 0 <= debounce_micros <= 5000000:
         return _u2i(BAD_DEBOUNCE_MICS)
      # 網頁上的按鈕不會彈跳，所以只記錄設定值
      line.debounce = debounce_micros
      return _u2i(OKAY)


def gpio_set_watchdog_micros(handle, gpio, watchdog_micros):
   """
   This sets the watchdog time for a GPIO.
   """
   with _lock:
      chip, line = _line(handle, gpio)
      if not 0 <= watchdog_micros <= 300000000:
         return _u2i(BAD_WATCHDOG_MICS)
      line.watchdog = watchdog_micros
      return _u2i(OKAY)


class _callback_ADT:
   """
   A class to hold callback information.
   """
   def __init__(self, gpiochip, gpio, edge, func):
      self.chip = gpiochip
      self.gpio = gpio
      self.edge = edge
      self.func = func


class _callback:
   """
   A class to provide GPIO level change callbacks.
   """
   def __init__(self, chip, gpio, edge=RISING_EDGE, func=None):
      self.count = 0
      self._reset = False
      if func is None:
         func = self._tally
      self.callb = _callback_ADT(chip, gpio, edge, func)
      _callbacks.append(self.callb)

   def cancel(self):
      """
      Cancels a callback by removing it from the notification thread.
      """
      if self.callb in _callbacks:
         _callbacks.remove(self.callb)

   def _tally(self, chip, gpio, level, tick):
      if self._reset:
         self._reset = False
         self.count = 0
      self.count += 1

   def tally(self):
      return self.count

   def reset_tally(self):
      self._reset = True
      self.count = 0


def callback(handle, gpio, edge=RISING_EDGE, func=None):
   """
   Calls a user supplied function (a callback) whenever the
   specified GPIO edge is detected.
   """
   return _callback(handle >> 16, gpio, edge, func)


# ==================================================================
# 通知（模擬版由伺服器直接推送，不需要真的開管線）
# ==================================================================

def notify_open():
   return 0


def notify_pause(handle):
   return _u2i(OKAY)


def notify_resume(handle):
   return _u2i(OKAY)


def notify_close(handle):
   return _u2i(OKAY)


# ==================================================================
# SPI（給 MCP3008 等 SPI 晶片用）
#
# Raspberry Pi 4 的 SPI0：GPIO11＝SCLK、GPIO10＝MOSI、GPIO9＝MISO、GPIO8＝CE0、GPIO7＝CE1。
# 傳輸的資料送到虛擬麵包板，由網頁上接好的晶片（例如 MCP3008）回覆。
# gpiozero 的 MCP3008 會自動使用這裡的 spi_open／spi_xfer。
# ==================================================================

class _Spi:
   def __init__(self, bus, ce, baud, flags):
      self.bus, self.ce, self.baud, self.flags = bus, ce, baud, flags


_spis = {}                      # handle -> _Spi
_next_spi_handle = 0


def _spi(handle):
   spi = _spis.get(handle)
   if spi is None:
      _u2i(BAD_HANDLE)
   return spi


def _tx_bytes(data):
   if isinstance(data, str):
      data = data.encode("latin-1")
   return [int(b) & 0xff for b in data]


def _spi_transfer(spi, tx):
   """全雙工傳輸：送出 tx，回傳同樣長度的接收資料（連不上虛擬麵包板時收到的都是 0）"""
   reply = _bridge.call("spi_xfer", bus=spi.bus, ce=spi.ce, tx=tx)
   if reply is not None and reply.get("err"):
      _u2i(reply["err"])
   rx = reply.get("rx") if reply is not None else None
   if not isinstance(rx, list) or len(rx) != len(tx):
      rx = [0] * len(tx)
   return bytearray(rx)


def spi_open(spi_device, spi_channel, baud, spi_flags=0):
   """
   Returns a handle for the SPI device on the channel.

   spi_device:= >= 0.
   spi_channel:= >= 0.
   baud:= speed to use.
   spi_flags:= see below.
   """
   global _next_spi_handle
   with _lock:
      # 模擬的是 SPI0（/dev/spidev0.0、/dev/spidev0.1）
      if spi_device != 0:
         return _u2i(SPI_OPEN_FAILED)
      if spi_channel not in (0, 1):
         return _u2i(BAD_SPI_CHANNEL)
      if not 0 < baud <= 125000000:
         return _u2i(BAD_SPI_SPEED)
      h = _next_spi_handle
      _next_spi_handle += 1
      spi = _Spi(spi_device, spi_channel, baud, spi_flags)
      _spis[h] = spi
      _bridge.call("spi_open", bus=spi.bus, ce=spi.ce)
      return _u2i(h)


def spi_close(handle):
   """
   This functions closes the SPI device identified by the handle.
   """
   with _lock:
      spi = _spi(handle)
      del _spis[handle]
      _bridge.call("spi_close", bus=spi.bus, ce=spi.ce)
      return _u2i(OKAY)


def spi_read(handle, count):
   """
   Reads count bytes of data from the SPI device.

   Returns a tuple (count, data).
   """
   with _lock:
      spi = _spi(handle)
      if count <= 0:
         return _u2i(BAD_SPI_COUNT), bytearray()
      rx = _spi_transfer(spi, [0] * count)
      return len(rx), rx


def spi_write(handle, data):
   """
   Writes the data bytes to the SPI device.

   Returns the number of bytes written.
   """
   with _lock:
      spi = _spi(handle)
      tx = _tx_bytes(data)
      if not tx:
         return _u2i(BAD_SPI_COUNT)
      _spi_transfer(spi, tx)
      return _u2i(len(tx))


def spi_xfer(handle, tx_data):
   """
   Writes the data bytes to the SPI device,
   returning the data bytes read from the device.

   Returns a tuple (count, data).
   """
   with _lock:
      spi = _spi(handle)
      tx = _tx_bytes(tx_data)
      if not tx:
         return _u2i(BAD_SPI_COUNT), bytearray()
      rx = _spi_transfer(spi, tx)
      return len(rx), rx


# ==================================================================
# 尚未支援的功能（I2C、序列埠）
# 之後的階段會加入感測器元件；目前呼叫時會清楚告知
# ==================================================================

def _unsupported(name):
   raise error("模擬環境尚未支援 lgpio.{}()".format(name))


def _make_unsupported(name):
   def func(*args, **kwargs):
      return _unsupported(name)
   func.__name__ = name
   func.__doc__ = "（模擬環境尚未支援）"
   return func


for _name in (
   "i2c_open", "i2c_close", "i2c_write_quick", "i2c_write_byte",
   "i2c_read_byte", "i2c_write_byte_data", "i2c_write_word_data",
   "i2c_read_byte_data", "i2c_read_word_data", "i2c_process_call",
   "i2c_write_block_data", "i2c_read_block_data", "i2c_block_process_call",
   "i2c_write_i2c_block_data", "i2c_read_i2c_block_data", "i2c_read_device",
   "i2c_write_device", "i2c_zip",
   "serial_open", "serial_close", "serial_read_byte", "serial_write_byte",
   "serial_read", "serial_write", "serial_data_available",
):
   globals()[_name] = _make_unsupported(_name)
del _name


# ==================================================================
# 其他
# ==================================================================

_internals = {0: 0, 1: 0}


def get_internal(config_id):
   """
   Returns the value of a configuration item.
   """
   if config_id not in _internals:
      return [BAD_CONFIG_ID, 0]
   return [OKAY, _internals[config_id]]


def set_internal(config_id, config_value):
   """
   Sets the value of a configuration item.
   """
   if config_id not in _internals:
      return _u2i(BAD_CONFIG_ID)
   _internals[config_id] = config_value
   return _u2i(OKAY)


def xref():
   """
   （真機的 lgpio 用這個函式顯示說明文件索引，模擬版不提供）
   """
   pass
