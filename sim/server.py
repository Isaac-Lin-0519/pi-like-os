"""
pi-like-os 虛擬麵包板伺服器（sim）

負責三件事：
  1. 腳位橋接（TCP 8765）：容器裡的模擬版 lgpio 連到這裡，回報腳位的設定與電位變化
  2. 網頁（HTTP 8000）：提供虛擬麵包板網頁，並用 WebSocket（/ws）即時推送腳位狀態；
     網頁上的輸入元件（按鈕等）也經由 WebSocket 把電位送回容器
  3. pip 套件來源（HTTP 8000 的 /simple/）：
     lgpio、spidev 由這裡提供模擬版，其他套件一律轉給 PyPI

SPI：程式（gpiozero 的 MCP3008 或 spidev）送出的資料，由這裡模擬 MCP3008 晶片逐位元回覆；
     各通道的電壓由網頁解電路後送過來（{"type": "adc", "devices": {"0": {...}}}）。

lgpio ↔ 伺服器的訊息格式（每行一個 JSON）：
  請求：{"id": 1, "op": "claim", "chip": 0, "gpio": 18, "mode": "output", "flags": 0, "level": 0}
  回覆：{"id": 1, "ok": true, "level": 0}   或   {"id": 1, "err": -79}
  事件：{"ev": "level", "chip": 0, "gpio": 17, "level": 1}   （伺服器 → lgpio，輸入腳電位改變）
"""

import asyncio
import hashlib
import html
import itertools
import json
import logging
import os
import random
import re
import time
from pathlib import Path

from aiohttp import ClientError, ClientSession, ClientTimeout, WSMsgType, web

HTTP_PORT = int(os.environ.get("PISIM_HTTP_PORT", "8000"))
BRIDGE_PORT = int(os.environ.get("PISIM_BRIDGE_PORT", "8765"))
UPSTREAM_INDEX = os.environ.get("PISIM_UPSTREAM_INDEX", "https://pypi.org/simple").rstrip("/")
WHEEL_DIR = Path(os.environ.get("PISIM_WHEEL_DIR", "/opt/pisim/wheels"))
STATIC_DIR = Path(__file__).resolve().parent / "static"
# 麵包板上的電路存在這裡（docker-compose 用 volume 保存，重開也不會消失）
DATA_DIR = Path(os.environ.get("PISIM_DATA_DIR", "/data"))
CIRCUIT_FILE = DATA_DIR / "circuit.json"

# 由本機提供的套件（其他套件轉給 PyPI）
LOCAL_PACKAGES = {"lgpio", "spidev"}

# lgpio 錯誤碼
GPIO_BUSY = -79
GPIO_NOT_ALLOCATED = -80
GPIO_NOT_AN_OUTPUT = -104
BAD_GPIO_NUMBER = -73

SET_PULL_UP = 32
SET_PULL_DOWN = 64
PHYSICAL_PULL_UP = {2, 3}
NUM_LINES = 58

# SPI0 用到的腳位：SCLK、MOSI、MISO，以及兩支晶片選擇腳（CE0、CE1）
SPI0_PINS = (11, 10, 9)
SPI0_CE = {0: 8, 1: 7}
SPI_OPEN_FAILED = -28
BAD_SPI_CHANNEL = -31

log = logging.getLogger("pisim")


# ==================================================================
# 板子狀態
# ==================================================================

