// ==================================================================
// 電路求解器（節點電壓法）
//
// 輸入：電路（元件、杜邦線）與板子上各 GPIO 的狀態
// 輸出：每個節點的電壓、每個元件的電流、LED 亮度、輸入腳讀到的電位，以及電路提示
//
// 這個檔案只做計算、不碰畫面，可以直接用 node 測試。
//
// 模型（刻意簡化，夠練習用就好）：
//   電阻        V = I × R
//   LED         順向電壓 Vf（紅約 2.0V）加上一點內阻；反向不導通
//   GPIO 輸出   3.3V 或 0V，串聯約 30Ω 的內阻
//   GPIO 輸入   高阻抗；有上拉／下拉時是 50kΩ 接到 3.3V／0V
//   3V3、5V     接近理想的電源（內阻 0.1Ω）
//   按鈕        按下時導通（0.05Ω），放開時斷路
//   可變電阻    兩個串聯的電阻，比例由旋鈕位置決定（中間腳＝滑動端）
//   RGB LED     三顆 LED 共用一支腳（共陰極或共陽極）
//   MCP3008     類比輸入是高阻抗（不影響電路）；量到的電壓由伺服器用 SPI 回覆給程式
//   杜邦線      理想導線
// ==================================================================

import { t } from "./i18n.js";

export const V_GPIO = 3.3;
export const R_GPIO = 30;          // GPIO 輸出內阻（Ω）
export const R_PULL = 50000;       // 內建上拉／下拉電阻（Ω）
export const R_SUPPLY = 0.1;       // 3V3、5V 電源內阻（Ω）
export const R_LED = 10;           // LED 導通時的內阻（Ω）
export const R_BUTTON = 0.05;      // 按鈕按下時的電阻（Ω）
export const GMIN = 1e-12;         // 每個節點對地的極小電導，避免沒接東西的節點讓矩陣無解
export const GPIO_MAX_MA = 16;     // GPIO 建議的最大電流
export const LED_MAX_MA = 20;      // LED 額定電流
export const V_HIGH = 1.65;        // 輸入腳判斷為高電位的門檻
export const R_POT_MIN = 1;        // 可變電阻轉到底時殘留的電阻（Ω）

// LED 顏色與順向電壓（顏色名稱用 colorName() 取得目前語言的寫法）
export const LED_COLORS = {
  red:    { vf: 2.0, rgb: "#ff2a1f" },
  yellow: { vf: 2.1, rgb: "#ffd21f" },
  green:  { vf: 2.2, rgb: "#2fe05a" },
  blue:   { vf: 3.0, rgb: "#3b8bff" },
  white:  { vf: 3.0, rgb: "#f4f7ff" },
};
export const colorName = (color) => t(`color.${color}`);

// RGB LED（4 支腳）：紅、共同腳（最長）、綠、藍
export const RGB_CHANNELS = [
  { key: "r", color: "red", vf: 2.0, pin: 0, rgb: [255, 40, 30] },
  { key: "g", color: "green", vf: 3.0, pin: 2, rgb: [40, 230, 80] },
  { key: "b", color: "blue", vf: 3.0, pin: 3, rgb: [50, 120, 255] },
];
export const RGB_COMMON_PIN = 1;

// MCP3008（16 腳 DIP）：元件的第 i 支腳＝晶片的第 i+1 腳
export const MCP3008_PINS = [
  "CH0", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7",
  "DGND", "CS/SHDN", "DIN", "DOUT", "CLK", "AGND", "VREF", "VDD",
];
// 每支腳要接到哪裡（給提示與滑鼠說明用）
const MCP3008_TARGET = {
  16: "m.target3v3", 15: "m.target3v3", 14: "GND", 9: "GND",
  13: "m.targetSclk", 12: "m.targetMiso", 11: "m.targetMosi", 10: "m.targetCe0",
};
export function mcp3008Target(num) {
  const key = MCP3008_TARGET[num];
  return !key ? null : key === "GND" ? "GND" : t(key);
}

