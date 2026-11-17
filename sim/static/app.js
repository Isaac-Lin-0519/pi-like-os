// ==================================================================
// 虛擬麵包板：畫面與互動
//
//   - 從左邊工具箱把元件拖到麵包板上；元件的腳靠近孔時會自動對齊
//   - 從排針或孔拖到另一個孔就是一條杜邦線（也可以點一下起點、再點一下終點）
//   - 點選元件或線之後：R 旋轉、Delete 刪除、Esc 取消
//   - 按住按鈕＝按下；上下拖曳可變電阻的旋鈕（或用滾輪）調整
//
// 每次電路或腳位狀態改變，就用 circuit.js 重新解一次電路：
//   GPIO 輸出 → 算出 LED 亮度；電路 → 算出輸入腳讀到的電位，經由 WebSocket 送回容器
//   MCP3008 → 各通道的電壓送給伺服器，程式用 SPI 讀取時由伺服器回覆
// ==================================================================

import { simulate, LED_COLORS, RGB_CHANNELS, MCP3008_PINS, MCP3008_TARGET, formatOhms, formatCurrent } from "./circuit.js";
import {
  VIEW, POINTS, PART_TYPES, RESISTOR_VALUES, POT_VALUES, WIRE_COLORS, P, LAYOUT_V1_OFFSET,
  drawDefs, drawPi, drawBreadboard, drawPart, drawWire, wirePath,
  nearestPoint, describePoint, pinsToPoints, pinPositions, snapPart, partIcon,
} from "./board.js";

const svg = document.getElementById("board");
const tip = document.getElementById("tip");

let circuit = { parts: [], wires: [] };
let pins = {};                    // 伺服器傳來的 GPIO 狀態
let sim = null;                   // 最近一次解電路的結果
let selected = null;              // { kind: "part" | "wire", id }
let drag = null;                  // 拖拉中的東西
let wiring = null;                // 正在拉的杜邦線 { from, x, y, sticky }
let hoverPoint = null;
let wireColor = "red";
const pressed = new Set();        // 按住中的按鈕（不存檔）
const floatingLevel = {};         // 浮接的輸入腳目前隨機讀到的值
let lastSent = {};                // 已送給伺服器的輸入電位
let lastAdc = null;               // 已送給伺服器的 MCP3008 狀態
const adcReads = {};              // 程式最近讀取的通道：`${ce}:${ch}` -> { code, time }

const uid = (prefix) => prefix + Math.random().toString(36).slice(2, 8);
const findPart = (id) => circuit.parts.find((p) => p.id === id);
const findWire = (id) => circuit.wires.find((w) => w.id === id);

// ------------------------------------------------------------------
// 畫面
// ------------------------------------------------------------------
svg.setAttribute("viewBox", `0 0 ${VIEW.w} ${VIEW.h}`);
svg.innerHTML = drawDefs() +
  `<rect width="${VIEW.w}" height="${VIEW.h}" fill="var(--canvas)"/>` +
  drawPi() + drawBreadboard() +
  `<g id="layer-gpio"></g><g id="layer-parts"></g><g id="layer-wires"></g><g id="layer-overlay"></g>`;
const layer = {
  gpio: svg.querySelector("#layer-gpio"),
  parts: svg.querySelector("#layer-parts"),
  wires: svg.querySelector("#layer-wires"),
  overlay: svg.querySelector("#layer-overlay"),
};

function circuitForSim() {
  return {
    parts: circuit.parts.map((p) => (p.type === "button" ? { ...p, pressed: pressed.has(p.id) } : p)),
    wires: circuit.wires,
  };
}

function update({ props = true } = {}) {
  sim = simulate(circuitForSim(), pins);
  render();
  renderHints();
  if (props) renderProps();
  syncInputs();
  syncAdc();
}

// 每個元件畫圖時需要的模擬結果
function simFor(p) {
  if (!sim) return null;
  if (p.type === "led") return sim.leds[p.id];
  if (p.type === "rgbled") return Object.fromEntries(RGB_CHANNELS.map((c) => [c.key, sim.leds[`${p.id}:${c.key}`]]));
  return null;
}

function render() {
  layer.parts.innerHTML = circuit.parts.map((p) => drawPart(
    p.type === "button" ? { ...p, pressed: pressed.has(p.id) } : p,
    { selected: selected?.kind === "part" && selected.id === p.id, sim: simFor(p) },
  )).join("");
  layer.wires.innerHTML = circuit.wires.map((w) => drawWire(w, { selected: selected?.kind === "wire" && selected.id === w.id })).join("");
  renderGpio();
  renderOverlay();
}

// 排針上顯示各 GPIO 目前的狀態
function renderGpio() {
  let s = "";
  for (const [gpio, st] of Object.entries(pins)) {
    if (!st || st.mode === "free") continue;
    const phys = sim?.gpio[gpio]?.phys;
    if (!phys) continue;
    const p = POINTS.get(`hdr:${phys}`);
    if (st.mode === "spi") {
      s += `<rect x="${p.x - 7}" y="${p.y - 7}" width="14" height="14" rx="2" fill="none" stroke="#a855f7" stroke-width="2.5"/>`;
    } else if (st.mode === "output") {
      const on = st.pwm ? st.pwm[1] > 0 : st.level;
      s += `<rect x="${p.x - 7}" y="${p.y - 7}" width="14" height="14" rx="2" fill="none" stroke="${on ? "#ff3b30" : "#6b7280"}" stroke-width="2.5"${on ? ' filter="url(#glow)"' : ""}/>`;
    } else {
      s += `<rect x="${p.x - 7}" y="${p.y - 7}" width="14" height="14" rx="2" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-dasharray="${st.level ? "0" : "3 2"}"/>`;
    }
  }
  layer.gpio.innerHTML = s;
}

