// 電路求解器的測試：node sim/tests/circuit.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { simulate } from "../static/circuit.js";
import { setLang, dictKeys, LANGS } from "../static/i18n.js";

// GPIO18 = 實體腳位 12；GND = 實體腳位 6；3V3 = 1；5V = 2；GPIO17 = 11
const out18 = (level, pwm = null) => ({ 18: { mode: "output", level, pull: "none", pwm } });
const wire = (id, a, b) => ({ id, a, b });

// 基本接法：GPIO18 → 電阻（a10–a14）→ LED 長腳 c14、短腳 c15 → GND
function classic(ohms, { reversed = false, color = "red" } = {}) {
  return {
    wires: [wire("w1", "hdr:12", "bb:a10"), wire("w2", "hdr:6", "bb:e15")],
    parts: [
      { id: "r1", type: "resistor", ohms, pins: ["bb:b10", "bb:b14"] },
      { id: "led1", type: "led", color, pins: reversed ? ["bb:c15", "bb:c14"] : ["bb:c14", "bb:c15"] },
    ],
  };
}

const tests = {
  "220Ω：亮，約 5mA，有估算公式"() {
    const s = simulate(classic(220), out18(1));
    const led = s.leds.led1;
    assert.ok(led.on);
    assert.ok(led.current > 4e-3 && led.current < 6e-3, `電流 ${led.current}`);
    const hint = s.issues.find((i) => i.part === "led1");
    assert.equal(hint.level, "ok");
    assert.match(hint.text, /3\.3V − 2V\) ÷ 220Ω ≈ 5\.9mA/);
  },
  "GPIO 低電位：不亮"() {
    const s = simulate(classic(220), out18(0));
    assert.ok(!s.leds.led1.on);
  },
  "1kΩ 比 220Ω 暗"() {
    const a = simulate(classic(220), out18(1)).leds.led1.brightness;
    const b = simulate(classic(1000), out18(1)).leds.led1.brightness;
    assert.ok(b < a && b > 0.3, `${a} ${b}`);
  },
  "1MΩ：幾乎不亮"() {
    const s = simulate(classic(1e6), out18(1));
    assert.ok(s.leds.led1.brightness < 0.1, `${s.leds.led1.brightness}`);
    assert.equal(s.issues.find((i) => i.part === "led1").level, "info");
  },
  "LED 接反：不亮並提示"() {
    const s = simulate(classic(220, { reversed: true }), out18(1));
    assert.ok(!s.leds.led1.on);
    assert.match(s.issues.find((i) => i.part === "led1").text, /接反/);
  },
  "沒接電阻：警告"() {
    const c = {
      wires: [wire("w1", "hdr:12", "bb:a14"), wire("w2", "hdr:6", "bb:e15")],
      parts: [{ id: "led1", type: "led", color: "red", pins: ["bb:c14", "bb:c15"] }],
    };
    const s = simulate(c, out18(1));
    assert.ok(s.leds.led1.current > 16e-3);
    assert.match(s.issues.find((i) => i.part === "led1").text, /沒有接限流電阻/);
  },
  "藍色 LED 接 3.3V + 220Ω：很暗"() {
    const s = simulate(classic(220, { color: "blue" }), out18(1));
    assert.ok(s.leds.led1.current < 1.5e-3, `${s.leds.led1.current}`);
  },
  "LED 兩腳在同一排：被短路"() {
    const c = classic(220);
    c.parts[1].pins = ["bb:c14", "bb:d14"];
    const s = simulate(c, out18(1));
    assert.ok(!s.leds.led1.on);
    assert.match(s.issues.find((i) => i.part === "led1").text, /同一排/);
  },
  "電阻放在陰極側也能估算"() {
    const c = {
      wires: [wire("w1", "hdr:12", "bb:a14"), wire("w2", "hdr:6", "bb:a19")],
      parts: [
        { id: "led1", type: "led", color: "red", pins: ["bb:c14", "bb:c15"] },
        { id: "r1", type: "resistor", ohms: 330, pins: ["bb:b15", "bb:b19"] },
      ],
    };
    const s = simulate(c, out18(1));
    assert.ok(s.leds.led1.on);
    assert.match(s.issues.find((i) => i.part === "led1").text, /÷ 330Ω/);
  },
  "PWM 50%：亮度變低"() {
    const full = simulate(classic(220), out18(1)).leds.led1.brightness;
    const half = simulate(classic(220), out18(1, [100, 10])).leds.led1.brightness;
    assert.ok(half < full, `${full} ${half}`);
  },
  "3V3 → 電阻 → LED → GND：不靠程式也會亮"() {
    const c = classic(330);
    c.wires[0] = wire("w1", "hdr:1", "bb:a10");
    const s = simulate(c, {});
    assert.ok(s.leds.led1.on);
  },
  "按鈕接 GND、程式用上拉：按下讀到 0、放開讀到 1"() {
    // 按鈕跨中間的溝：腳 0=e20、1=f20（永遠相通）、2=e22、3=f22（永遠相通）
    const c = (pressed) => ({
      wires: [wire("w1", "hdr:11", "bb:a20"), wire("w2", "hdr:9", "bb:a22")],
      parts: [{ id: "b1", type: "button", pressed, pins: ["bb:e20", "bb:f20", "bb:e22", "bb:f22"] }],
    });
    const pins = { 17: { mode: "alert", level: 1, pull: "up", pwm: null } };
    assert.equal(simulate(c(false), pins).gpio[17].level, 1);
    assert.equal(simulate(c(true), pins).gpio[17].level, 0);
  },
  "按鈕接 3V3、程式卻用上拉：按了也一直是 1"() {
    const c = (pressed) => ({
      wires: [wire("w1", "hdr:11", "bb:a20"), wire("w2", "hdr:1", "bb:a22")],
      parts: [{ id: "b1", type: "button", pressed, pins: ["bb:e20", "bb:f20", "bb:e22", "bb:f22"] }],
    });
    const pins = { 17: { mode: "alert", level: 1, pull: "up", pwm: null } };
    assert.equal(simulate(c(false), pins).gpio[17].level, 1);
    assert.equal(simulate(c(true), pins).gpio[17].level, 1);
  },
  "輸入沒有上下拉、按鈕放開：浮接警告"() {
    const c = {
      wires: [wire("w1", "hdr:11", "bb:a20"), wire("w2", "hdr:9", "bb:a22")],
      parts: [{ id: "b1", type: "button", pressed: false, pins: ["bb:e20", "bb:f20", "bb:e22", "bb:f22"] }],
    };
    const s = simulate(c, { 17: { mode: "input", level: 0, pull: "none", pwm: null } });
    assert.ok(s.gpio[17].floating);
    assert.ok(s.issues.some((i) => /浮接/.test(i.text)));
  },
  "GPIO 輸出高電位直接接 GND：短路"() {
    const c = { wires: [wire("w1", "hdr:12", "hdr:14")], parts: [] };
    const s = simulate(c, out18(1));
    assert.ok(s.issues.some((i) => /短路/.test(i.text)));
  },
  "3V3 直接接 GND：短路"() {
    const c = { wires: [wire("w1", "hdr:1", "bb:a1"), wire("w2", "hdr:6", "bb:b1")], parts: [] };
    assert.ok(simulate(c, {}).issues.some((i) => /3V3 直接接到 GND/.test(i.text)));
  },
  "5V 接到 GPIO 輸入：燒壞警告"() {
    const c = { wires: [wire("w1", "hdr:2", "hdr:11")], parts: [] };
    const s = simulate(c, { 17: { mode: "input", level: 0, pull: "none", pwm: null } });
    assert.ok(s.issues.some((i) => /燒壞樹莓派/.test(i.text)));
  },
  "電源軌：3V3 接上軌 +、GND 接上軌 −"() {
    const c = {
      wires: [wire("w1", "hdr:1", "bb:top+:0"), wire("w2", "hdr:6", "bb:top-:28")],
      parts: [
        { id: "r1", type: "resistor", ohms: 220, pins: ["bb:top+:7", "bb:a7"] },
        { id: "led1", type: "led", color: "green", pins: ["bb:c7", "bb:c8"] },
        { id: "r2", type: "resistor", ohms: 0.001, pins: ["bb:a8", "bb:top-:8"] },
      ],
    };
    assert.ok(simulate(c, {}).leds.led1.on);
  },
  "標準麵包板：第 63 行（bb:a62）也能用"() {
    const c = {
      wires: [wire("w1", "hdr:12", "bb:a58"), wire("w2", "hdr:6", "bb:e62")],
      parts: [
        { id: "r1", type: "resistor", ohms: 220, pins: ["bb:b58", "bb:b62"] },
        { id: "led1", type: "led", color: "red", pins: ["bb:c62", "bb:c63"] },
      ],
    };
    // c63 不存在（只有 0～62），LED 有一支腳沒插好
    const s = simulate(c, out18(1));
    assert.ok(!s.leds.led1.on);
    c.parts[0].pins = ["bb:b57", "bb:b61"]; c.parts[1].pins = ["bb:c61", "bb:c62"];
    c.wires = [wire("w1", "hdr:12", "bb:a57"), wire("w2", "hdr:6", "bb:e62")];
    assert.ok(simulate(c, out18(1)).leds.led1.on);
  },
  "可變電阻：兩側接 3V3／GND，中間腳電壓跟著旋鈕走"() {
    const c = (pos) => ({
      wires: [wire("w1", "hdr:1", "bb:a0"), wire("w2", "hdr:6", "bb:a4")],
      parts: [{ id: "pot", type: "pot", ohms: 10000, pos, pins: ["bb:e4", "bb:e2", "bb:e0"] }],
    });
    // 腳 1 接 GND（第 4 行）、腳 3 接 3V3（第 0 行）
    for (const pos of [0, 0.25, 0.5, 1]) {
      const s = simulate(c(pos), {});
      assert.ok(Math.abs(s.pots.pot.wiper - 3.3 * pos) < 0.01, `pos ${pos} → ${s.pots.pot.wiper}`);
    }
  },
  "可變電阻：中間腳直接接 3V3，轉到底會短路"() {
    const c = {
      wires: [wire("w1", "hdr:1", "bb:a2"), wire("w2", "hdr:6", "bb:a0")],
      parts: [{ id: "pot", type: "pot", ohms: 10000, pos: 0, pins: ["bb:e0", "bb:e2", "bb:e4"] }],
    };
    assert.ok(simulate(c, {}).issues.some((i) => i.level === "danger" && /可變電阻/.test(i.text)));
  },
  "RGB LED 共陰極：紅、藍亮，綠沒輸出"() {
    const s = simulate(rgbCircuit("cathode"), {
      17: { mode: "output", level: 1, pull: "none", pwm: null },
      27: { mode: "output", level: 0, pull: "none", pwm: null },
      22: { mode: "output", level: 1, pull: "none", pwm: null },
    });
    assert.ok(s.leds["rgb:r"].on && s.leds["rgb:b"].on && !s.leds["rgb:g"].on);
    // 藍色順向電壓約 3V，1kΩ 時電流很小（約 0.3mA）但看得到
    assert.ok(s.leds["rgb:b"].current < 0.5e-3 && s.leds["rgb:b"].brightness > 0.3);
  },
  "RGB LED 標成共陽極卻照共陰極接：提示接反"() {
    const s = simulate(rgbCircuit("anode"), { 17: { mode: "output", level: 1, pull: "none", pwm: null } });
    assert.ok(!s.leds["rgb:r"].on);
    assert.ok(s.issues.some((i) => /共陽極/.test(i.text)));
  },
  "MCP3008 照投影片接好：CH0 讀到可變電阻的電壓"() {
    const s = simulate(meterCircuit(), {});
    const a = s.adc[0];
    assert.ok(a.ok, JSON.stringify(s.issues.filter((i) => i.part === "adc")));
    assert.equal(a.ce, 0);
    assert.ok(Math.abs(a.vref - 3.3) < 0.01);
    assert.ok(Math.abs(a.channels[0].voltage - 3.3 * 0.25) < 0.01);
    assert.equal(a.channels[0].code, 256);
    assert.ok(a.channels[1].floating && !a.channels[1].connected);
    assert.ok(s.issues.some((i) => i.level === "ok" && /CH0 0\.8\dV → 256/.test(i.text)));
  },
  "MCP3008：DOUT、DIN 接反"() {
    const c = meterCircuit();
    c.wires.find((w) => w.id === "dout").b = "hdr:19";
    c.wires.find((w) => w.id === "din").b = "hdr:21";
    const s = simulate(c, {});
    assert.ok(!s.adc[0].ok);
    assert.ok(s.issues.some((i) => /DOUT 和 DIN 接反/.test(i.text)));
  },
  "MCP3008：VDD 接 5V 會燒壞 GPIO9"() {
    const c = meterCircuit();
    c.wires.find((w) => w.id === "vdd").b = "hdr:2";
    assert.ok(simulate(c, {}).issues.some((i) => i.level === "danger" && /5V/.test(i.text)));
  },
  "MCP3008：沒跨在溝上（上下兩排在同一邊）"() {
    const c = meterCircuit();
    c.parts.find((p) => p.id === "adc").pins = mcpPins(30, "a", "d");
    assert.ok(simulate(c, {}).issues.some((i) => /跨在麵包板中間的溝上/.test(i.text)));
  },
  "MCP3008：CS 接 GPIO7 就是 CE1"() {
    const c = meterCircuit();
    c.wires.find((w) => w.id === "cs").b = "hdr:26";
    assert.equal(simulate(c, {}).adc[0].ce, 1);
  },
  "SPI 使用中的腳不算浮接輸入"() {
    const spi = { mode: "spi", level: null, pull: null, pwm: null };
    const s = simulate(meterCircuit(), { 8: spi, 9: spi, 10: spi, 11: spi });
    assert.ok(!s.issues.some((i) => /浮接/.test(i.text)));
  },

  // ---- 介面語言 ----
  "兩種語言的字串 key 完全相同"() {
    const [zh, en] = LANGS.map((l) => new Set(dictKeys(l)));
    assert.deepEqual([...zh].filter((k) => !en.has(k)), [], "英文少了這些 key");
    assert.deepEqual([...en].filter((k) => !zh.has(k)), [], "中文少了這些 key");
  },
  "程式裡用到的每個 key 都有翻譯"() {
    const keys = new Set(dictKeys("zh"));
    const used = new Set();
    for (const f of ["app.js", "board.js", "circuit.js"]) {
      const src = readFileSync(new URL(`../static/${f}`, import.meta.url), "utf8");
      for (const m of src.matchAll(/\bt\("([\w.]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/name: "((?:leg|part)\.[\w.]+)"/g)) used.add(m[1]);
      for (const m of src.matchAll(/"(m\.target\w+)"/g)) used.add(m[1]);
    }
    const html = readFileSync(new URL("../static/index.html", import.meta.url), "utf8");
    for (const m of html.matchAll(/data-i18n(?:-html|-title|-aria)?="([\w.]+)"/g)) used.add(m[1]);
    assert.ok(used.size > 100, `只找到 ${used.size} 個 key`);
    assert.deepEqual([...used].filter((k) => !keys.has(k)), []);
  },
  "英文：LED、電阻、MCP3008 的提示"() {
    setLang("en");
    try {
      const ok = simulate(classic(220), out18(1)).issues.find((i) => i.part === "led1");
      assert.match(ok.text, /^LED \(red\) is on: simulated current .*Estimate: \(3\.3V − 2V\) ÷ 220Ω ≈ 5\.9mA\.$/);
      assert.match(simulate(classic(220, { reversed: true }), out18(1)).issues.find((i) => i.part === "led1").text, /is reversed/);
      const m = simulate(meterCircuit(), {});
      assert.ok(m.issues.some((i) => i.level === "ok" && /CH0 0\.8\dV → 256 \(value ≈ 0\.25\)/.test(i.text)));
      const c = meterCircuit();
      c.wires.find((w) => w.id === "dout").b = "hdr:19";
      c.wires.find((w) => w.id === "din").b = "hdr:21";
      assert.ok(simulate(c, {}).issues.some((i) => /DOUT and DIN are swapped/.test(i.text)));
    } finally { setLang("zh"); }
  },
  "英文：提示裡沒有中文字"() {
    setLang("en");
    try {
      const short = { wires: [wire("w", "hdr:1", "hdr:6")], parts: [] };
      const cases = [
        simulate(classic(220), out18(1)), simulate(classic(1e6), out18(1)), simulate(classic(220, { reversed: true }), out18(1)),
        simulate(meterCircuit(), {}), simulate(rgbCircuit("anode"), { 17: { mode: "output", level: 1, pull: "none", pwm: null } }),
        simulate(short, {}),
      ];
      for (const s of cases) for (const i of s.issues) assert.doesNotMatch(i.text, /[\u4e00-\u9fff]/, i.text);
    } finally { setLang("zh"); }
  },
};

// MCP3008 的 16 支腳：上排（第 16～9 腳）在 top 列、下排（第 1～8 腳）在 bottom 列，從第 col 行開始
function mcpPins(col, top = "e", bottom = "f") {
  return Array.from({ length: 16 }, (_, i) => (i < 8 ? `bb:${bottom}${col + i}` : `bb:${top}${col + 15 - i}`));
}

// 投影片「三段旋鈕儀表」的 MCP3008 部分：可變電阻接 CH0
function meterCircuit() {
  return {
    wires: [
      wire("p3", "hdr:1", "bb:top+:0"), wire("pg", "hdr:6", "bb:top-:1"),
      wire("vdd", "bb:a30", "bb:top+:30"), wire("vref", "bb:a31", "bb:top+:31"), wire("agnd", "bb:a32", "bb:top-:32"),
      wire("clk", "bb:a33", "hdr:23"), wire("dout", "bb:a34", "hdr:21"), wire("din", "bb:a35", "hdr:19"),
      wire("cs", "bb:a36", "hdr:24"), wire("dgnd", "bb:a37", "bb:top-:37"),
      wire("pot1", "bb:a44", "bb:top-:44"), wire("pot3", "bb:a48", "bb:top+:48"), wire("ch0", "bb:a46", "bb:h30"),
    ],
    parts: [
      { id: "adc", type: "mcp3008", pins: mcpPins(30) },
      { id: "pot", type: "pot", ohms: 10000, pos: 0.25, pins: ["bb:e44", "bb:e46", "bb:e48"] },
    ],
  };
}

// RGB LED（R f20、共同腳 f21、G f22、B f23），各串 1kΩ 到 GPIO17／27／22，共同腳接 GND
function rgbCircuit(common) {
  return {
    wires: [
      wire("g", "hdr:6", "bb:j21"),
      wire("r", "hdr:11", "bb:f16"), wire("gr", "hdr:13", "bb:f18"), wire("b", "hdr:15", "bb:f19"),
    ],
    parts: [
      { id: "rgb", type: "rgbled", common, pins: ["bb:f20", "bb:f21", "bb:f22", "bb:f23"] },
      { id: "r1", type: "resistor", ohms: 1000, pins: ["bb:h16", "bb:h20"] },
      { id: "r2", type: "resistor", ohms: 1000, pins: ["bb:i18", "bb:i22"] },
      { id: "r3", type: "resistor", ohms: 1000, pins: ["bb:j19", "bb:j23"] },
    ],
  };
}

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try { fn(); console.log("✓", name); }
  catch (e) { failed++; console.log("✗", name, "\n   ", e.message); }
}
console.log(failed ? `${failed} 個測試失敗` : "全部通過");
process.exit(failed ? 1 : 0);