class Board:
    def __init__(self):
        self.pins = {}          # gpio -> {"mode", "level", "flags", "pwm", "owner"}
        self.external = {}      # gpio -> 網頁設定的輸入電位
        self.programs = {}      # 連線編號 -> {"id", "pid", "argv", "writer"}
        self.browsers = set()
        self.circuit = load_circuit()
        self.spi = {}           # 連線編號 -> {(bus, ce): 開啟次數}
        self.adc = {}           # CE 編號 -> 網頁算出的 MCP3008 狀態 {"vref", "ch": [電壓或 None]}
        self.adc_noise = {}     # 浮接通道目前亂跳到的值
        self.adc_report = {}    # 上次通知網頁「程式讀了哪個通道」的時間
        self._ids = itertools.count(1)

    # ---- 查詢 ----

    def pin_view(self, gpio):
        p = self.pins.get(gpio)
        view = {"gpio": gpio, "mode": "free", "level": None, "pull": None,
                "pwm": None, "owner": None, "external": self.external.get(gpio)}
        if p is not None:
            view.update(mode=p["mode"], level=p["level"], pull=pull_name(p["flags"]),
                        pwm=p["pwm"], owner=p["owner"])
        elif gpio in self.spi_pins():
            view.update(mode="spi")
        return view

    def spi_pins(self):
        """目前被 SPI 使用中的腳位"""
        used = set()
        for opened in self.spi.values():
            for (bus, ce), n in opened.items():
                if n > 0 and bus == 0:
                    used.update(SPI0_PINS)
                    used.add(SPI0_CE[ce])
        return used

    def program_views(self):
        return [{"id": c["id"], "pid": c["pid"], "argv": c["argv"]}
                for c in self.programs.values()]

    def snapshot(self):
        return {"type": "snapshot", "time": time.time(),
                "pins": [self.pin_view(g) for g in range(28)],
                "programs": self.program_views(), "circuit": self.circuit}

    def input_level(self, gpio, flags):
        """
        輸入腳目前的電位：網頁有設定就用網頁的，否則依上拉／下拉決定。
        網頁會依「上拉／下拉／不拉」三種情況各算一次電位（{"up": 1, "down": 0, "none": 1}），
        這裡依程式實際的設定挑一個，程式改變上拉設定時才不會讀到過時的值。
        """
        ext = self.external.get(gpio)
        if isinstance(ext, dict):
            ext = ext.get(pull_name(flags))
        if ext is not None:
            return 1 if ext else 0
        if flags & SET_PULL_UP:
            return 1
        if flags & SET_PULL_DOWN:
            return 0
        return 1 if gpio in PHYSICAL_PULL_UP else 0

    # ---- 推送 ----

    def broadcast(self, message, exclude=None):
        data = json.dumps(message)
        for ws in list(self.browsers):
            if ws is exclude:
                continue
            if ws.closed:
                self.browsers.discard(ws)
                continue
            asyncio.ensure_future(ws.send_str(data))

    def pin_changed(self, gpio):
        self.broadcast({"type": "pin", "time": time.time(), "pin": self.pin_view(gpio)})

    def programs_changed(self):
        self.broadcast({"type": "programs", "programs": self.program_views()})

    def notify_owner(self, gpio):
        """輸入腳的電位改變時，通知持有這支腳的程式"""
        p = self.pins.get(gpio)
        if p is None or p["mode"] == "output":
            return False
        level = self.input_level(gpio, p["flags"])
        if level == p["level"]:
            return False
        p["level"] = level
        client = self.programs.get(p["owner"])
        if client is not None:
            client["writer"].write(
                (json.dumps({"ev": "level", "chip": 0, "gpio": gpio, "level": level}) + "\n").encode())
        self.pin_changed(gpio)
        return True

    # ---- 來自 lgpio 的請求 ----

    def handle(self, cid, msg):
        op = msg.get("op")
        gpio = msg.get("gpio")
        if op == "hello":
            self.programs[cid].update(pid=msg.get("pid"), argv=msg.get("argv") or [])
            self.programs_changed()
            return {"ok": True}
        if op == "open":
            return {"ok": True}
        if op == "close":
            self.release(cid)
            return {"ok": True}
        if op in ("spi_open", "spi_close", "spi_xfer"):
            return self.handle_spi(cid, op, msg)

        if not isinstance(gpio, int) or not 0 <= gpio < NUM_LINES:
            return {"err": BAD_GPIO_NUMBER}
        p = self.pins.get(gpio)

        if op == "claim":
            if p is not None and p["owner"] != cid:
                return {"err": GPIO_BUSY}
            mode, flags = msg.get("mode", "input"), msg.get("flags", 0)
            if mode == "output":
                level = 1 if msg.get("level") else 0
            else:
                level = self.input_level(gpio, flags)
            self.pins[gpio] = {"mode": mode, "level": level, "flags": flags,
                               "pwm": None, "owner": cid}
            self.pin_changed(gpio)
            return {"ok": True, "level": level}

        if p is None or p["owner"] != cid:
            return {"err": GPIO_NOT_ALLOCATED}

        if op == "free":
            del self.pins[gpio]
            self.pin_changed(gpio)
            return {"ok": True}
        if op == "write":
            if p["mode"] != "output":
                return {"err": GPIO_NOT_AN_OUTPUT}
            level = 1 if msg.get("level") else 0
            if p["level"] != level or p["pwm"] is not None:
                p["level"], p["pwm"] = level, None
                self.pin_changed(gpio)
            return {"ok": True}
        if op == "pwm":
            if p["mode"] != "output":
                return {"err": GPIO_NOT_AN_OUTPUT}
            freq, duty = msg.get("freq", 0), msg.get("duty", 0)
            if freq:
                p["pwm"] = [freq, duty]
                p["level"] = 1 if duty >= 50 else 0
            else:
                p["pwm"], p["level"] = None, 0
            self.pin_changed(gpio)
            return {"ok": True}
        return {"err": -47}         # unknown command

    def release(self, cid):
        """程式結束（或關閉 gpiochip）時，釋放它持有的所有腳位，就像 Linux 核心會做的一樣"""
        for gpio in [g for g, p in self.pins.items() if p["owner"] == cid]:
            del self.pins[gpio]
            self.pin_changed(gpio)

    def release_spi(self, cid):
        before = self.spi_pins()
        self.spi.pop(cid, None)
        for gpio in sorted(before - self.spi_pins()):
            self.pin_changed(gpio)

    # ---- SPI ----

    def handle_spi(self, cid, op, msg):
        bus, ce = msg.get("bus", 0), msg.get("ce", 0)
        if bus != 0:
            return {"err": SPI_OPEN_FAILED}
        if ce not in SPI0_CE:
            return {"err": BAD_SPI_CHANNEL}
        if op == "spi_xfer":
            tx = msg.get("tx")
            if not isinstance(tx, list):
                return {"err": -48}
            return {"ok": True, "rx": self.mcp3008_transfer(ce, tx)}
        before = self.spi_pins()
        opened = self.spi.setdefault(cid, {})
        if op == "spi_open":
            opened[(bus, ce)] = opened.get((bus, ce), 0) + 1
        else:
            opened[(bus, ce)] = max(0, opened.get((bus, ce), 0) - 1)
        after = self.spi_pins()
        for gpio in sorted(before ^ after):
            self.pin_changed(gpio)
        return {"ok": True}

    def adc_volts(self, ce, ch):
        """MCP3008 某個通道的輸入電壓；浮接（沒接東西）的通道讀值會慢慢亂飄，跟真的晶片一樣"""
        dev = self.adc.get(ce)
        vref = dev["vref"]
        v = dev["ch"][ch]
        if v is None:
            key = (ce, ch)
            v = self.adc_noise.get(key, random.uniform(0, vref))
            v = min(vref, max(0.0, v + random.uniform(-0.15, 0.15) * vref))
            self.adc_noise[key] = v
        return v

    def adc_code(self, ce, single, ch):
        """
        晶片轉換出來的 10 位元數值（0～1023）：數值 ＝ 1024 × 輸入電壓 ÷ VREF。
        晶片沒接好（沒電、SPI 線接錯）時沒有回應，MISO 被下拉，讀到的都是 0。
        """
        dev = self.adc.get(ce)
        if not dev:
            return None
        vref = dev["vref"]
        if single:
            v = self.adc_volts(ce, ch)
        else:
            # 差動模式：通道兩兩一組，D0 決定哪一支是正端
            pair = ch & 6
            plus, minus = (pair, pair + 1) if ch % 2 == 0 else (pair + 1, pair)
            v = self.adc_volts(ce, plus) - self.adc_volts(ce, minus)
        if vref <= 0.05:
            return 1023 if v > 0.01 else 0
        return max(0, min(1023, int(v / vref * 1024 + 1e-3)))

    def mcp3008_transfer(self, ce, tx):
        """
        依照 MCP3008 資料手冊的時序逐位元模擬（CS 在整次傳輸期間保持低電位）：
          DIN：等到起始位元 1，接著 4 個設定位元（SGL/DIFF、D2、D1、D0）
          DOUT：取樣 1 個時脈、空位元 0、10 位元結果（高位先），之後再以低位先送一次
        不管程式怎麼排位元組（spidev 常見的 [1, 0x80, 0] 或 gpiozero 的格式）都能正確回覆。
        """
        out, rx_bits = [], []
        state, cfg = "wait", []
        for byte in tx:
            byte = int(byte) & 0xff
            for i in range(7, -1, -1):
                bit = (byte >> i) & 1
                rx_bits.append(out.pop(0) if out else 0)
                if state == "wait":
                    if bit:
                        state, cfg = "config", []
                elif state == "config":
                    cfg.append(bit)
                    if len(cfg) == 4:
                        single, ch = cfg[0], cfg[1] * 4 + cfg[2] * 2 + cfg[3]
                        code = self.adc_code(ce, single, ch)
                        state = "output"
                        if code is not None:
                            out = ([0, 0] + [(code >> k) & 1 for k in range(9, -1, -1)]
                                   + [(code >> k) & 1 for k in range(1, 10)])
                            self.report_adc_read(ce, single, ch, code)
        rx = []
        for i in range(0, len(rx_bits), 8):
            value = 0
            for b in rx_bits[i:i + 8]:
                value = (value << 1) | b
            rx.append(value)
        return rx

    def report_adc_read(self, ce, single, ch, code):
        """讓網頁顯示「程式剛剛讀了哪個通道、讀到多少」（每個通道最多每 0.15 秒一次）"""
        key = (ce, single, ch)
        now = time.monotonic()
        if now - self.adc_report.get(key, 0) < 0.15:
            return
        self.adc_report[key] = now
        self.broadcast({"type": "adc_read", "time": time.time(), "ce": ce,
                        "single": bool(single), "ch": ch, "code": code})

    def set_adc(self, devices):
        """網頁送來的 MCP3008 狀態：{"0": {"vref": 3.3, "ch": [1.65, None, ...]}, "1": None}"""
        adc = {}
        for key, dev in (devices or {}).items():
            try:
                ce = int(key)
                vref = float(dev["vref"])
                ch = [None if v is None else float(v) for v in dev["ch"]][:8]
            except (TypeError, ValueError, KeyError):
                continue
            if ce in SPI0_CE and len(ch) == 8:
                adc[ce] = {"vref": vref, "ch": ch}
        self.adc = adc

    # ---- 來自網頁的輸入 ----

    def set_external(self, gpio, level):
        if level is None:
            self.external.pop(gpio, None)
        elif isinstance(level, dict):
            self.external[gpio] = {k: (None if level.get(k) is None else 1 if level.get(k) else 0)
                                   for k in ("up", "down", "none")}
        else:
            self.external[gpio] = 1 if level else 0
        if not self.notify_owner(gpio):
            self.pin_changed(gpio)