// ------------------------------------------------------------------
// 40 pin 排針（Raspberry Pi 4 Model B）：實體腳位 → 名稱
// ------------------------------------------------------------------
export const HEADER = {
  1: "3V3", 2: "5V", 3: 2, 4: "5V", 5: 3, 6: "GND", 7: 4, 8: 14, 9: "GND", 10: 15,
  11: 17, 12: 18, 13: 27, 14: "GND", 15: 22, 16: 23, 17: "3V3", 18: 24, 19: 10, 20: "GND",
  21: 9, 22: 25, 23: 11, 24: 8, 25: "GND", 26: 7, 27: 0, 28: 1, 29: 5, 30: "GND",
  31: 6, 32: 12, 33: 13, 34: "GND", 35: 19, 36: 16, 37: 26, 38: 20, 39: "GND", 40: 21,
};

export function headerLabel(phys) {
  const name = HEADER[phys];
  return typeof name === "number" ? `GPIO${name}` : name;
}

// 開機時（還沒有程式設定）各 GPIO 的預設上拉／下拉：GPIO0～8 上拉，其餘下拉
export function bootPull(gpio) {
  return gpio <= 8 ? "up" : "down";
}

// ------------------------------------------------------------------
// 麵包板（標準尺寸，63 行）：孔的編號與相通關係
//   主區域：a～e 一組、f～j 一組，同一行（column）同一組的 5 個孔相通
//   電源軌：上下各有 + 與 − 兩條，整條相通
// ------------------------------------------------------------------
export const BB_COLS = 63;
export const BB_ROWS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
export const BB_RAILS = ["top+", "top-", "bot-", "bot+"];

// 電源軌每 6 個位置空一格（跟實物一樣 5 個孔一組）
export function railHasHole(col) {
  return col % 6 !== 5;
}

// 孔所屬的「排」（相通的一組孔），用來決定電路連通
export function holeStrip(id) {
  const m = /^bb:([a-j])(\d+)$/.exec(id);
  if (m) return `strip:${m[2]}:${"abcde".includes(m[1]) ? "top" : "bottom"}`;
  const r = /^bb:(top\+|top-|bot-|bot\+):\d+$/.exec(id);
  if (r) return `rail:${r[1]}`;
  return null;
}

// ------------------------------------------------------------------
// 聯集-查找（用來把相通的孔合併成節點）
// ------------------------------------------------------------------
class DisjointSet {
  constructor() { this.parent = new Map(); }
  find(x) {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(x) !== root) { const next = this.parent.get(x); this.parent.set(x, root); x = next; }
    return root;
  }
  union(a, b) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// ------------------------------------------------------------------
// 線性方程組 A x = b（高斯消去法，部分選主元）
// ------------------------------------------------------------------
function solveLinear(A, b) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    const p = A[col][col];
    if (Math.abs(p) < 1e-300) continue;
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = Math.abs(A[r][r]) < 1e-300 ? 0 : s / A[r][r];
  }
  return x;
}

