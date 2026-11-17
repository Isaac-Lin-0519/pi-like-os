// ==================================================================
// 畫面上的幾何位置與 SVG 圖形：Raspberry Pi 4B、麵包板、元件、杜邦線
//
// 比例：1 個孔距（2.54mm）＝ 20 個單位，Pi 與麵包板都依實物比例繪製。
// 版面：上面是標準尺寸麵包板（63 行），下面是 Raspberry Pi（排針朝向麵包板）。
// ==================================================================

import {
  BB_COLS, BB_ROWS, HEADER, LED_COLORS, MCP3008_PINS, RGB_CHANNELS, formatOhms, headerLabel, railHasHole,
} from "./circuit.js";

export const P = 20;                      // 孔距
export const MM = P / 2.54;               // 1mm 的長度
export const VIEW = { w: 1400, h: 960 };
// 舊版（半尺寸麵包板、Pi 在左邊）存的電路要平移這麼多，才會對到新版同一個孔
export const LAYOUT_V1_OFFSET = { x: -690, y: -40 };

// ---- Raspberry Pi 4B（85 × 56 mm）----
export const PI = { x: 40, y: 500, w: 85 * MM, h: 56 * MM };

export function headerPos(phys) {
  const col = Math.floor((phys - 1) / 2);
  return {
    x: PI.x + 8.37 * MM + col * P,
    y: PI.y + (phys % 2 === 0 ? 2.23 : 4.77) * MM,  // 偶數腳在板子邊緣、奇數腳在內側
  };
}

// ---- 麵包板（標準尺寸 63 行）----
export const BB = { x0: 80, left: 40, right: 80 + (BB_COLS - 1) * P + 40, top: 20, bottom: 460 };
const ROW_Y = { a: 130, b: 150, c: 170, d: 190, e: 210, f: 270, g: 290, h: 310, i: 330, j: 350 };
const RAIL_Y = { "top+": 50, "top-": 70, "bot-": 410, "bot+": 430 };

export function colX(col) { return BB.x0 + col * P; }

// 所有可以接線的點：排針與麵包板的孔
export const POINTS = new Map();
for (let phys = 1; phys <= 40; phys++) POINTS.set(`hdr:${phys}`, { ...headerPos(phys), kind: "header", phys });
for (let col = 0; col < BB_COLS; col++) {
  for (const row of BB_ROWS) POINTS.set(`bb:${row}${col}`, { x: colX(col), y: ROW_Y[row], kind: "hole", row, col });
  for (const rail of Object.keys(RAIL_Y)) {
    if (railHasHole(col)) POINTS.set(`bb:${rail}:${col}`, { x: colX(col), y: RAIL_Y[rail], kind: "rail", rail, col });
  }
}

const pointByXY = new Map();
for (const [id, p] of POINTS) pointByXY.set(`${Math.round(p.x)},${Math.round(p.y)}`, id);

export function pointAt(x, y, kinds = null) {
  const id = pointByXY.get(`${Math.round(x)},${Math.round(y)}`);
  if (!id) return null;
  if (kinds && !kinds.includes(POINTS.get(id).kind)) return null;
  return id;
}

export function nearestPoint(x, y, radius = 11, kinds = null) {
  let best = null, bestD = radius * radius;
  for (const [id, p] of POINTS) {
    if (kinds && !kinds.includes(p.kind)) continue;
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) { best = id; bestD = d; }
  }
  return best;
}

export function describePoint(id) {
  const p = POINTS.get(id);
  if (!p) return "";
  if (p.kind === "header") {
    const name = HEADER[p.phys];
    return typeof name === "number" ? `GPIO${name}（實體腳位 ${p.phys}）` : `${name}（實體腳位 ${p.phys}）`;
  }
  if (p.kind === "rail") {
    const side = p.rail.startsWith("top") ? "上方" : "下方";
    return `${side}電源軌 ${p.rail.endsWith("+") ? "＋" : "－"}（整條相通）`;
  }
  return `麵包板 ${p.row}${p.col + 1}（第 ${p.col + 1} 行 ${"abcde".includes(p.row) ? "a～e" : "f～j"} 這 5 個孔相通）`;
}