def load_circuit():
    try:
        return json.loads(CIRCUIT_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"version": 1, "parts": [], "wires": []}


def save_circuit(circuit):
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = CIRCUIT_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(circuit, ensure_ascii=False), encoding="utf-8")
        tmp.replace(CIRCUIT_FILE)
    except OSError as e:
        log.warning("無法儲存電路：%s", e)


def pull_name(flags):
    if flags & SET_PULL_UP:
        return "up"
    if flags & SET_PULL_DOWN:
        return "down"
    return "none"


board = Board()


# ==================================================================
# 1. 腳位橋接（lgpio 連線）
# ==================================================================

async def handle_lgpio(reader, writer):
    cid = next(board._ids)
    board.programs[cid] = {"id": cid, "pid": None, "argv": [], "writer": writer}
    peer = writer.get_extra_info("peername")
    log.info("程式 #%d 已連線（%s）", cid, peer)
    try:
        while True:
            raw = await reader.readline()
            if not raw:
                break
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            reply = board.handle(cid, msg)
            if "id" in msg:
                reply["id"] = msg["id"]
                writer.write((json.dumps(reply) + "\n").encode())
                await writer.drain()
    except (ConnectionError, asyncio.IncompleteReadError):
        pass
    finally:
        board.release(cid)
        board.release_spi(cid)
        board.programs.pop(cid, None)
        board.programs_changed()
        writer.close()
        log.info("程式 #%d 已結束", cid)