// ------------------------------------------------------------------
// 主程式
//
// circuit = {
//   parts: [{ id, type: "led"|"rgbled"|"resistor"|"button"|"pot"|"mcp3008",
//             pins: [點編號或 null, ...], color?, ohms?, pressed?, pos?（旋鈕 0～1）, common? }],
//   wires: [{ id, a: 點編號或 null, b: 點編號或 null }],
// }
//   點編號：麵包板的孔 "bb:a12"、"bb:top+:3"；排針 "hdr:12"
//   按鈕的 4 支腳：0–1 永遠相通、2–3 永遠相通，按下時 0/1 與 2/3 相通
//
// pins = { gpio號碼: { mode: "free"|"input"|"alert"|"output", level, pull, pwm } }（來自伺服器）
// ------------------------------------------------------------------
export function simulate(circuit, pins = {}) {
  const ds = new DisjointSet();
  const issues = [];

  // 排針：所有 GND 相通、兩個 3V3 相通、兩個 5V 相通
  for (let phys = 1; phys <= 40; phys++) {
    const name = HEADER[phys];
    if (typeof name === "string") ds.union(`hdr:${phys}`, `power:${name}`);
    else ds.find(`hdr:${phys}`);
  }
  ds.find("power:GND");

  // 麵包板內部的相通關係
  const used = new Set();
  const usePoint = (id) => {
    if (!id) return;
    used.add(id);
    const strip = holeStrip(id);
    if (strip) ds.union(id, strip);
    else ds.find(id);
  };

  for (const w of circuit.wires) {
    usePoint(w.a); usePoint(w.b);
    if (w.a && w.b) ds.union(w.a, w.b);
  }
  for (const p of circuit.parts) {
    p.pins.forEach(usePoint);
    if (p.type === "button") {
      if (p.pins[0] && p.pins[1]) ds.union(p.pins[0], p.pins[1]);
      if (p.pins[2] && p.pins[3]) ds.union(p.pins[2], p.pins[3]);
    }
  }

  // 節點編號（GND 是參考點 = -1）
  const ground = ds.find("power:GND");
  const index = new Map();
  const netOf = (point) => {
    if (!point) return null;
    const root = ds.find(point);
    if (root === ground) return -1;
    if (!index.has(root)) index.set(root, index.size);
    return index.get(root);
  };
  const net3v3 = netOf("power:3V3");
  const net5v = netOf("power:5V");

  // 每個節點上有哪些元件腳（用來找串聯的電阻、判斷有沒有東西接上）
  const members = new Map();
  const addMember = (net, what) => {
    if (net === null) return;
    if (!members.has(net)) members.set(net, []);
    members.get(net).push(what);
  };
  for (const p of circuit.parts) p.pins.forEach((pt, i) => addMember(netOf(pt), { part: p, pin: i }));
  for (const w of circuit.wires) { addMember(netOf(w.a), { wire: w }); addMember(netOf(w.b), { wire: w }); }

  // ---- 電源（諾頓等效：電導 G 對地，加上注入電流 I） ----
  const sources = [];   // { kind, net, g, v, gpio?, phys? }
  if (net3v3 === -1) issues.push({ level: "danger", text: t("c.short3v3") });
  else sources.push({ kind: "3V3", net: net3v3, g: 1 / R_SUPPLY, v: 3.3 });
  if (net5v === -1) issues.push({ level: "danger", text: t("c.short5v") });
  else sources.push({ kind: "5V", net: net5v, g: 1 / R_SUPPLY, v: 5.0 });
  if (net3v3 !== -1 && net3v3 === net5v) {
    issues.push({ level: "danger", text: t("c.short3v3to5v") });
  }

  const gpioPins = [];
  for (let phys = 1; phys <= 40; phys++) {
    const gpio = HEADER[phys];
    if (typeof gpio !== "number") continue;
    const state = pins[gpio] || { mode: "free" };
    const net = netOf(`hdr:${phys}`);
    const info = { gpio, phys, net, state, pull: null, output: null };
    if (state.mode === "spi") {
      // 被 SPI 使用中（MCP3008 等晶片負責這支腳）：不是一般的輸入／輸出
    } else if (state.mode === "output") {
      const on = state.pwm ? state.pwm[1] > 0 : !!state.level;
      info.output = on ? V_GPIO : 0;
      sources.push({ kind: "gpio", net, g: 1 / R_GPIO, v: info.output, gpio, phys });
    } else {
      info.pull = state.mode === "free" ? bootPull(gpio) : state.pull;
      if (info.pull === "up") sources.push({ kind: "pull", net, g: 1 / R_PULL, v: V_GPIO, gpio, phys });
      if (info.pull === "down") sources.push({ kind: "pull", net, g: 1 / R_PULL, v: 0, gpio, phys });
    }
    gpioPins.push(info);
  }

  // ---- 元件 ----
  const leds = [], resistors = [], buttons = [], chips = [];
  for (const p of circuit.parts) {
    const nets = p.pins.map(netOf);
    if (p.type === "led") {
      const key = LED_COLORS[p.color] ? p.color : "red";
      leds.push({ part: p, id: p.id, label: t("c.ledLabel", { color: colorName(key) }), a: nets[0], c: nets[1],
        vf: LED_COLORS[key].vf, on: false, current: 0 });
    } else if (p.type === "rgbled") {
      // 共陰極：共同腳接 GND，三支腳各自是陽極；共陽極則相反
      const anode = p.common === "anode";
      for (const ch of RGB_CHANNELS) {
        const leg = nets[ch.pin], com = nets[RGB_COMMON_PIN];
        leds.push({ part: p, id: `${p.id}:${ch.key}`, label: t("c.rgbLabel", { color: colorName(ch.color) }), rgbKey: ch.key,
          a: anode ? com : leg, c: anode ? leg : com, vf: ch.vf, on: false, current: 0 });
      }
    } else if (p.type === "pot") {
      // 腳 1 ～滑動端 ～腳 3：旋鈕往右轉（pos 變大），滑動端越靠近腳 3
      const total = p.ohms || 10000, pos = Math.max(0, Math.min(1, p.pos ?? 0.5));
      resistors.push({ part: p, pot: true, a: nets[0], b: nets[1], ohms: Math.max(R_POT_MIN, total * pos), current: 0 });
      resistors.push({ part: p, pot: true, a: nets[1], b: nets[2], ohms: Math.max(R_POT_MIN, total * (1 - pos)), current: 0 });
    } else if (p.type === "mcp3008") {
      chips.push({ part: p, nets });
    } else if (p.type === "resistor") {
      resistors.push({ part: p, a: nets[0], b: nets[1], ohms: p.ohms, current: 0 });
    } else if (p.type === "button") {
      buttons.push({ part: p, a: nets[0] ?? nets[1], b: nets[2] ?? nets[3] });
    }
  }

  // ---- 組矩陣、求解；LED 依導通與否反覆修正，直到狀態穩定 ----
  const n = index.size;
  let volts = new Array(n).fill(0);
  const V = (net) => (net === null ? NaN : net === -1 ? 0 : volts[net]);

  const solveOnce = () => {
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    const b = new Array(n).fill(0);
    for (let i = 0; i < n; i++) A[i][i] += GMIN;
    const conductance = (x, y, g) => {
      if (x === null || y === null || x === y) return;
      if (x >= 0) A[x][x] += g;
      if (y >= 0) A[y][y] += g;
      if (x >= 0 && y >= 0) { A[x][y] -= g; A[y][x] -= g; }
    };
    const inject = (x, i) => { if (x !== null && x >= 0) b[x] += i; };

    for (const s of sources) {
      if (s.net === null || s.net === -1) continue;
      conductance(s.net, -1, s.g);
      inject(s.net, s.g * s.v);
    }
    for (const r of resistors) conductance(r.a, r.b, 1 / r.ohms);
    for (const btn of buttons) if (btn.part.pressed) conductance(btn.a, btn.b, 1 / R_BUTTON);
    for (const led of leds) {
      if (led.a === null || led.c === null || led.a === led.c) continue;
      if (led.on) {
        // 導通：I = (Va − Vc − Vf) / R_LED
        const g = 1 / R_LED;
        conductance(led.a, led.c, g);
        inject(led.a, g * led.vf);
        inject(led.c, -g * led.vf);
      } else {
        conductance(led.a, led.c, 1e-9);
      }
    }
    volts = n ? solveLinear(A, b) : [];
  };

  for (let iter = 0; iter < 30; iter++) {
    solveOnce();
    let changed = false;
    for (const led of leds) {
      if (led.a === null || led.c === null || led.a === led.c) continue;
      const vd = V(led.a) - V(led.c);
      if (!led.on && vd > led.vf + 1e-9) { led.on = true; changed = true; }
      else if (led.on && vd < led.vf - 1e-9) { led.on = false; changed = true; }
    }
    if (!changed) break;
  }

  // ---- 計算電流 ----
  for (const led of leds) {
    if (led.on) led.current = (V(led.a) - V(led.c) - led.vf) / R_LED;
    led.voltage = led.a === null || led.c === null ? 0 : V(led.a) - V(led.c);
  }
  for (const r of resistors) {
    r.current = r.a === null || r.b === null ? 0 : (V(r.a) - V(r.b)) / r.ohms;
  }
  for (const s of sources) {
    s.current = s.net === null ? 0 : (s.v - V(s.net)) * s.g;   // 流出電源的電流
  }

  // ---- 輸入腳：是否有東西驅動（沒有就是浮接） ----
  const adj = new Map();
  const link = (x, y) => {
    if (x === null || y === null || x === y) return;
    if (!adj.has(x)) adj.set(x, []);
    if (!adj.has(y)) adj.set(y, []);
    adj.get(x).push(y); adj.get(y).push(x);
  };
  for (const r of resistors) link(r.a, r.b);
  for (const btn of buttons) if (btn.part.pressed) link(btn.a, btn.b);
  for (const led of leds) if (led.on) link(led.a, led.c);
  const driven = (start, exclude) => {
    const seeds = new Set([-1]);
    for (const s of sources) if (s !== exclude && s.net !== null) seeds.add(s.net);
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const x = queue.shift();
      if (seeds.has(x)) return true;
      for (const y of adj.get(x) || []) if (!seen.has(y)) { seen.add(y); queue.push(y); }
    }
    return false;
  };

  const gpio = {};
  for (const info of gpioPins) {
    const connected = (members.get(info.net) || []).length > 0 || info.net === -1 ||
      info.net === net3v3 || info.net === net5v;
    const v = info.net === null ? 0 : V(info.net);
    const result = { gpio: info.gpio, phys: info.phys, connected, voltage: v, mode: info.state.mode };
    if (info.output !== null) {
      const src = sources.find((s) => s.kind === "gpio" && s.gpio === info.gpio);
      result.current = info.net === -1 ? info.output / R_GPIO : src.current;
    } else {
      const pullSrc = sources.find((s) => s.kind === "pull" && s.gpio === info.gpio);
      const hasPull = info.pull === "up" || info.pull === "down";
      result.floating = connected && !hasPull && !driven(info.net, pullSrc);
      result.level = v > V_HIGH ? 1 : 0;
    }
    gpio[info.gpio] = result;
  }

  // ---- 電路提示 ----
  const sourceNets = new Map();   // 節點 → 標稱電壓與名稱（用來寫估算公式）
  for (const s of sources) {
    if (s.kind === "3V3") sourceNets.set(s.net, { v: 3.3, name: "3V3" });
    if (s.kind === "5V") sourceNets.set(s.net, { v: 5.0, name: "5V" });
    if (s.kind === "gpio" && s.v > 0) sourceNets.set(s.net, { v: V_GPIO, name: `GPIO${s.gpio}` });
  }
  const partPinsOn = (net) => (members.get(net) || []).filter((m) => m.part);

  const reportedLoose = new Set();
  const ledResults = leds.map((led) => {
    const p = led.part;
    const label = led.label;
    const res = { id: led.id, on: led.on && led.current > 0, current: Math.max(0, led.current), brightness: 0 };
    const unplugged = p.pins.some((pt) => !pt);
    if (unplugged) {
      if (!reportedLoose.has(p.id)) issues.push({ level: "info", part: p.id, text: t("c.loose", { label: p.type === "rgbled" ? "RGB LED" : label }) });
      reportedLoose.add(p.id);
      return res;
    }
    if (led.a === led.c) {
      issues.push({ level: "warn", part: p.id, text: t("c.ledShorted", { label }) });
      return res;
    }
    // 反接：陰極電位比陽極高
    if (!led.on && led.voltage < -1.0) {
      const how = t(p.type !== "rgbled" ? "c.howLed" : p.common === "anode" ? "c.howRgbAnode" : "c.howRgbCathode");
      issues.push({ level: "warn", part: p.id, text: t("c.reversed", { label, how }) });
      return res;
    }
    if (!res.on) return res;

    // 找串聯的電阻（用來寫 V = IR 的估算，也用來找出驅動這顆 LED 的 GPIO）
    const series = findSeries(led, resistors, partPinsOn);

    // 亮度：用對數換算，1 µA 幾乎看不到、15 mA 接近全亮
    const duty = pwmDutyFor([led.a, led.c, series?.sourceNet], gpioPins);
    const avg = res.current * duty;
    res.brightness = Math.max(0, Math.min(1, (Math.log10(Math.max(avg, 1e-9)) + 6) / (Math.log10(15e-3) + 6)));
    res.average = avg;

    const mA = res.current * 1000;
    let formula = "";
    if (series) {
      const { resistor, sourceNet, groundNet } = series;
      const src = sourceNets.get(sourceNet);
      if (src && groundNet === -1) {
        const est = (src.v - led.vf) / resistor.ohms * 1000;
        formula = t("c.formula", { v: src.v, vf: led.vf, r: formatOhms(resistor.ohms), i: formatCurrent(est / 1000) });
      }
    }
    const measured = t("c.measured", { i: formatCurrent(res.current) }) + (duty < 1 ? t("c.pwmAvg", { i: formatCurrent(avg) }) : "");
    const formulaText = formula ? t("c.sentence", { s: formula }) : "";
    if (!series && mA > GPIO_MAX_MA) {
      issues.push({ level: "danger", part: p.id, text: t("c.noResistor", { label, measured, max: GPIO_MAX_MA }) });
    } else if (mA > LED_MAX_MA) {
      issues.push({ level: "danger", part: p.id, text: t("c.ledTooMuch", { label, measured, max: LED_MAX_MA }) });
    } else if (mA < 0.1) {
      issues.push({ level: "info", part: p.id, text: t("c.ledTooLittle", { label, measured, formula: formulaText }).trim() });
    } else {
      issues.push({ level: "ok", part: p.id, text: t("c.ledOn", { label, measured, formula: formulaText }).trim() });
    }
    return res;
  });

  for (const r of resistors) {
    const p = r.part;
    if (r.pot) continue;
    if (r.a !== null && r.a === r.b && partPinsOn(r.a).length > 2) {
      issues.push({ level: "info", part: p.id, text: t("c.resShorted", { r: formatOhms(r.ohms) }) });
    }
  }

  // ---- 可變電阻 ----
  const potResults = {};
  for (const p of circuit.parts) {
    if (p.type !== "pot") continue;
    const [s1, s2] = resistors.filter((r) => r.part === p);
    const wiper = s1.b === null ? null : V(s1.b);
    potResults[p.id] = { wiper, current: Math.max(Math.abs(s1.current), Math.abs(s2.current)) };
    const mA = potResults[p.id].current * 1000;
    if (mA > 30) {
      issues.push({ level: "danger", part: p.id, text: t("c.potDanger", { i: formatCurrent(potResults[p.id].current) }) });
    }
  }

  // ---- MCP3008 ----
  const hdrNet = (phys) => netOf(`hdr:${phys}`);
  const adc = chips.map((chip) => analyzeMcp3008(chip, { V, hdrNet, members, driven, issues, net3v3, net5v }));

  for (const info of gpioPins) {
    const r = gpio[info.gpio];
    if (info.state.mode === "spi") continue;
    if (info.output !== null) {
      const mA = Math.abs(r.current) * 1000;
      if (mA > 50) {
        issues.push({ level: "danger", text: t("c.gpioShort", {
          g: info.gpio, phys: info.phys, out: t(info.output ? "c.high" : "c.low"), other: t(info.output ? "c.low" : "c.high"),
          i: formatCurrent(Math.abs(r.current)) }) });
      } else if (mA > GPIO_MAX_MA) {
        issues.push({ level: "warn", text: t("c.gpioOver", { g: info.gpio, phys: info.phys, i: formatCurrent(Math.abs(r.current)), max: GPIO_MAX_MA }) });
      }
    } else {
      if (r.voltage > 3.6) {
        issues.push({ level: "danger", text: t("c.gpioOverVolt", { g: info.gpio, phys: info.phys, v: r.voltage.toFixed(1) }) });
      }
      if (r.floating && info.state.mode !== "free") {
        issues.push({ level: "warn", text: t("c.floating", { g: info.gpio, phys: info.phys }) });
      }
    }
  }
  for (const s of sources) {
    if ((s.kind === "3V3" || s.kind === "5V") && s.current > 1) {
      issues.push({ level: "danger", text: t("c.supplyShort", { kind: s.kind, i: formatCurrent(s.current) }) });
    }
  }

  // 每個點屬於哪個節點、電壓多少（畫面上滑鼠移到孔上時顯示）
  const pointNet = (point) => netOf(point);
  return {
    leds: Object.fromEntries(ledResults.map((r) => [r.id, r])),
    resistors: Object.fromEntries(resistors.filter((r) => !r.pot).map((r) => [r.part.id, { current: r.current, power: r.current * r.current * r.ohms }])),
    pots: potResults,
    adc,
    gpio,
    issues,
    pointNet,
    voltageOf: (point) => { const net = netOf(point); return net === null ? null : V(net); },
    used,
  };
}