// ==================================================================
// 元件定義
//   pins：以「孔距」為單位、相對於第 0 支腳的位置（未旋轉）
// ==================================================================
export const PART_TYPES = {
  led: {
    name: "LED",
    pins: [{ dx: 0, dy: 0, name: "長腳（＋，陽極）" }, { dx: 1, dy: 0, name: "短腳（－，陰極）" }],
  },
  resistor: {
    name: "電阻",
    pins: [{ dx: 0, dy: 0, name: "腳 1" }, { dx: 4, dy: 0, name: "腳 2" }],
  },
  button: {
    name: "按鈕",
    // 0–1 永遠相通、2–3 永遠相通（相距較遠的兩支腳），按下時左右兩組相通
    pins: [{ dx: 0, dy: 0, name: "左上" }, { dx: 0, dy: 3, name: "左下" },
           { dx: 2, dy: 0, name: "右上" }, { dx: 2, dy: 3, name: "右下" }],
  },
  rgbled: {
    name: "RGB LED",
    pins: [{ dx: 0, dy: 0, name: "紅（R）" }, { dx: 1, dy: 0, name: "共同腳（最長的腳）" },
           { dx: 2, dy: 0, name: "綠（G）" }, { dx: 3, dy: 0, name: "藍（B）" }],
  },
  pot: {
    name: "可變電阻",
    pins: [{ dx: 0, dy: 0, name: "腳 1" }, { dx: 2, dy: 0, name: "中間腳（滑動端）" }, { dx: 4, dy: 0, name: "腳 3" }],
  },
  mcp3008: {
    name: "MCP3008",
    // 缺口朝左：第 1～8 腳在下排（左到右），第 9～16 腳在上排（右到左）
    pins: MCP3008_PINS.map((name, i) => (i < 8
      ? { dx: i, dy: 3, name: `第 ${i + 1} 腳 ${name}` }
      : { dx: 15 - i, dy: 0, name: `第 ${i + 1} 腳 ${name}` })),
  },
};

// 常見材料包裡的電阻（色碼：100Ω 棕黑棕、220Ω 紅紅棕、330Ω 橙橙棕、1kΩ 棕黑紅、
// 10kΩ 棕黑橙、47kΩ 黃紫橙、100kΩ 棕黑黃、1MΩ 棕黑綠）
export const RESISTOR_VALUES = [100, 220, 330, 1000, 10000, 47000, 100000, 1000000];
export const POT_VALUES = [1000, 10000, 100000];
export const WIRE_COLORS = {
  red: "#d7263d", black: "#222222", yellow: "#f2c014", green: "#1f9d55",
  blue: "#2563eb", orange: "#f97316", white: "#e9e9e9", purple: "#8b5cf6",
};

function rotate(dx, dy, rot) {
  for (let i = 0; i < ((rot % 4) + 4) % 4; i++) [dx, dy] = [-dy, dx];
  return [dx, dy];
}

export function pinPositions(part) {
  return PART_TYPES[part.type].pins.map(({ dx, dy }) => {
    const [rx, ry] = rotate(dx, dy, part.rot || 0);
    return { x: part.x + rx * P, y: part.y + ry * P };
  });
}

// 元件的腳插在哪些孔（只認麵包板的孔）
export function pinsToPoints(part) {
  return pinPositions(part).map(({ x, y }) => pointAt(x, y, ["hole", "rail"]));
}

// 拖拉時吸附：第 0 支腳靠近某個孔，而且其他腳也剛好都落在孔上，就對齊過去
export function snapPart(part, x, y) {
  const near = nearestPoint(x, y, 14, ["hole", "rail"]);
  if (near) {
    const p = POINTS.get(near);
    const test = { ...part, x: p.x, y: p.y };
    if (pinsToPoints(test).every(Boolean)) return { x: p.x, y: p.y };
  }
  return { x, y };
}

// ==================================================================
// SVG 繪圖（回傳字串）
// ==================================================================
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function drawDefs() {
  return `
  <defs>
    <filter id="glow" x="-150%" y="-150%" width="400%" height="400%">
      <feGaussianBlur stdDeviation="7" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="dome" cx="35%" cy="30%" r="70%">
      <stop offset="0" stop-color="#fff" stop-opacity=".75"/>
      <stop offset=".35" stop-color="#fff" stop-opacity=".12"/>
      <stop offset="1" stop-color="#000" stop-opacity=".18"/>
    </radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e6e8ea"/><stop offset="1" stop-color="#9ea4aa"/>
    </linearGradient>
  </defs>`;
}