# ==================================================================
# 2. 網頁與 WebSocket
# ==================================================================

async def index(request):
    return web.FileResponse(STATIC_DIR / "index.html", headers={"Cache-Control": "no-cache"})


async def static_file(request):
    # 不讓瀏覽器快取，更新 image 後重新整理就能看到新版
    path = STATIC_DIR / request.match_info["name"]
    if path.parent != STATIC_DIR or not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Cache-Control": "no-cache"})


async def websocket(request):
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    board.browsers.add(ws)
    await ws.send_str(json.dumps(board.snapshot()))
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except ValueError:
                continue
            if data.get("type") == "set_input":
                gpio = data.get("gpio")
                if isinstance(gpio, int) and 0 <= gpio < NUM_LINES:
                    board.set_external(gpio, data.get("level"))
            elif data.get("type") == "adc" and isinstance(data.get("devices"), dict):
                board.set_adc(data["devices"])
            elif data.get("type") == "circuit" and isinstance(data.get("circuit"), dict):
                # 電路改變：存檔，並通知其他分頁
                board.circuit = data["circuit"]
                save_circuit(board.circuit)
                board.broadcast({"type": "circuit", "circuit": board.circuit}, exclude=ws)
    finally:
        board.browsers.discard(ws)
    return ws


# ==================================================================
# 3. pip 套件來源（PEP 503 Simple Repository）
# ==================================================================