function renderOverlay() {
  let s = "";
  // 滑鼠所在的孔：把同一個節點（電氣上相通）的所有點都標出來
  if (hoverPoint && sim && !drag) {
    const net = sim.pointNet(hoverPoint);
    for (const [id, p] of POINTS) {
      if (sim.pointNet(id) !== net) continue;
      s += `<circle cx="${p.x}" cy="${p.y}" r="7" fill="none" stroke="#22c55e" stroke-width="2"/>`;
    }
  }
  if (wiring) {
    const a = POINTS.get(wiring.from);
    const target = wiring.over ? POINTS.get(wiring.over) : { x: wiring.x, y: wiring.y };
    s += `<path d="${wirePath(a, target)}" stroke="${WIRE_COLORS[wireColor]}" stroke-width="5" fill="none" stroke-linecap="round" opacity=".75" pointer-events="none"/>`;
    s += `<circle cx="${a.x}" cy="${a.y}" r="7" fill="none" stroke="#22c55e" stroke-width="2.5"/>`;
    if (wiring.over) s += `<circle cx="${target.x}" cy="${target.y}" r="8" fill="none" stroke="#22c55e" stroke-width="2.5"/>`;
  }
  if (drag?.kind === "end") {
    const w = findWire(drag.id);
    const fixed = POINTS.get(drag.end === "a" ? w.b : w.a);
    const target = drag.over ? POINTS.get(drag.over) : { x: drag.x, y: drag.y };
    s += `<path d="${wirePath(fixed, target)}" stroke="${WIRE_COLORS[w.color]}" stroke-width="5" fill="none" opacity=".75" pointer-events="none"/>`;
  }
  layer.overlay.innerHTML = s;
}

// ------------------------------------------------------------------
// 電路提示
// ------------------------------------------------------------------
const LEVEL_ORDER = { danger: 0, warn: 1, info: 2, ok: 3 };
const LEVEL_ICON = { danger: "⛔", warn: "⚠️", info: "💡", ok: "✅" };

function renderHints() {
  const box = document.getElementById("hints");
  const issues = [...(sim?.issues || [])].sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
  if (!circuit.parts.length && !circuit.wires.length) {
    box.innerHTML = `<li class="info">從左邊的工具箱拖一個元件到麵包板上開始吧。不知道怎麼接？可以從上方的「範例電路」選一個。</li>`;
    return;
  }
  if (!issues.length) {
    box.innerHTML = `<li class="ok">${LEVEL_ICON.ok} 沒有發現問題。</li>`;
    return;
  }
  box.innerHTML = issues.map((i) =>
    `<li class="${i.level}"${i.part ? ` data-part="${i.part}"` : ""}>${LEVEL_ICON[i.level]} ${escapeHtml(i.text)}</li>`).join("");
}