export function drawPi() {
  const m = (v) => v * MM;
  const X = PI.x, Y = PI.y;
  const rect = (x, y, w, h, fill, extra = "") =>
    `<rect x="${X + m(x)}" y="${Y + m(y)}" width="${m(w)}" height="${m(h)}" fill="${fill}" ${extra}/>`;
  let s = `<g class="pi">`;
  // 電路板
  s += `<rect x="${X}" y="${Y}" width="${PI.w}" height="${PI.h}" rx="${m(3)}" fill="#1e7a3e" stroke="#145a2c" stroke-width="2"/>`;
  // 固定孔
  for (const [hx, hy] of [[3.5, 3.5], [61.5, 3.5], [3.5, 52.5], [61.5, 52.5]]) {
    s += `<circle cx="${X + m(hx)}" cy="${Y + m(hy)}" r="${m(3)}" fill="#c9a94a"/><circle cx="${X + m(hx)}" cy="${Y + m(hy)}" r="${m(1.4)}" fill="var(--canvas)"/>`;
  }
  // 右側：USB 2.0、USB 3.0、乙太網路
  s += rect(69, 2.5, 18, 14.5, "url(#metal)", `rx="2"`) + rect(70.5, 5, 12, 3, "#222");
  s += rect(69, 20.5, 18, 14.5, "url(#metal)", `rx="2"`) + rect(70.5, 23, 12, 3, "#1c4fbf");
  s += rect(66, 38.5, 21, 16, "url(#metal)", `rx="2"`) + rect(68, 42, 14, 9, "#333", `rx="1"`);
  // 下方：USB-C 電源、兩個 micro HDMI、音訊
  s += rect(7.6, 51.5, 7.5, 4.5, "url(#metal)", `rx="1"`);
  s += rect(22.6, 51.5, 7, 4.5, "url(#metal)", `rx="1"`) + rect(36.1, 51.5, 7, 4.5, "url(#metal)", `rx="1"`);
  s += rect(50.5, 49, 7, 7, "#222", `rx="1"`);
  // SoC、記憶體、無線網路、DSI／CSI 排線座
  s += rect(22, 25, 15, 15, "url(#metal)", `rx="1"`);
  s += `<text x="${X + m(29.5)}" y="${Y + m(33)}" font-size="9" text-anchor="middle" fill="#555">BCM2711</text>`;
  s += rect(41, 26, 13, 12, "#202020", `rx="1"`);
  s += rect(6, 10, 14, 11, "url(#metal)", `rx="1"`);
  s += rect(1.5, 17, 3.5, 22, "#efe6c8") + rect(45, 41, 3.5, 13, "#efe6c8");
  s += `<text x="${X + m(9)}" y="${Y + m(46)}" font-size="13" font-weight="700" fill="#e9f3ea">Raspberry Pi 4 Model B</text>`;
  s += `<text x="${X + m(9)}" y="${Y + m(48.6)}" font-size="9" fill="#bfe0c7">2GB · rev 1.5</text>`;
  // 排針底座
  const first = headerPos(2), last = headerPos(39);
  s += `<rect x="${first.x - 10}" y="${first.y - 10}" width="${last.x - first.x + 20}" height="${last.y - first.y + 20}" fill="#111" rx="2"/>`;
  s += `<text x="${first.x - 14}" y="${headerPos(1).y + 4}" font-size="10" text-anchor="end" fill="#e9f3ea">1</text>`;
  s += `<text x="${PI.x + 8.37 * MM + 19 * P + 14}" y="${first.y + 4}" font-size="10" fill="#e9f3ea">40</text>`;
  // 排針與標籤：偶數腳的標籤在板子外面上方、奇數腳在板子上排針下方
  for (let phys = 1; phys <= 40; phys++) {
    const { x, y } = headerPos(phys);
    const name = HEADER[phys];
    const fill = name === "3V3" ? "#f59e0b" : name === "5V" ? "#ef4444" : name === "GND" ? "#555" : "#d4af37";
    s += `<rect x="${x - 5}" y="${y - 5}" width="10" height="10" fill="${fill}" stroke="#000" stroke-width=".8"/>`;
    s += `<circle cx="${x}" cy="${y}" r="2.2" fill="#3a2f0b"/>`;
    const label = headerLabel(phys);
    const color = name === "3V3" ? "#f59e0b" : name === "5V" ? "#ef4444" : name === "GND" ? "var(--muted)" : "var(--ink)";
    if (phys % 2 === 0) {
      s += `<text transform="translate(${x + 3},${y - 13}) rotate(-90)" font-size="9" fill="${color}">${label}</text>`;
    } else {
      const c2 = name === "GND" ? "#cfe7d5" : name === "3V3" ? "#fbbf24" : "#ffffff";
      s += `<text transform="translate(${x + 3},${y + 13}) rotate(-90)" font-size="9" text-anchor="end" fill="${c2}">${label}</text>`;
    }
  }
  s += `</g>`;
  return s;
}