def normalize(name):
    return re.sub(r"[-_.]+", "-", name).lower()


def local_files(project):
    for path in sorted(WHEEL_DIR.glob("*")):
        if normalize(path.name.split("-")[0]) == project:
            yield path


async def simple_root(request):
    links = "".join(f'<a href="/simple/{p}/">{p}</a><br/>\n' for p in sorted(LOCAL_PACKAGES))
    body = (f"<!DOCTYPE html><html><body>\n<h1>pi-like-os 本機套件</h1>\n{links}"
            f"<p>其他套件會轉給 {html.escape(UPSTREAM_INDEX)}</p>\n</body></html>\n")
    return web.Response(text=body, content_type="text/html")


async def simple_project(request):
    name = request.match_info["name"]
    project = normalize(name)
    if project != name:
        raise web.HTTPMovedPermanently(f"/simple/{project}/")
    if project in LOCAL_PACKAGES:
        links = []
        for path in local_files(project):
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            links.append(f'<a href="/packages/{path.name}#sha256={digest}" '
                         f'data-requires-python="&gt;=3.9">{path.name}</a><br/>')
        body = ("<!DOCTYPE html><html><head><meta name=\"pypi:repository-version\" content=\"1.0\">"
                f"</head><body>\n<h1>Links for {project}</h1>\n" + "\n".join(links) +
                "\n</body></html>\n")
        return web.Response(text=body, content_type="text/html")

    # 其他套件：轉給 PyPI。檔案下載網址是 files.pythonhosted.org 的完整網址，pip 會直接去下載
    headers = {"Accept": request.headers.get("Accept", "text/html"),
               "User-Agent": request.headers.get("User-Agent", "pi-like-os")}
    try:
        async with request.app["http"].get(f"{UPSTREAM_INDEX}/{project}/", headers=headers) as r:
            body = await r.read()
            out = {"Content-Type": r.headers.get("Content-Type", "text/html")}
            if "Cache-Control" in r.headers:
                out["Cache-Control"] = r.headers["Cache-Control"]
            return web.Response(status=r.status, body=body, headers=out)
    except (ClientError, asyncio.TimeoutError) as e:
        log.warning("無法連到 %s：%s", UPSTREAM_INDEX, e)
        return web.Response(status=502, text=f"pi-like-os：無法連到 {UPSTREAM_INDEX}（{e}）\n")


async def package_file(request):
    path = WHEEL_DIR / request.match_info["filename"]
    if path.parent != WHEEL_DIR or not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path)


async def simple_redirect(request):
    raise web.HTTPMovedPermanently(f"/simple/{request.match_info['name']}/")


# ==================================================================
# 啟動
# ==================================================================

async def on_startup(app):
    app["http"] = ClientSession(timeout=ClientTimeout(total=60))
    app["bridge"] = await asyncio.start_server(handle_lgpio, "0.0.0.0", BRIDGE_PORT)
    log.info("腳位橋接：TCP %d；網頁與 pip 套件來源：HTTP %d", BRIDGE_PORT, HTTP_PORT)


async def on_cleanup(app):
    app["bridge"].close()
    await app["http"].close()
    for ws in list(board.browsers):
        await ws.close()


def make_app():
    app = web.Application()
    app.router.add_get("/", index)
    app.router.add_get("/ws", websocket)
    app.router.add_get("/static/{name}", static_file)
    app.router.add_get("/simple/", simple_root)
    app.router.add_get("/simple/{name}/", simple_project)
    app.router.add_get("/simple/{name}", simple_redirect)
    app.router.add_get("/packages/{filename}", package_file)
    app.on_startup.append(on_startup)
    app.on_cleanup.append(on_cleanup)
    return app


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    web.run_app(make_app(), port=HTTP_PORT, print=None)