document.getElementById("hints").addEventListener("click", (e) => {
  const li = e.target.closest("[data-part]");
  if (li && findPart(li.dataset.part)) { selected = { kind: "part", id: li.dataset.part }; render(); renderProps(); }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// ------------------------------------------------------------------
// 選取的元件：屬性面板
// ------------------------------------------------------------------
function renderProps() {
  const box = document.getElementById("props");
  if (!selected) { box.innerHTML = `<p class="muted">點選麵包板上的元件或線，可以在這裡修改。</p>`; return; }
  if (selected.kind === "wire") {
    const w = findWire(selected.id);
    if (!w) { selected = null; return renderProps(); }
    box.innerHTML = `<h3>杜邦線</h3>
      <p class="muted">${escapeHtml(describePoint(w.a))} ↔ ${escapeHtml(describePoint(w.b))}</p>
      <div class="swatches">${Object.entries(WIRE_COLORS).map(([k, c]) =>
        `<button class="swatch${w.color === k ? " on" : ""}" data-wire-color="${k}" style="background:${c}" aria-label="${k}"></button>`).join("")}</div>
      <div class="row"><button data-action="delete">刪除（Delete）</button></div>`;
    return;
  }
  const p = findPart(selected.id);
  if (!p) { selected = null; return renderProps(); }
  let html = "";
  if (p.type === "led") {
    const r = sim?.leds[p.id];
    html = `<h3>LED</h3>
      <label>顏色 <select data-prop="color">${Object.entries(LED_COLORS).map(([k, c]) =>
        `<option value="${k}"${p.color === k ? " selected" : ""}>${c.name}色（約 ${c.vf}V）</option>`).join("")}</select></label>
      <p class="muted">${r?.on ? `電流 ${formatCurrent(r.current)}` : "目前沒有電流"}</p>`;
  } else if (p.type === "resistor") {
    const r = sim?.resistors[p.id];
    html = `<h3>電阻</h3>
      <label>阻值 <select data-prop="ohms">${RESISTOR_VALUES.map((v) =>
        `<option value="${v}"${p.ohms === v ? " selected" : ""}>${formatOhms(v)}</option>`).join("")}</select></label>
      <p class="muted">電流 ${formatCurrent(Math.abs(r?.current || 0))}</p>`;
  } else if (p.type === "rgbled") {
    html = `<h3>RGB LED</h3>
      <label>種類 <select data-prop="common">
        <option value="cathode"${p.common !== "anode" ? " selected" : ""}>共陰極（共同腳接 GND）</option>
        <option value="anode"${p.common === "anode" ? " selected" : ""}>共陽極（共同腳接 3V3）</option></select></label>
      <p class="muted">腳位（左到右）：紅 R、共同腳（最長）、綠 G、藍 B</p>
      <p class="muted">${RGB_CHANNELS.map((c) => { const r = sim?.leds[`${p.id}:${c.key}`]; return `${c.name} ${r?.on ? formatCurrent(r.current) : "不亮"}`; }).join("、")}</p>`;
  } else if (p.type === "pot") {
    html = `<h3>可變電阻</h3>
      <label>旋鈕 <input type="range" min="0" max="100" step="1" value="${Math.round((p.pos ?? 0.5) * 100)}" data-prop="pos" style="flex:1"></label>
      <p class="muted" id="pot-readout">${potReadout(p)}</p>
      <label>總阻值 <select data-prop="ohms">${POT_VALUES.map((v) =>
        `<option value="${v}"${p.ohms === v ? " selected" : ""}>${formatOhms(v)}</option>`).join("")}</select></label>
      <p class="muted">兩側的腳接 3V3 和 GND，中間腳（滑動端）的電壓就會隨旋鈕在 0～3.3V 之間變化。也可以在麵包板上直接上下拖曳旋鈕。</p>`;
  } else if (p.type === "mcp3008") {
    html = `<h3>MCP3008（10 位元類比轉數位）</h3>${mcpPanel(p)}`;
  } else {
    html = `<h3>按鈕</h3><p class="muted">按住按鈕＝按下。距離較遠的兩支腳（跨過中間溝的那兩支）永遠相通。</p>`;
  }
  const loose = (p.pins || []).filter((x) => !x).length;
  if (loose) html += `<p class="warn-text">有 ${loose} 支腳沒插進孔（紅圈）。</p>`;
  html += `<div class="row"><button data-action="rotate">旋轉（R）</button><button data-action="delete">刪除（Delete）</button></div>`;
  box.innerHTML = html;
}

function potReadout(p) {
  const r = sim?.pots[p.id];
  const v = r?.wiper;
  return `旋鈕 ${Math.round((p.pos ?? 0.5) * 100)}%` + (typeof v === "number" && isFinite(v) && p.pins[1] ? `，中間腳電壓 ${v.toFixed(2)} V` : "");
}

// MCP3008 的屬性面板：接線狀態與各通道的電壓、讀值
function mcpPanel(p) {
  const a = sim?.adc.find((x) => x.id === p.id);
  if (!a) return "";
  let html = `<p class="${a.ok ? "muted" : "warn-text"}">${a.ok ? `接好了：CS 接 CE${a.ce}` : "接線還沒完成（看下方的電路提示）"}</p>`;
  html += `<table class="adc"><tr><th>通道</th><th>電壓</th><th>讀值</th><th>程式讀到</th></tr>`;
  a.channels.forEach((c, i) => {
    const v = c.floating ? (c.connected ? "浮接" : "—") : `${c.voltage.toFixed(2)}V`;
    const code = c.floating ? "—" : c.code;
    html += `<tr><td>CH${i}</td><td>${v}</td><td>${code}</td><td data-adc-read="${a.ce}:${i}">${adcReadText(a.ce, i)}</td></tr>`;
  });
  html += `</table><p class="muted">讀值 ＝ 1024 × 電壓 ÷ VREF（最大 1023）。gpiozero 的 value ＝ 讀值 ÷ 1023。</p>`;
  return html;
}

function adcReadText(ce, ch) {
  const r = ce === null ? null : adcReads[`${ce}:${ch}`];
  return r && Date.now() - r.time < 3000 ? String(r.code) : "";
}

document.getElementById("props").addEventListener("change", (e) => {
  const p = selected?.kind === "part" && findPart(selected.id);
  if (!p) return;
  if (e.target.dataset.prop === "color") p.color = e.target.value;
  if (e.target.dataset.prop === "ohms") p.ohms = Number(e.target.value);
  if (e.target.dataset.prop === "common") p.common = e.target.value;
  if (e.target.dataset.prop === "pos") p.pos = Number(e.target.value) / 100;
  changed();
});
// 拖曳旋鈕滑桿時即時更新（不重畫屬性面板，滑桿才不會被打斷）
document.getElementById("props").addEventListener("input", (e) => {
  const p = selected?.kind === "part" && findPart(selected.id);
  if (!p || e.target.dataset.prop !== "pos") return;
  p.pos = Number(e.target.value) / 100;
  changed({ props: false });
  const out = document.getElementById("pot-readout");
  if (out) out.textContent = potReadout(p);
});
document.getElementById("props").addEventListener("click", (e) => {
  const color = e.target.dataset.wireColor;
  if (color && selected?.kind === "wire") { findWire(selected.id).color = color; wireColor = color; renderWireColors(); changed(); }
  if (e.target.dataset.action === "delete") deleteSelected();
  if (e.target.dataset.action === "rotate") rotateSelected();
});

function deleteSelected() {
  if (!selected) return;
  if (selected.kind === "part") circuit.parts = circuit.parts.filter((p) => p.id !== selected.id);
  else circuit.wires = circuit.wires.filter((w) => w.id !== selected.id);
  selected = null;
  changed();
}

function rotateSelected() {
  const p = selected?.kind === "part" && findPart(selected.id);
  if (!p) return;
  p.rot = ((p.rot || 0) + 1) % 4;
  p.pins = pinsToPoints(p);
  changed();
}

// ------------------------------------------------------------------
// 工具箱
// ------------------------------------------------------------------
const TOOLBOX = [
  { type: "led", color: "red", label: "LED 紅" },
  { type: "led", color: "green", label: "LED 綠" },
  { type: "led", color: "yellow", label: "LED 黃" },
  { type: "led", color: "blue", label: "LED 藍" },
  { type: "rgbled", common: "cathode", label: "RGB LED" },
  { type: "button", label: "按鈕" },
  { type: "pot", ohms: 10000, pos: 0.5, label: "可變電阻" },
  { type: "mcp3008", label: "MCP3008", wide: true },
  ...RESISTOR_VALUES.map((ohms) => ({ type: "resistor", ohms, label: `電阻 ${formatOhms(ohms)}` })),
];
// 從工具箱拖出來時，游標抓住元件的哪個位置（相對於元件的原點）
const GRAB = {
  led: { x: P / 2, y: -20 }, resistor: { x: 2 * P, y: 0 }, button: { x: P, y: 1.5 * P },
  rgbled: { x: 1.5 * P, y: -24 }, pot: { x: 2 * P, y: -30 }, mcp3008: { x: 3.5 * P, y: 1.5 * P },
};

const toolbox = document.getElementById("toolbox");
toolbox.innerHTML = TOOLBOX.map((t, i) =>
  `<button class="tool${t.wide ? " wide" : ""}" data-tool="${i}" title="拖到麵包板上">${partIcon(t.type, t)}<span>${t.label}</span></button>`).join("");

toolbox.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest("[data-tool]");
  if (!btn) return;
  e.preventDefault();
  const t = TOOLBOX[Number(btn.dataset.tool)];
  const pos = toSvg(e);
  const part = { id: uid(t.type), type: t.type, x: pos.x - GRAB[t.type].x, y: pos.y - GRAB[t.type].y, rot: 0 };
  if (t.color) part.color = t.color;
  if (t.ohms) part.ohms = t.ohms;
  if (t.common) part.common = t.common;
  if (t.pos !== undefined) part.pos = t.pos;
  part.pins = pinsToPoints(part);
  circuit.parts.push(part);
  selected = { kind: "part", id: part.id };
  drag = { kind: "part", id: part.id, grabX: GRAB[t.type].x, grabY: GRAB[t.type].y, fromToolbox: true, moved: true, sx: e.clientX, sy: e.clientY };
  document.body.classList.add("dragging");
  update();
});