export function drawBreadboard() {
  let s = `<g class="breadboard">`;
  s += `<rect x="${BB.left}" y="${BB.top}" width="${BB.right - BB.left}" height="${BB.bottom - BB.top}" rx="6" fill="#f3f1ea" stroke="#d6d2c4" stroke-width="2"/>`;
  // 中間的溝
  s += `<rect x="${BB.left + 6}" y="${ROW_Y.e + 18}" width="${BB.right - BB.left - 12}" height="${ROW_Y.f - ROW_Y.e - 36}" fill="#dedad0" rx="2"/>`;
  // 電源軌的紅藍線
  const lx1 = colX(0) - 14, lx2 = colX(BB_COLS - 1) + 14;
  for (const [y, c] of [[RAIL_Y["top+"] - 12, "#d7263d"], [RAIL_Y["top-"] + 12, "#2563eb"], [RAIL_Y["bot-"] - 12, "#2563eb"], [RAIL_Y["bot+"] + 12, "#d7263d"]]) {
    s += `<line x1="${lx1}" y1="${y}" x2="${lx2}" y2="${y}" stroke="${c}" stroke-width="2"/>`;
  }
  for (const [rail, y] of Object.entries(RAIL_Y)) {
    const sign = rail.endsWith("+") ? "+" : "−";
    const c = sign === "+" ? "#d7263d" : "#2563eb";
    s += `<text x="${BB.left + 12}" y="${y + 5}" font-size="14" font-weight="700" fill="${c}" text-anchor="middle">${sign}</text>`;
    s += `<text x="${BB.right - 12}" y="${y + 5}" font-size="14" font-weight="700" fill="${c}" text-anchor="middle">${sign}</text>`;
  }
  // 行號與列字母
  for (let col = 0; col < BB_COLS; col++) {
    if (col === 0 || (col + 1) % 5 === 0) {
      s += `<text x="${colX(col)}" y="${ROW_Y.a - 16}" font-size="9" text-anchor="middle" fill="#8a8578">${col + 1}</text>`;
      s += `<text x="${colX(col)}" y="${ROW_Y.j + 24}" font-size="9" text-anchor="middle" fill="#8a8578">${col + 1}</text>`;
    }
  }
  for (const row of BB_ROWS) {
    s += `<text x="${colX(0) - 18}" y="${ROW_Y[row] + 3}" font-size="9" text-anchor="middle" fill="#8a8578">${row}</text>`;
    s += `<text x="${colX(BB_COLS - 1) + 18}" y="${ROW_Y[row] + 3}" font-size="9" text-anchor="middle" fill="#8a8578">${row}</text>`;
  }
  // 孔
  for (const [id, p] of POINTS) {
    if (p.kind === "header") continue;
    s += `<rect x="${p.x - 4}" y="${p.y - 4}" width="8" height="8" rx="1.5" fill="#3b3a36"/>`;
  }
  s += `</g>`;
  return s;
}

// ---- 元件 ----

function resistorBands(ohms) {
  const COLORS = ["#000000", "#8b4513", "#e00000", "#ff8c00", "#ffd700", "#16a34a", "#2563eb", "#7c3aed", "#808080", "#ffffff"];
  const exp = Math.floor(Math.log10(ohms)) - 1;
  const digits = Math.round(ohms / 10 ** exp);
  return [COLORS[Math.floor(digits / 10)], COLORS[digits % 10], COLORS[exp], "#c9a227"];
}