// PWM 時 LED 的平均亮度要乘上工作週期：找出接在這些節點上、正在輸出 PWM 的 GPIO
function pwmDutyFor(nets, gpioPins) {
  for (const info of gpioPins) {
    if (info.state.mode === "output" && info.state.pwm && nets.includes(info.net)) {
      return Math.max(0, Math.min(1, info.state.pwm[1] / 100));
    }
  }
  return 1;
}

// 找出與 LED 串聯的電阻：LED 的某一端節點上只接了這顆 LED 和一個電阻
function findSeries(led, resistors, partPinsOn) {
  for (const [ledNet, otherLedNet] of [[led.a, led.c], [led.c, led.a]]) {
    const parts = partPinsOn(ledNet);
    if (parts.length !== 2) continue;
    const r = resistors.find((x) => !x.pot && x.part === parts.find((m) => m.part !== led.part)?.part);
    if (!r) continue;
    const far = r.a === ledNet ? r.b : r.a;
    // 電阻在 LED 陽極側：電源 → 電阻 → LED → GND；在陰極側：電源 → LED → 電阻 → GND
    if (ledNet === led.a) return { resistor: r, sourceNet: far, groundNet: otherLedNet };
    return { resistor: r, sourceNet: otherLedNet, groundNet: far };
  }
  return null;
}