function renderWireColors() {
  document.getElementById("wire-colors").innerHTML = Object.entries(WIRE_COLORS).map(([k, c]) =>
    `<button class="swatch${wireColor === k ? " on" : ""}" data-color="${k}" style="background:${c}" aria-label="${k}"></button>`).join("");
}
document.getElementById("wire-colors").addEventListener("click", (e) => {
  if (e.target.dataset.color) { wireColor = e.target.dataset.color; renderWireColors(); }
});

// ------------------------------------------------------------------
// 滑鼠／觸控
// ------------------------------------------------------------------
function toSvg(e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function insideSvg(e) {
  const r = svg.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

svg.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  // 剛剛在下拉選單改過阻值的話，焦點還留在選單上，要放掉，R／Delete 才會作用在麵包板上
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  hideTip();
  const pos = toSvg(e);
  const partEl = e.target.closest("[data-part]");
  const wireEl = e.target.closest("[data-wire]");

  // 拉線中（點一下起點的模式）：點到另一個點就完成
  if (wiring?.sticky) {
    const end = nearestPoint(pos.x, pos.y);
    if (end && end !== wiring.from) addWire(wiring.from, end);
    wiring = null;
    renderOverlay();
    return;
  }

  // 可變電阻的旋鈕：上下拖曳調整
  const knobEl = e.target.closest("[data-knob]");
  if (knobEl && partEl) {
    const part = findPart(partEl.dataset.part);
    selected = { kind: "part", id: part.id };
    drag = { kind: "knob", id: part.id, sy: e.clientY, start: part.pos ?? 0.5 };
    document.body.classList.add("dragging");
    update();
    return;
  }

  if (wireEl && e.target.classList.contains("end")) {
    const w = findWire(wireEl.dataset.wire);
    selected = { kind: "wire", id: w.id };
    drag = { kind: "end", id: w.id, end: e.target.dataset.end, x: pos.x, y: pos.y, over: null };
    update();
    return;
  }
  if (partEl) {
    const part = findPart(partEl.dataset.part);
    selected = { kind: "part", id: part.id };
    drag = { kind: "part", id: part.id, grabX: pos.x - part.x, grabY: pos.y - part.y, moved: false, sx: e.clientX, sy: e.clientY };
    if (part.type === "button") pressed.add(part.id);
    update();
    return;
  }
  if (wireEl) {
    selected = { kind: "wire", id: wireEl.dataset.wire };
    update();
    return;
  }
  const point = nearestPoint(pos.x, pos.y);
  if (point) {
    wiring = { from: point, x: pos.x, y: pos.y, over: null, sticky: false };
    selected = null;
    update();
    return;
  }
  selected = null;
  update();
});