export function drawPart(part, { selected = false, sim = null } = {}) {
  const pins = pinPositions(part);
  const unplugged = (part.pins || []).map((pt) => !pt);
  let body = "";
  if (part.type === "led") body = drawLed(part, sim);
  else if (part.type === "resistor") body = drawResistor(part);
  else if (part.type === "button") body = drawButton(part);
  else if (part.type === "rgbled") body = drawRgbLed(part, sim);
  else if (part.type === "pot") body = drawPot(part);
  else if (part.type === "mcp3008") body = drawMcp3008(part);
  let s = `<g class="part${selected ? " selected" : ""}" data-part="${esc(part.id)}">`;
  s += `<g transform="translate(${part.x},${part.y}) rotate(${(part.rot || 0) * 90})">${body}</g>`;
  // 沒插進孔的腳標成紅色
  pins.forEach((p, i) => {
    if (unplugged[i]) s += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="none" stroke="#e5484d" stroke-width="2"/>`;
  });
  s += `</g>`;
  return s;
}

function drawLed(part, sim) {
  const color = LED_COLORS[part.color] || LED_COLORS.red;
  const b = sim?.on ? sim.brightness : 0;
  // 腳：長腳（陽極）在 0、短腳（陰極）在 P
  let s = `<path d="M0 0 L0 -8 L4 -14 L4 -22" stroke="#9aa0a6" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  s += `<path d="M${P} 0 L${P} -8 L${P - 4} -14 L${P - 4} -22" stroke="#9aa0a6" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  s += `<circle cx="0" cy="0" r="3" fill="#9aa0a6"/><circle cx="${P}" cy="0" r="3" fill="#9aa0a6"/>`;
  const cx = P / 2, cy = -34, r = 15;
  // 圓頂（陰極那側有一個平邊）
  const dome = `M${cx + r * 0.82} ${cy - r * 0.57} A${r} ${r} 0 1 0 ${cx + r * 0.82} ${cy + r * 0.57} Z`;
  if (b > 0.01) {
    s += `<circle cx="${cx}" cy="${cy}" r="${r + 8}" fill="${color.rgb}" opacity="${0.15 + 0.5 * b}" filter="url(#glow)"/>`;
  }
  s += `<path d="${dome}" fill="${color.rgb}" fill-opacity="${0.45 + 0.55 * b}" stroke="#00000055" stroke-width="1.2"/>`;
  s += `<path d="${dome}" fill="url(#dome)"/>`;
  if (b > 0.01) s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff" opacity="${0.75 * b}" filter="url(#glow)"/>`;
  s += `<text x="-7" y="-8" font-size="10" font-weight="700" fill="#d7263d">+</text>`;
  return s;
}

function drawResistor(part) {
  const L = 4 * P;
  let s = `<line x1="0" y1="0" x2="${L}" y2="0" stroke="#9aa0a6" stroke-width="2.4" stroke-linecap="round"/>`;
  s += `<circle cx="0" cy="0" r="3" fill="#9aa0a6"/><circle cx="${L}" cy="0" r="3" fill="#9aa0a6"/>`;
  s += `<rect x="${L / 2 - 20}" y="-8" width="40" height="16" rx="7" fill="#e4c99b" stroke="#a68b5b" stroke-width="1"/>`;
  resistorBands(part.ohms).forEach((c, i) => {
    const x = L / 2 - 13 + i * 7 + (i === 3 ? 5 : 0);
    s += `<rect x="${x}" y="-8" width="4" height="16" fill="${c}"/>`;
  });
  s += `<text x="${L / 2}" y="-13" font-size="10" text-anchor="middle" fill="var(--ink)">${formatOhms(part.ohms)}</text>`;
  return s;
}

function drawButton(part) {
  const w = 2 * P, h = 3 * P;
  let s = "";
  for (const [x, y] of [[0, 0], [0, h], [w, 0], [w, h]]) s += `<circle cx="${x}" cy="${y}" r="3" fill="#9aa0a6"/>`;
  s += `<rect x="-6" y="6" width="${w + 12}" height="${h - 12}" rx="3" fill="#2b2b2b" stroke="#000" stroke-width="1"/>`;
  s += `<rect x="-2" y="10" width="${w + 4}" height="${h - 20}" rx="2" fill="url(#metal)"/>`;
  const pressed = !!part.pressed;
  s += `<circle cx="${w / 2}" cy="${h / 2}" r="${pressed ? 11 : 13}" fill="${pressed ? "#3a3a3a" : "#1f1f1f"}" stroke="#000" stroke-width="1.5"/>`;
  return s;
}

// RGB LED：4 支腳（紅、共同、綠、藍），霧面白色燈罩，亮的顏色依三色亮度混合
function drawRgbLed(part, sim) {
  const cx = 1.5 * P, cy = -36, r = 17;
  let s = "";
  for (let i = 0; i < 4; i++) {
    const x = i * P, top = cx + (x - cx) * 0.45;
    s += `<path d="M${x} 0 L${x} -8 L${top} -16 L${top} -24" stroke="#9aa0a6" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
    s += `<circle cx="${x}" cy="0" r="3" fill="#9aa0a6"/>`;
  }
  const com = part.common === "anode" ? "+" : "−";
  ["R", com, "G", "B"].forEach((t, i) => {
    s += `<text x="${i * P}" y="14" font-size="8" font-weight="700" text-anchor="middle" fill="${["#d7263d", "#555", "#1f9d55", "#2563eb"][i]}">${t}</text>`;
  });
  let mix = [0, 0, 0], total = 0;
  for (const ch of RGB_CHANNELS) {
    const b = sim?.[ch.key]?.on ? sim[ch.key].brightness : 0;
    total = Math.max(total, b);
    for (let k = 0; k < 3; k++) mix[k] += ch.rgb[k] * b;
  }
  const peak = Math.max(1, ...mix);
  const color = `rgb(${mix.map((v) => Math.round(Math.min(255, (v / peak) * 255))).join(",")})`;
  if (total > 0.01) s += `<circle cx="${cx}" cy="${cy}" r="${r + 9}" fill="${color}" opacity="${0.2 + 0.5 * total}" filter="url(#glow)"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${total > 0.01 ? color : "#eef0f2"}" fill-opacity="${total > 0.01 ? 0.5 + 0.5 * total : 0.9}" stroke="#00000044" stroke-width="1.2"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#dome)"/>`;
  if (total > 0.01) s += `<circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="#fff" opacity="${0.6 * total}" filter="url(#glow)"/>`;
  return s;
}

// 可變電阻（旋轉式）：3 支腳，旋鈕上的白線指出目前位置（往右轉＝pos 變大）
function drawPot(part) {
  const pos = Math.max(0, Math.min(1, part.pos ?? 0.5));
  const cx = 2 * P, cy = -30;
  let s = "";
  for (const x of [0, 2 * P, 4 * P]) {
    s += `<line x1="${x}" y1="0" x2="${x}" y2="-10" stroke="#9aa0a6" stroke-width="2.6"/>`;
    s += `<circle cx="${x}" cy="0" r="3" fill="#9aa0a6"/>`;
  }
  s += `<rect x="-8" y="-54" width="${4 * P + 16}" height="46" rx="4" fill="#5b6b7f" stroke="#2f3a48" stroke-width="1.2"/>`;
  s += `<text x="-3" y="-44" font-size="7" fill="#dfe6ee">${part.ohms >= 1000 ? "B" + part.ohms / 1000 + "K" : "B" + part.ohms}</text>`;
  // 刻度範圍（-135° ～ +135°）
  const arc = (deg, rr) => [cx + rr * Math.sin(deg * Math.PI / 180), cy - rr * Math.cos(deg * Math.PI / 180)];
  const [ax, ay] = arc(-135, 22), [bx, by] = arc(135, 22);
  s += `<path d="M${ax} ${ay} A22 22 0 1 1 ${bx} ${by}" stroke="#c8d1db" stroke-width="1.5" fill="none" stroke-dasharray="2 3"/>`;
  s += `<g class="knob" data-knob="1">`;
  s += `<circle cx="${cx}" cy="${cy}" r="18" fill="#1f1f1f" stroke="#000" stroke-width="1.5"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="14" fill="#2c2c2c"/>`;
  const [kx, ky] = arc(-135 + 270 * pos, 15);
  s += `<line x1="${cx}" y1="${cy}" x2="${kx}" y2="${ky}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
  s += `</g>`;
  return s;
}

// MCP3008：16 腳 DIP，跨在麵包板中間的溝上；晶片上印出每支腳的名稱方便對照
function drawMcp3008(part) {
  const top = MCP3008_PINS.slice(8).reverse();      // 上排左到右：第 16 ～ 9 腳
  let s = "";
  for (let i = 0; i < 8; i++) {
    const x = i * P;
    s += `<rect x="${x - 3}" y="-2" width="6" height="12" fill="url(#metal)"/>`;
    s += `<rect x="${x - 3}" y="${3 * P - 10}" width="6" height="12" fill="url(#metal)"/>`;
  }
  s += `<rect x="-12" y="8" width="${7 * P + 24}" height="${3 * P - 16}" rx="3" fill="#232323" stroke="#000" stroke-width="1"/>`;
  s += `<path d="M-12 ${1.5 * P - 7} A7 7 0 0 1 -12 ${1.5 * P + 7}" fill="#444"/>`;
  s += `<circle cx="0" cy="${3 * P - 16}" r="2.5" fill="#555"/>`;
  s += `<text x="${3.5 * P}" y="${1.5 * P + 4}" font-size="12" font-weight="700" text-anchor="middle" fill="#e8e8e8" letter-spacing="1">MCP3008</text>`;
  top.forEach((name, i) => {
    s += `<text x="${i * P}" y="18" font-size="6.5" text-anchor="middle" fill="#b8b8b8">${name.replace("/SHDN", "")}</text>`;
  });
  for (let i = 0; i < 8; i++) {
    s += `<text x="${i * P}" y="${3 * P - 12}" font-size="6.5" text-anchor="middle" fill="#b8b8b8">CH${i}</text>`;
  }
  return s;
}

export function wirePath(a, b) {
  // 杜邦線稍微下垂的曲線
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return `M${a.x} ${a.y} Q${mx} ${my + Math.min(60, len * 0.18)} ${b.x} ${b.y}`;
}

export function drawWire(wire, { selected = false } = {}) {
  const a = POINTS.get(wire.a), b = POINTS.get(wire.b);
  if (!a || !b) return "";
  const c = WIRE_COLORS[wire.color] || WIRE_COLORS.red;
  const d = wirePath(a, b);
  let s = `<g class="wire${selected ? " selected" : ""}" data-wire="${esc(wire.id)}">`;
  s += `<path d="${d}" stroke="#00000066" stroke-width="7" fill="none" stroke-linecap="round"/>`;
  s += `<path d="${d}" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  s += `<path d="${d}" stroke="transparent" stroke-width="16" fill="none" class="hit"/>`;
  for (const [end, p] of [["a", a], ["b", b]]) {
    s += `<rect x="${p.x - 4}" y="${p.y - 4}" width="8" height="8" rx="1" fill="#1b1b1b" stroke="${c}" stroke-width="2" data-end="${end}" class="end"/>`;
  }
  s += `</g>`;
  return s;
}

// 工具箱的小圖示
export function partIcon(type, opts = {}) {
  const part = { type, x: 0, y: 0, rot: 0, ...opts };
  let body, vb;
  if (type === "led") { body = drawLed(part, null); vb = "-14 -54 48 60"; }
  else if (type === "resistor") { body = drawResistor(part).replace(/<text[^>]*>.*?<\/text>/, ""); vb = "-6 -14 92 28"; }
  else if (type === "rgbled") { body = drawRgbLed(part, null); vb = "-10 -58 80 76"; }
  else if (type === "pot") { body = drawPot({ ohms: 10000, pos: 0.5, ...part }); vb = "-12 -58 104 64"; }
  else if (type === "mcp3008") { body = drawMcp3008(part); vb = "-16 -4 172 68"; }
  else { body = drawButton(part); vb = "-10 -4 60 68"; }
  return `<svg viewBox="${vb}" aria-hidden="true">${drawDefs()}${body}</svg>`;
}