// MCP3008：檢查電源與 SPI 接線，算出每個通道的電壓與轉換結果
function analyzeMcp3008({ part: p, nets }, { V, hdrNet, members, driven, issues, net3v3, net5v }) {
  const pin = (num) => nets[num - 1];
  const res = { id: p.id, ce: null, ok: false, powered: false, vref: 0, channels: [] };
  const warn = (text, level = "warn") => issues.push({ level, part: p.id, text: t("m.prefix", { text }) });
  if (p.pins.some((pt) => !pt)) {
    warn(t("m.loose"), "info");
    return res;
  }
  // 沒有跨在中間的溝上：上下兩排同一行的腳會被麵包板連在一起
  for (let i = 0; i < 8; i++) {
    if (nets[i] === nets[15 - i]) {
      warn(t("m.gap"));
      return res;
    }
  }

  // 完全還沒接線：給一張對照表就好，不要一次跳出 8 個警告
  const wired = nets.some((n) => n === -1 || n === net3v3 || n === net5v || (members.get(n) || []).length > 1);
  if (!wired) {
    warn(t("m.unwired"), "info");
    for (let i = 0; i < 8; i++) res.channels.push({ connected: false, floating: true, voltage: null, code: null });
    return res;
  }

  const vdd = V(pin(16)), vref = V(pin(15));
  let ok = true;
  if (vdd > 4) {
    warn(t("m.vdd5v"), "danger");
  } else if (!(vdd > 2.7)) {
    warn(t("m.vddMissing"));
    ok = false;
  }
  if (!(vref > 0.5)) {
    warn(t("m.vref"));
  }
  if (pin(14) !== -1) warn(t("m.agnd"));
  if (pin(9) !== -1) { warn(t("m.dgnd")); ok = false; }

  // SPI 接線
  const dout = pin(12), din = pin(11);
  if (dout === hdrNet(19) && din === hdrNet(21)) {
    warn(t("m.swapped"));
    ok = false;
  } else {
    for (const [num, name, phys, target] of [
      [13, "CLK", 23, "GPIO11/SCLK"], [12, "DOUT", 21, "GPIO9/MISO"], [11, "DIN", 19, "GPIO10/MOSI"]]) {
      if (pin(num) !== hdrNet(phys)) { warn(t("m.spiPin", { name, num, target, phys })); ok = false; }
    }
  }
  if (pin(10) === hdrNet(24)) res.ce = 0;
  else if (pin(10) === hdrNet(26)) res.ce = 1;
  else { warn(t("m.cs")); ok = false; }

  res.powered = vdd > 2.7;
  res.vref = Math.max(0, vref);
  res.ok = ok;
  // 類比輸入
  const connectedNet = (net) => net === -1 || net === net3v3 || net === net5v || (members.get(net) || []).length > 1;
  for (let i = 0; i < 8; i++) {
    const net = nets[i];
    const connected = connectedNet(net);
    const floating = !connected || !driven(net, null);
    const v = Math.max(0, V(net));
    const code = res.vref > 0.05 ? Math.max(0, Math.min(1023, Math.floor(v / res.vref * 1024 + 1e-3))) : (v > 0.01 ? 1023 : 0);
    res.channels.push({ connected, floating, voltage: floating ? null : v, code: floating ? null : code });
    if (connected && floating) warn(t("m.chFloat", { ch: i, num: i + 1 }));
    if (!floating && v > res.vref + 0.2 && res.vref > 0.5) warn(t("m.chOver", { ch: i, v: v.toFixed(2) }));
  }
  if (ok) {
    const used = res.channels.map((c, i) => [c, i]).filter(([c]) => c.connected && !c.floating);
    const list = used.map(([c, i]) => t("m.chItem", { ch: i, v: c.voltage.toFixed(2), code: c.code, val: (c.code / 1023).toFixed(2) }))
      .join(t("m.chSep"));
    issues.push({ level: "ok", part: p.id, text: t("m.ok", {
      ce: res.ce, code: `MCP3008(channel=0${res.ce ? ", device=1" : ""})`,
      list: list ? t("c.sentence", { s: list }) : t("m.noChannels") }) });
  }
  return res;
}

export function formatOhms(ohms) {
  if (ohms >= 1e6) return `${+(ohms / 1e6).toFixed(2)}MΩ`;
  if (ohms >= 1e3) return `${+(ohms / 1e3).toFixed(2)}kΩ`;
  return `${ohms}Ω`;
}

export function formatCurrent(amps) {
  const a = Math.abs(amps);
  if (a >= 1) return `${amps.toFixed(2)}A`;
  if (a >= 1e-3) return `${(amps * 1e3).toFixed(1)}mA`;
  return `${(amps * 1e6).toFixed(1)}µA`;
}