window.addEventListener("pointermove", (e) => {
  const pos = toSvg(e);
  if (drag?.kind === "knob") {
    const part = findPart(drag.id);
    const v = Math.max(0, Math.min(1, drag.start + (drag.sy - e.clientY) / 150));
    if (v !== part.pos) { part.pos = v; changed(); }
    return;
  }
  if (drag?.kind === "part") {
    const part = findPart(drag.id);
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) {
      drag.moved = true;
      if (pressed.delete(part.id)) update();
    }
    if (!drag.moved) return;
    const snapped = snapPart(part, pos.x - drag.grabX, pos.y - drag.grabY);
    if (snapped.x !== part.x || snapped.y !== part.y) {
      part.x = snapped.x; part.y = snapped.y;
      part.pins = pinsToPoints(part);
      update();
    }
    return;
  }
  if (drag?.kind === "end") {
    drag.x = pos.x; drag.y = pos.y;
    drag.over = nearestPoint(pos.x, pos.y);
    renderOverlay();
    return;
  }
  if (wiring) {
    wiring.x = pos.x; wiring.y = pos.y;
    const over = nearestPoint(pos.x, pos.y);
    wiring.over = over && over !== wiring.from ? over : null;
    renderOverlay();
    return;
  }
  // 沒有在拖拉：顯示滑鼠所在位置的說明
  if (!insideSvg(e)) { if (hoverPoint) { hoverPoint = null; renderOverlay(); } hideTip(); return; }
  const partEl = e.target.closest?.("[data-part]");
  const point = partEl ? null : nearestPoint(pos.x, pos.y, 9);
  if (point !== hoverPoint) { hoverPoint = point; renderOverlay(); }
  if (point) showTip(e, pointTip(point));
  else if (partEl) showTip(e, partTip(findPart(partEl.dataset.part), pos));
  else hideTip();
});

window.addEventListener("pointerup", (e) => {
  document.body.classList.remove("dragging");
  if (drag?.kind === "knob") { drag = null; update(); return; }
  if (drag?.kind === "part") {
    const part = findPart(drag.id);
    if (pressed.delete(part.id)) update();
    if (drag.fromToolbox && !insideSvg(e)) {
      circuit.parts = circuit.parts.filter((p) => p.id !== part.id);
      selected = null;
    }
    const moved = drag.moved;
    drag = null;
    if (moved) changed(); else update();
    return;
  }
  if (drag?.kind === "end") {
    const w = findWire(drag.id);
    const other = drag.end === "a" ? w.b : w.a;
    if (drag.over && drag.over !== other) { w[drag.end] = drag.over; drag = null; changed(); }
    else { drag = null; renderOverlay(); }
    return;
  }
  if (wiring) {
    const pos = toSvg(e);
    const end = nearestPoint(pos.x, pos.y);
    if (end && end !== wiring.from) { addWire(wiring.from, end); wiring = null; }
    else if (end === wiring.from && !wiring.sticky) wiring.sticky = true;   // 只點了一下：等第二下
    else wiring = null;
    renderOverlay();
  }
});

// 滑鼠滾輪轉動旋鈕
svg.addEventListener("wheel", (e) => {
  const partEl = e.target.closest?.("[data-part]");
  const part = partEl && findPart(partEl.dataset.part);
  if (!part || part.type !== "pot") return;
  e.preventDefault();
  part.pos = Math.max(0, Math.min(1, (part.pos ?? 0.5) - Math.sign(e.deltaY) * 0.02));
  changed();
  showTip(e, partTip(part, toSvg(e)));
}, { passive: false });

window.addEventListener("keydown", (e) => {
  if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); }
  else if (e.key === "r" || e.key === "R") rotateSelected();
  else if (e.key === "Escape") { wiring = null; drag = null; selected = null; update(); }
});

function addWire(a, b) {
  const w = { id: uid("w"), a, b, color: wireColor };
  circuit.wires.push(w);
  selected = { kind: "wire", id: w.id };
  changed();
}

function pointTip(id) {
  let text = describePoint(id);
  const v = sim?.voltageOf(id);
  if (typeof v === "number" && isFinite(v) && sim.used.has(id)) text += `\n電壓 ${v.toFixed(2)} V`;
  const p = POINTS.get(id);
  if (p.kind === "header") {
    const g = Object.values(sim?.gpio || {}).find((x) => x.phys === p.phys);
    if (g) {
      const st = pins[g.gpio];
      text += `\n${!st || st.mode === "free" ? "程式沒有使用" : st.mode === "spi" ? "SPI 使用中" : st.mode === "output" ? "程式設為輸出" : "程式設為輸入"}`;
      if (g.mode !== "output" && g.mode !== "spi" && g.connected) text += `，讀到 ${g.floating ? "不確定（浮接）" : g.level}`;
    }
  }
  return text + "\n（綠圈＝與這裡相通的點）";
}

// 滑鼠所在位置最靠近元件的哪一支腳
function nearestPin(part, pos) {
  let best = -1, bestD = Infinity;
  pinPositions(part).forEach((q, i) => {
    const d = (q.x - pos.x) ** 2 + (q.y - pos.y) ** 2;
    if (d < bestD) { best = i; bestD = d; }
  });
  return best;
}

function partTip(part, pos) {
  if (!part) return "";
  if (part.type === "mcp3008") {
    const i = nearestPin(part, pos);
    const num = i + 1;
    let text = `MCP3008 第 ${num} 腳：${MCP3008_PINS[i]}`;
    if (MCP3008_TARGET[num]) text += `\n要接 ${MCP3008_TARGET[num]}`;
    else text += `\n類比輸入（0～VREF），例如接可變電阻的中間腳`;
    const a = sim?.adc.find((x) => x.id === part.id);
    const c = i < 8 ? a?.channels[i] : null;
    if (c && !c.floating) text += `\n現在 ${c.voltage.toFixed(2)}V → 讀值 ${c.code}`;
    return text + "\n（缺口在左邊；第 1 腳在左下角）";
  }
  if (part.type === "pot") {
    return `可變電阻 ${formatOhms(part.ohms)}\n${potReadout(part)}\n上下拖曳旋鈕、或用滑鼠滾輪調整`;
  }
  if (part.type === "rgbled") {
    const i = pos ? nearestPin(part, pos) : -1;
    const kind = part.common === "anode" ? "共陽極" : "共陰極";
    return `RGB LED（${kind}）\n腳位：紅 R、共同腳（最長）、綠 G、藍 B` + (i >= 0 ? `\n這支是：${PART_TYPES.rgbled.pins[i].name}` : "");
  }
  if (part.type === "led") {
    const r = sim?.leds[part.id];
    return `LED（${LED_COLORS[part.color]?.name}）\n長腳＋在左、短腳－在右\n${r?.on ? `電流 ${formatCurrent(r.current)}` : "沒有電流"}`;
  }
  if (part.type === "resistor") {
    const r = sim?.resistors[part.id];
    return `電阻 ${formatOhms(part.ohms)}\n電流 ${formatCurrent(Math.abs(r?.current || 0))}`;
  }
  return "按鈕（按住＝按下）";
}

function showTip(e, text) {
  tip.textContent = text;
  tip.hidden = false;
  const wrap = svg.parentElement.getBoundingClientRect();
  let x = e.clientX - wrap.left + 14, y = e.clientY - wrap.top + 14;
  x = Math.min(x, wrap.width - tip.offsetWidth - 4);
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${y}px`;
}
function hideTip() { tip.hidden = true; }

// ------------------------------------------------------------------
// 電路存檔與同步（存在伺服器上，重新整理或換分頁都還在）
// ------------------------------------------------------------------
let saveTimer = null;
function changed(opts) {
  update(opts);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => send({ type: "circuit", circuit: serialize() }), 300);
}

// version 2：標準尺寸麵包板、Pi 在下面（version 1 是半尺寸麵包板、Pi 在左邊）
const CIRCUIT_VERSION = 2;

function serialize() {
  return {
    version: CIRCUIT_VERSION,
    parts: circuit.parts.map(({ id, type, x, y, rot, color, ohms, pos, common }) => ({ id, type, x, y, rot, color, ohms, pos, common })),
    wires: circuit.wires.map(({ id, a, b, color }) => ({ id, a, b, color })),
  };
}

function load(data) {
  const parts = (data?.parts || []).filter((p) => PART_TYPES[p.type]).map((p) => ({ ...p }));
  // 舊版存檔：孔的編號沒變，只要把元件平移到新版麵包板上同一個孔
  if ((data?.version ?? 1) < 2) {
    for (const p of parts) { p.x += LAYOUT_V1_OFFSET.x; p.y += LAYOUT_V1_OFFSET.y; }
  }
  for (const p of parts) p.pins = pinsToPoints(p);
  const wires = (data?.wires || []).filter((w) => POINTS.has(w.a) && POINTS.has(w.b)).map((w) => ({ ...w }));
  circuit = { parts, wires };
  if (selected && !(selected.kind === "part" ? findPart(selected.id) : findWire(selected.id))) selected = null;
  update();
}

// 範例電路（孔的編號：bb:a10 是 a 列第 11 行，程式裡從 0 開始數）
const at = (id) => { const p = POINTS.get(id); return { x: p.x, y: p.y }; };
const part = (id, type, hole, extra = {}) => ({ id, type, rot: 0, ...at(hole), ...extra });
const wire = (id, a, b, color) => ({ id, a, b, color });

const EXAMPLES = {
  // 基本的 GPIO18 LED
  led: () => ({
    parts: [
      part("r1", "resistor", "bb:b9", { ohms: 220 }),
      part("led1", "led", "bb:e13", { color: "red" }),
    ],
    wires: [wire("w1", "hdr:12", "bb:a9", "yellow"), wire("w2", "bb:a14", "hdr:6", "black")],
  }),
  // 三段旋鈕儀表：可變電阻 → MCP3008 CH0；紅 GPIO17、綠 GPIO27、黃 GPIO22（各串 1kΩ）
  meter: () => ({
    parts: [
      part("r1", "resistor", "bb:b2", { ohms: 1000 }), part("led1", "led", "bb:e6", { color: "red" }),
      part("r2", "resistor", "bb:b10", { ohms: 1000 }), part("led2", "led", "bb:e14", { color: "green" }),
      part("r3", "resistor", "bb:b18", { ohms: 1000 }), part("led3", "led", "bb:e22", { color: "yellow" }),
      part("adc", "mcp3008", "bb:e30"),
      part("pot", "pot", "bb:e44", { ohms: 10000, pos: 0.5 }),
    ],
    wires: [
      wire("w1", "hdr:1", "bb:top+:0", "red"), wire("w2", "hdr:6", "bb:top-:1", "black"),
      wire("w3", "hdr:11", "bb:a2", "orange"), wire("w4", "bb:a7", "bb:top-:7", "black"),
      wire("w5", "hdr:13", "bb:a10", "green"), wire("w6", "bb:a15", "bb:top-:15", "black"),
      wire("w7", "hdr:15", "bb:a18", "yellow"), wire("w8", "bb:a23", "bb:top-:24", "black"),
      wire("w9", "bb:a30", "bb:top+:30", "red"), wire("w10", "bb:a31", "bb:top+:31", "red"),
      wire("w11", "bb:a32", "bb:top-:32", "black"), wire("w12", "bb:a33", "hdr:23", "orange"),
      wire("w13", "bb:a34", "hdr:21", "blue"), wire("w14", "bb:a35", "hdr:19", "green"),
      wire("w15", "bb:a36", "hdr:24", "yellow"), wire("w16", "bb:a37", "bb:top-:37", "black"),
      wire("w17", "bb:a44", "bb:top-:44", "black"), wire("w18", "bb:a48", "bb:top+:48", "red"),
      wire("w19", "bb:a46", "bb:h30", "purple"),
    ],
  }),
  // RGB 三原色混色：R GPIO17、G GPIO27、B GPIO22（各串 1kΩ，共陰極接 GND）；
  // 按鈕 A／B／C：GPIO5／6／13 → 1kΩ → 按鈕 → GND
  rgb: () => ({
    parts: [
      part("rgb", "rgbled", "bb:f20", { common: "cathode" }),
      part("rr", "resistor", "bb:h16", { ohms: 1000 }),
      part("rg", "resistor", "bb:i18", { ohms: 1000 }),
      part("rb", "resistor", "bb:j19", { ohms: 1000 }),
      part("ra", "resistor", "bb:c36", { ohms: 1000 }), part("ba", "button", "bb:e40"),
      part("rb2", "resistor", "bb:c46", { ohms: 1000 }), part("bb", "button", "bb:e50"),
      part("rc", "resistor", "bb:c56", { ohms: 1000 }), part("bc", "button", "bb:e60"),
    ],
    wires: [
      wire("w1", "hdr:39", "bb:bot-:1", "black"),
      wire("w2", "hdr:11", "bb:f16", "red"), wire("w3", "hdr:13", "bb:f18", "green"),
      wire("w4", "hdr:15", "bb:f19", "blue"), wire("w5", "bb:g21", "bb:bot-:21", "black"),
      wire("w6", "hdr:29", "bb:a36", "yellow"), wire("w7", "bb:j42", "bb:bot-:42", "black"),
      wire("w8", "hdr:31", "bb:a46", "white"), wire("w9", "bb:j52", "bb:bot-:52", "black"),
      wire("w10", "hdr:33", "bb:a56", "orange"), wire("w11", "bb:j62", "bb:bot-:62", "black"),
    ],
  }),
};

document.getElementById("example-select").addEventListener("change", (e) => {
  const make = EXAMPLES[e.target.value];
  e.target.value = "";
  if (!make) return;
  if ((circuit.parts.length || circuit.wires.length) && !confirm("要用範例電路取代目前的電路嗎？")) return;
  load({ version: CIRCUIT_VERSION, ...make() }); changed();
});
document.getElementById("btn-clear").addEventListener("click", () => {
  if (!confirm("確定要清空麵包板嗎？")) return;
  load({ parts: [], wires: [] }); changed();
});
document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "麵包板電路.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById("btn-import").addEventListener("click", () => document.getElementById("file-import").click());
document.getElementById("file-import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  try { load(JSON.parse(await file.text())); changed(); }
  catch { alert("這個檔案不是麵包板電路檔。"); }
});

// ------------------------------------------------------------------
// 輸入腳：把電路算出來的電位送回容器
//
// 讀到的值跟程式設定的上拉／下拉有關，所以「上拉、下拉、不拉」三種情況各算一次一起送出，
// 伺服器再依程式實際的設定挑一個。這樣程式一改設定，馬上就讀到正確的值。
// ------------------------------------------------------------------
const floatingNone = new Set();       // 「不拉」時會浮接的輸入腳

function levelsFor(gpio) {
  const out = {};
  for (const pull of ["up", "down", "none"]) {
    const r = simulate(circuitForSim(), { ...pins, [gpio]: { ...(pins[gpio] || {}), mode: "input", pull } }).gpio[gpio];
    if (pull === "none" && r.floating) {
      floatingNone.add(gpio);
      out.none = floatingLevel[gpio] ?? 0;
    } else {
      out[pull] = r.level;
    }
  }
  return out;
}

function syncInputs() {
  if (!sim) return;
  floatingNone.clear();
  for (const [g, r] of Object.entries(sim.gpio)) {
    if (r.mode === "output") continue;
    const want = r.connected ? levelsFor(Number(g)) : null;
    const key = JSON.stringify(want);
    if (lastSent[g] !== key) {
      lastSent[g] = key;
      send({ type: "set_input", gpio: Number(g), level: want });
    }
  }
}

// ------------------------------------------------------------------
// MCP3008：把各通道的電壓送給伺服器（程式用 SPI 讀取時由伺服器回覆）
// 每個 CE 只算第一顆接好的晶片；沒接好的晶片不回應，程式讀到的是 0
// ------------------------------------------------------------------
function syncAdc() {
  if (!sim) return;
  const devices = {};
  for (const a of sim.adc) {
    if (!a.ok || a.ce === null || devices[a.ce]) continue;
    devices[a.ce] = { vref: +a.vref.toFixed(4), ch: a.channels.map((c) => (c.floating ? null : +c.voltage.toFixed(4))) };
  }
  const key = JSON.stringify(devices);
  if (key !== lastAdc) { lastAdc = key; send({ type: "adc", devices }); }
}

function onAdcRead(msg) {
  if (!msg.single) return;
  const key = `${msg.ce}:${msg.ch}`;
  adcReads[key] = { code: msg.code, time: Date.now() };
  const cell = document.querySelector(`[data-adc-read="${key}"]`);
  if (cell) cell.textContent = String(msg.code);
}
// 超過 3 秒沒有再讀的通道，清掉「程式讀到」的數字
setInterval(() => {
  for (const cell of document.querySelectorAll("[data-adc-read]")) {
    const [ce, ch] = cell.dataset.adcRead.split(":");
    cell.textContent = adcReadText(ce === "null" ? null : Number(ce), Number(ch));
  }
}, 1000);

// 浮接的輸入腳讀值會亂跳（真機也是如此）
setInterval(() => {
  if (!floatingNone.size) return;
  for (const g of floatingNone) floatingLevel[g] = Math.random() < 0.5 ? 0 : 1;
  syncInputs();
}, 400);

// ------------------------------------------------------------------
// 執行中的程式、腳位紀錄
// ------------------------------------------------------------------
function renderPrograms(list) {
  const ul = document.getElementById("programs");
  ul.innerHTML = list.length
    ? list.map((p) => `<li>pid ${p.pid ?? "?"}：python ${escapeHtml((p.argv || []).join(" "))}</li>`).join("")
    : `<li class="muted">目前沒有程式在使用 GPIO</li>`;
}

const lastChange = {};
let logEmpty = true;
function describePin(p) {
  if (p.mode === "free") return "未使用";
  if (p.mode === "spi") return "SPI 使用中";
  if (p.mode === "output") {
    if (p.pwm) return `PWM ${p.pwm[0]}Hz，工作週期 ${+p.pwm[1].toFixed(1)}%`;
    return p.level ? "輸出高電位（3.3V）" : "輸出低電位（0V）";
  }
  return `輸入，讀到 ${p.level}`;
}
function addLog(time, p) {
  const box = document.getElementById("log");
  if (logEmpty) { box.innerHTML = ""; logEmpty = false; }
  const t = new Date(time * 1000);
  const stamp = t.toLocaleTimeString("zh-TW", { hour12: false }) + "." + String(t.getMilliseconds()).padStart(3, "0");
  const prev = lastChange[p.gpio];
  const row = document.createElement("div");
  row.textContent = `${stamp}  GPIO${p.gpio} → ${describePin(p)}` + (prev ? `（前一狀態 ${(time - prev).toFixed(2)} 秒）` : "");
  if (p.mode === "output" && p.level) row.className = "on";
  box.prepend(row);
  while (box.childElementCount > 200) box.lastElementChild.remove();
  lastChange[p.gpio] = time;
}

// ------------------------------------------------------------------
// WebSocket
// ------------------------------------------------------------------
let ws = null;
function send(msg) { if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); }

function connect() {
  const status = document.getElementById("status");
  ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
  ws.onopen = () => { status.textContent = "已連線"; status.className = "status ok"; lastSent = {}; lastAdc = null; };
  ws.onclose = () => {
    status.textContent = "連線中斷，重新連線中…"; status.className = "status bad";
    setTimeout(connect, 1000);
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "snapshot") {
      pins = {};
      for (const p of msg.pins) pins[p.gpio] = p;
      renderPrograms(msg.programs);
      load(msg.circuit);
    } else if (msg.type === "pin") {
      const p = msg.pin, old = pins[p.gpio];
      pins[p.gpio] = p;
      const changedState = !old || old.mode !== p.mode || old.level !== p.level || JSON.stringify(old.pwm) !== JSON.stringify(p.pwm);
      if (changedState && (p.mode !== "free" || (old && old.mode !== "free"))) addLog(msg.time, p);
      if (changedState || old?.pull !== p.pull) update();
    } else if (msg.type === "adc_read") {
      onAdcRead(msg);
    } else if (msg.type === "programs") {
      renderPrograms(msg.programs);
    } else if (msg.type === "circuit") {
      if (!drag) load(msg.circuit);       // 別的分頁改了電路
    }
  };
}

renderWireColors();
renderPrograms([]);
update();
connect();
