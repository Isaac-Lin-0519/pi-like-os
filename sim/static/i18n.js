// ==================================================================
// 介面語言（繁體中文／English）
//
//   t("key", { name: 值 }) → 目前語言的字串，{name} 會換成值
//   語言的決定順序：使用者按過的切換鈕（存在瀏覽器）→ 瀏覽器語言（zh 開頭用中文）→ 英文
//   在 node 裡（測試）沒有瀏覽器，預設中文；測試可以呼叫 setLang("en")
//
// 新增語言：在 DICT 加一組相同的 key，再把語言代碼加進 LANGS。
// ==================================================================

export const LANGS = ["zh", "en"];
const STORAGE_KEY = "pisim-lang";

const DICT = {
  zh: {
    // ---- 頁面 ----
    "page.title": "虛擬麵包板",
    "page.htmlLang": "zh-Hant",
    "page.locale": "zh-TW",
    "lang.switch": "English",
    "lang.switchTitle": "Switch to English",
    "status.connecting": "連線中…",
    "status.ok": "已連線",
    "status.ok.title": "網頁和虛擬麵包板伺服器（sim 容器）之間的連線",
    "status.lost": "連線中斷，重新連線中…",
    "example.title": "載入範例電路",
    "example.placeholder": "範例電路…",
    "example.led": "LED 閃爍（GPIO18）",
    "example.meter": "三段旋鈕儀表（MCP3008＋可變電阻）",
    "example.rgb": "RGB 三原色混色（按鈕 A／B／C）",
    "example.confirm": "要用範例電路取代目前的電路嗎？",
    "btn.export": "匯出",
    "btn.export.title": "把電路存成檔案",
    "btn.import": "匯入",
    "btn.import.title": "從檔案載入電路",
    "btn.clear": "清空",
    "clear.confirm": "確定要清空麵包板嗎？",
    "export.filename": "麵包板電路.json",
    "import.bad": "這個檔案不是麵包板電路檔。",
    "card.toolbox": "元件（拖到麵包板上）",
    "card.wire": "杜邦線",
    "help.wire": "從排針或孔<b>拖</b>到另一個孔，就是一條線；也可以點起點、再點終點。",
    "card.props": "選取的元件",
    "board.aria": "Raspberry Pi 4 與麵包板",
    "help.board": "滑鼠移到孔上會用綠圈標出所有相通的點。選取後 <kbd>R</kbd> 旋轉、<kbd>Delete</kbd> 刪除、<kbd>Esc</kbd> 取消；按住按鈕＝按下；上下拖曳（或滾輪）轉動可變電阻的旋鈕。",
    "card.hints": "電路提示",
    "card.programs": "執行中的程式",
    "card.log": "腳位變化紀錄",
    "log.waiting": "等待程式執行…",

    // ---- 電路提示清單 ----
    "hints.empty": "從左邊的工具箱拖一個元件到麵包板上開始吧。不知道怎麼接？可以從上方的「範例電路」選一個。",
    "hints.none": "沒有發現問題。",

    // ---- 工具箱 ----
    "tool.drag": "拖到麵包板上",
    "tool.led": "LED {color}",
    "tool.button": "按鈕",
    "tool.pot": "可變電阻",
    "tool.resistor": "電阻 {r}",

    // ---- 顏色 ----
    "color.red": "紅", "color.green": "綠", "color.yellow": "黃", "color.blue": "藍", "color.white": "白",
    "wire.black": "黑", "wire.red": "紅", "wire.orange": "橙", "wire.yellow": "黃", "wire.green": "綠",
    "wire.blue": "藍", "wire.purple": "紫", "wire.white": "白",

    // ---- 屬性面板 ----
    "props.empty": "點選麵包板上的元件或線，可以在這裡修改。",
    "props.wire": "杜邦線",
    "props.delete": "刪除（Delete）",
    "props.rotate": "旋轉（R）",
    "props.color": "顏色",
    "props.ledOption": "{color}色（約 {vf}V）",
    "props.current": "電流 {i}",
    "props.noCurrent": "目前沒有電流",
    "props.resistor": "電阻",
    "props.ohms": "阻值",
    "props.rgbKind": "種類",
    "props.rgbCathode": "共陰極（共同腳接 GND）",
    "props.rgbAnode": "共陽極（共同腳接 3V3）",
    "props.rgbPins": "腳位（左到右）：紅 R、共同腳（最長）、綠 G、藍 B",
    "props.rgbOff": "不亮",
    "props.listSep": "、",
    "props.pot": "可變電阻",
    "props.knob": "旋鈕",
    "props.potTotal": "總阻值",
    "props.potHelp": "兩側的腳接 3V3 和 GND，中間腳（滑動端）的電壓就會隨旋鈕在 0～3.3V 之間變化。也可以在麵包板上直接上下拖曳旋鈕。",
    "props.potReadout": "旋鈕 {pct}%",
    "props.potWiper": "，中間腳電壓 {v} V",
    "props.mcp": "MCP3008（10 位元類比轉數位）",
    "props.button": "按鈕",
    "props.buttonHelp": "按住按鈕＝按下。距離較遠的兩支腳（跨過中間溝的那兩支）永遠相通。",
    "props.loose": "有 {n} 支腳沒插進孔（紅圈）。",
    "mcp.ok": "接好了：CS 接 CE{ce}",
    "mcp.notOk": "接線還沒完成（看下方的電路提示）",
    "mcp.colCh": "通道", "mcp.colV": "電壓", "mcp.colCode": "讀值", "mcp.colRead": "程式讀到",
    "mcp.floating": "浮接",
    "mcp.formula": "讀值 ＝ 1024 × 電壓 ÷ VREF（最大 1023）。gpiozero 的 value ＝ 讀值 ÷ 1023。",

    // ---- 滑鼠說明 ----
    "tip.voltage": "電壓 {v} V",
    "tip.unused": "程式沒有使用",
    "tip.spi": "SPI 使用中",
    "tip.output": "程式設為輸出",
    "tip.input": "程式設為輸入",
    "tip.reads": "，讀到 {v}",
    "tip.readsFloating": "不確定（浮接）",
    "tip.greenCircle": "（綠圈＝與這裡相通的點）",
    "tip.mcpPin": "MCP3008 第 {num} 腳：{name}",
    "tip.connectTo": "要接 {target}",
    "tip.analogIn": "類比輸入（0～VREF），例如接可變電阻的中間腳",
    "tip.mcpNow": "現在 {v}V → 讀值 {code}",
    "tip.mcpNotch": "（缺口在左邊；第 1 腳在左下角）",
    "tip.pot": "可變電阻 {r}",
    "tip.potHow": "上下拖曳旋鈕、或用滑鼠滾輪調整",
    "tip.rgb": "RGB LED（{kind}）",
    "tip.rgbAnode": "共陽極",
    "tip.rgbCathode": "共陰極",
    "tip.rgbPins": "腳位：紅 R、共同腳（最長）、綠 G、藍 B",
    "tip.thisPin": "這支是：{name}",
    "tip.led": "LED（{color}）",
    "tip.ledLegs": "長腳＋在左、短腳－在右",
    "tip.resistor": "電阻 {r}",
    "tip.button": "按鈕（按住＝按下）",

    // ---- 執行中的程式、紀錄 ----
    "programs.none": "目前沒有程式在使用 GPIO",
    "pin.free": "未使用",
    "pin.spi": "SPI 使用中",
    "pin.pwm": "PWM {hz}Hz，工作週期 {duty}%",
    "pin.high": "輸出高電位（3.3V）",
    "pin.low": "輸出低電位（0V）",
    "pin.input": "輸入，讀到 {v}",
    "log.prev": "（前一狀態 {s} 秒）",

    // ---- 麵包板上的點 ----
    "point.header": "{name}（實體腳位 {phys}）",
    "point.rail": "{side}電源軌 {sign}（整條相通）",
    "point.railTop": "上方", "point.railBottom": "下方", "point.plus": "＋", "point.minus": "－",
    "point.hole": "麵包板 {id}（第 {col} 行 {group} 這 5 個孔相通）",

    // ---- 元件的腳 ----
    "part.led": "LED",
    "part.resistor": "電阻",
    "part.button": "按鈕",
    "part.rgbled": "RGB LED",
    "part.pot": "可變電阻",
    "part.mcp3008": "MCP3008",
    "leg.ledLong": "長腳（＋，陽極）", "leg.ledShort": "短腳（－，陰極）",
    "leg.n": "腳 {n}",
    "leg.topLeft": "左上", "leg.bottomLeft": "左下", "leg.topRight": "右上", "leg.bottomRight": "右下",
    "leg.rgbR": "紅（R）", "leg.rgbCommon": "共同腳（最長的腳）", "leg.rgbG": "綠（G）", "leg.rgbB": "藍（B）",
    "leg.wiper": "中間腳（滑動端）",
    "leg.chip": "第 {n} 腳 {name}",

    // ---- 電路提示（circuit.js） ----
    "c.short3v3": "3V3 直接接到 GND，短路了！這會讓樹莓派當機或損壞。",
    "c.short5v": "5V 直接接到 GND，短路了！這會讓樹莓派當機或損壞。",
    "c.short3v3to5v": "3V3 和 5V 接在一起，短路了！",
    "c.ledLabel": "LED（{color}）",
    "c.rgbLabel": "RGB LED 的{color}色",
    "c.loose": "{label} 有腳沒插進麵包板。",
    "c.ledShorted": "{label} 兩支腳插在相通的同一排，被短路了，所以不會亮。（同一排的 5 個孔是相通的）",
    "c.howLed": "長腳（＋，陽極）要接 GPIO／3V3 那一側，短腳（－，陰極）接 GND。",
    "c.howRgbAnode": "這是共陽極 RGB LED：最長的共同腳要接 3V3，紅綠藍三支腳經過電阻接 GPIO（輸出低電位才會亮）。",
    "c.howRgbCathode": "這是共陰極 RGB LED：最長的共同腳要接 GND，紅綠藍三支腳經過電阻接 GPIO。",
    "c.reversed": "{label} 接反了，所以不會亮。{how}",
    "c.formula": "估算：({v}V − {vf}V) ÷ {r} ≈ {i}",
    "c.sentence": "{s}。",
    "c.measured": "模擬電流 {i}",
    "c.pwmAvg": "（PWM 平均 {i}）",
    "c.noResistor": "{label} 沒有接限流電阻！{measured}，超過 GPIO 建議的 {max}mA，真機可能燒壞 LED 或 GPIO。請串聯 220Ω～1kΩ 的電阻。",
    "c.ledTooMuch": "{label} 電流太大：{measured}，超過 LED 的額定 {max}mA。請換大一點的電阻。",
    "c.ledTooLittle": "{label} 電阻太大，{measured}，LED 幾乎不亮。{formula}",
    "c.ledOn": "{label} 亮了：{measured}。{formula}",
    "c.resShorted": "電阻 {r} 兩支腳插在相通的同一排，等於沒有作用。",
    "c.potDanger": "可變電阻的電流有 {i}！旋鈕轉到底時中間腳和旁邊的腳之間幾乎是 0Ω，中間腳不要直接接 3V3 或 GND。正確接法：兩側的腳接 3V3 和 GND，中間腳接到 MCP3008 的 CH 腳。",
    "c.high": "高", "c.low": "低",
    "c.gpioShort": "GPIO{g}（腳位 {phys}）短路：輸出{out}電位，卻直接接到{other}電位，電流約 {i}！真機上可能燒壞 GPIO。",
    "c.gpioOver": "GPIO{g}（腳位 {phys}）輸出電流 {i}，超過建議的 {max}mA。",
    "c.gpioOverVolt": "GPIO{g}（腳位 {phys}）的電壓是 {v}V！GPIO 只能承受 3.3V，接到 5V 會燒壞樹莓派。",
    "c.floating": "GPIO{g}（腳位 {phys}）是輸入，但沒有接到確定的電位（浮接），讀值會亂跳。可以在程式裡用上拉／下拉（例如 Button 預設的 pull_up=True），或接上拉／下拉電阻。",
    "c.supplyShort": "{kind} 短路了，電流約 {i}！請檢查是不是直接接到 GND 或低電位。",

    // ---- MCP3008 提示 ----
    "m.prefix": "MCP3008：{text}",
    "m.loose": "有腳沒插進麵包板。",
    "m.gap": "晶片要跨在麵包板中間的溝上（一排腳插 e 列、另一排插 f 列），不然上下兩排的腳會被同一行的孔連在一起。",
    "m.unwired": "還沒接線。對照表：VDD（16）、VREF（15）→ 3.3V；AGND（14）、DGND（9）→ GND；CLK（13）→ GPIO11（實體 23）；DOUT（12）→ GPIO9（實體 21）；DIN（11）→ GPIO10（實體 19）；CS（10）→ GPIO8（實體 24）；CH0（1）接可變電阻的中間腳。",
    "m.vdd5v": "VDD（第 16 腳）接到 5V 了！這樣 DOUT 會輸出 5V 到 GPIO9（MISO），會燒壞樹莓派。請改接 3.3V（實體腳位 1 或 17）。",
    "m.vddMissing": "VDD（第 16 腳）要接 3.3V（實體腳位 1 或 17），晶片現在沒有電。",
    "m.vref": "VREF（第 15 腳）要接 3.3V。它是量測的參考電壓：輸入等於 VREF 時讀到 1023。",
    "m.agnd": "AGND（第 14 腳）要接 GND。",
    "m.dgnd": "DGND（第 9 腳）要接 GND。",
    "m.swapped": "DOUT 和 DIN 接反了。DOUT（第 12 腳，晶片送出資料）要接 GPIO9／MISO（實體腳位 21）；DIN（第 11 腳，晶片接收指令）要接 GPIO10／MOSI（實體腳位 19）。",
    "m.spiPin": "{name}（第 {num} 腳）要接 {target}（實體腳位 {phys}）。",
    "m.cs": "CS/SHDN（第 10 腳）要接 GPIO8／CE0（實體腳位 24）。",
    "m.chFloat": "CH{ch}（第 {num} 腳）接了線，但沒有接到確定的電壓，讀值會亂飄。",
    "m.chOver": "CH{ch} 的電壓 {v}V 超過 VREF，讀值會停在 1023。",
    "m.chItem": "CH{ch} {v}V → {code}（value ≈ {val}）",
    "m.chSep": "；",
    "m.noChannels": "還沒有接任何類比輸入（CH0～CH7）。",
    "m.ok": "MCP3008 接好了（CS 接 CE{ce}，程式裡用 {code} 或 spi.open(0, {ce})）。{list}",
    "m.target3v3": "3.3V（實體腳位 1 或 17）",
    "m.targetSclk": "GPIO11／SCLK（實體腳位 23）",
    "m.targetMiso": "GPIO9／MISO（實體腳位 21）",
    "m.targetMosi": "GPIO10／MOSI（實體腳位 19）",
    "m.targetCe0": "GPIO8／CE0（實體腳位 24）",
  },

  en: {
    // ---- Page ----
    "page.title": "Virtual Breadboard",
    "page.htmlLang": "en",
    "page.locale": "en-GB",
    "lang.switch": "中文",
    "lang.switchTitle": "切換成中文",
    "status.connecting": "Connecting…",
    "status.ok": "Connected",
    "status.ok.title": "Connection between this page and the breadboard server (sim container)",
    "status.lost": "Connection lost. Reconnecting…",
    "example.title": "Load an example circuit",
    "example.placeholder": "Example circuits…",
    "example.led": "LED blink (GPIO18)",
    "example.meter": "Three-step knob meter (MCP3008 + potentiometer)",
    "example.rgb": "RGB color mixer (buttons A/B/C)",
    "example.confirm": "Replace the current circuit with the example circuit?",
    "btn.export": "Export",
    "btn.export.title": "Save the circuit to a file",
    "btn.import": "Import",
    "btn.import.title": "Load a circuit from a file",
    "btn.clear": "Clear",
    "clear.confirm": "Remove everything from the breadboard?",
    "export.filename": "breadboard-circuit.json",
    "import.bad": "This file is not a breadboard circuit file.",
    "card.toolbox": "Parts (drag to the breadboard)",
    "card.wire": "Jumper wires",
    "help.wire": "<b>Drag</b> from a header pin or a hole to a different hole to add a wire. Or click the start point, then click the end point.",
    "card.props": "Selected part",
    "board.aria": "Raspberry Pi 4 and breadboard",
    "help.board": "Move the mouse over a hole to see all connected points (green circles). After you select an item: <kbd>R</kbd> turns it, <kbd>Delete</kbd> removes it, <kbd>Esc</kbd> cancels. Hold a button down to push it. Drag up or down on a knob (or use the mouse wheel) to turn the potentiometer.",
    "card.hints": "Circuit hints",
    "card.programs": "Running programs",
    "card.log": "Pin change log",
    "log.waiting": "Waiting for a program…",

    // ---- Hint list ----
    "hints.empty": "Drag a part from the toolbox on the left to the breadboard to start. Not sure how to connect it? Select a circuit in \"Example circuits\" at the top.",
    "hints.none": "No problems found.",

    // ---- Toolbox ----
    "tool.drag": "Drag to the breadboard",
    "tool.led": "LED {color}",
    "tool.button": "Button",
    "tool.pot": "Potentiometer",
    "tool.resistor": "Resistor {r}",

    // ---- Colors ----
    "color.red": "red", "color.green": "green", "color.yellow": "yellow", "color.blue": "blue", "color.white": "white",
    "wire.black": "black", "wire.red": "red", "wire.orange": "orange", "wire.yellow": "yellow", "wire.green": "green",
    "wire.blue": "blue", "wire.purple": "purple", "wire.white": "white",

    // ---- Properties panel ----
    "props.empty": "Click a part or a wire on the breadboard to change it here.",
    "props.wire": "Jumper wire",
    "props.delete": "Delete (Delete)",
    "props.rotate": "Turn (R)",
    "props.color": "Color",
    "props.ledOption": "{color} (approx. {vf}V)",
    "props.current": "Current {i}",
    "props.noCurrent": "No current",
    "props.resistor": "Resistor",
    "props.ohms": "Value",
    "props.rgbKind": "Type",
    "props.rgbCathode": "Common cathode (common leg to GND)",
    "props.rgbAnode": "Common anode (common leg to 3V3)",
    "props.rgbPins": "Legs (left to right): red R, common (longest), green G, blue B",
    "props.rgbOff": "off",
    "props.listSep": ", ",
    "props.pot": "Potentiometer",
    "props.knob": "Knob",
    "props.potTotal": "Total value",
    "props.potHelp": "Connect the outer legs to 3V3 and GND. Then the voltage on the center leg (wiper) changes from 0 to 3.3V as you turn the knob. You can also drag the knob up or down on the breadboard.",
    "props.potReadout": "Knob {pct}%",
    "props.potWiper": ", wiper voltage {v} V",
    "props.mcp": "MCP3008 (10-bit analog-to-digital converter)",
    "props.button": "Button",
    "props.buttonHelp": "Hold the button down to push it. The two legs that are farther apart (across the center gap) are always connected.",
    "props.loose": "{n} leg(s) not in a hole (red circle).",
    "mcp.ok": "Connected correctly: CS to CE{ce}",
    "mcp.notOk": "Wiring is not complete (see the circuit hints below)",
    "mcp.colCh": "Channel", "mcp.colV": "Voltage", "mcp.colCode": "Code", "mcp.colRead": "Program read",
    "mcp.floating": "floating",
    "mcp.formula": "Code = 1024 × voltage ÷ VREF (max. 1023). gpiozero value = code ÷ 1023.",

    // ---- Mouse tips ----
    "tip.voltage": "Voltage {v} V",
    "tip.unused": "Not used by a program",
    "tip.spi": "In use by SPI",
    "tip.output": "Set as output by a program",
    "tip.input": "Set as input by a program",
    "tip.reads": ", reads {v}",
    "tip.readsFloating": "unknown (floating)",
    "tip.greenCircle": "(Green circle = point connected to here)",
    "tip.mcpPin": "MCP3008 pin {num}: {name}",
    "tip.connectTo": "Connect to {target}",
    "tip.analogIn": "Analog input (0 to VREF), for example the potentiometer wiper",
    "tip.mcpNow": "Now {v}V → code {code}",
    "tip.mcpNotch": "(Notch on the left; pin 1 at the bottom left)",
    "tip.pot": "Potentiometer {r}",
    "tip.potHow": "Drag the knob up or down, or use the mouse wheel",
    "tip.rgb": "RGB LED ({kind})",
    "tip.rgbAnode": "common anode",
    "tip.rgbCathode": "common cathode",
    "tip.rgbPins": "Legs: red R, common (longest), green G, blue B",
    "tip.thisPin": "This leg: {name}",
    "tip.led": "LED ({color})",
    "tip.ledLegs": "Long leg + on the left, short leg − on the right",
    "tip.resistor": "Resistor {r}",
    "tip.button": "Button (hold down = pushed)",

    // ---- Running programs, log ----
    "programs.none": "No program uses GPIO now",
    "pin.free": "not used",
    "pin.spi": "in use by SPI",
    "pin.pwm": "PWM {hz}Hz, duty cycle {duty}%",
    "pin.high": "output high (3.3V)",
    "pin.low": "output low (0V)",
    "pin.input": "input, reads {v}",
    "log.prev": " (previous state {s} s)",

    // ---- Points on the board ----
    "point.header": "{name} (physical pin {phys})",
    "point.rail": "{side} power rail {sign} (the full rail is connected)",
    "point.railTop": "Top", "point.railBottom": "Bottom", "point.plus": "+", "point.minus": "−",
    "point.hole": "Breadboard {id} (the 5 holes {group} in column {col} are connected)",

    // ---- Part legs ----
    "part.led": "LED",
    "part.resistor": "Resistor",
    "part.button": "Button",
    "part.rgbled": "RGB LED",
    "part.pot": "Potentiometer",
    "part.mcp3008": "MCP3008",
    "leg.ledLong": "long leg (+, anode)", "leg.ledShort": "short leg (−, cathode)",
    "leg.n": "leg {n}",
    "leg.topLeft": "top left", "leg.bottomLeft": "bottom left", "leg.topRight": "top right", "leg.bottomRight": "bottom right",
    "leg.rgbR": "red (R)", "leg.rgbCommon": "common (longest leg)", "leg.rgbG": "green (G)", "leg.rgbB": "blue (B)",
    "leg.wiper": "center leg (wiper)",
    "leg.chip": "pin {n} {name}",

    // ---- Circuit hints (circuit.js) ----
    "c.short3v3": "3V3 connects directly to GND. This is a short circuit! It can crash or damage the Raspberry Pi.",
    "c.short5v": "5V connects directly to GND. This is a short circuit! It can crash or damage the Raspberry Pi.",
    "c.short3v3to5v": "3V3 and 5V are connected together. This is a short circuit!",
    "c.ledLabel": "LED ({color})",
    "c.rgbLabel": "RGB LED ({color})",
    "c.loose": "{label} has a leg that is not in the breadboard.",
    "c.ledShorted": "Both legs of {label} are in the same connected column. The LED is short-circuited and does not come on. (The 5 holes in a column are connected.)",
    "c.howLed": "Connect the long leg (+, anode) to the GPIO/3V3 side and the short leg (−, cathode) to GND.",
    "c.howRgbAnode": "This is a common-anode RGB LED: connect the longest (common) leg to 3V3, and the red, green and blue legs through resistors to GPIO pins (the LED comes on when the output is low).",
    "c.howRgbCathode": "This is a common-cathode RGB LED: connect the longest (common) leg to GND, and the red, green and blue legs through resistors to GPIO pins.",
    "c.reversed": "{label} is reversed, so it does not come on. {how}",
    "c.formula": "Estimate: ({v}V − {vf}V) ÷ {r} ≈ {i}",
    "c.sentence": "{s}.",
    "c.measured": "simulated current {i}",
    "c.pwmAvg": " (PWM average {i})",
    "c.noResistor": "{label} has no current-limiting resistor! The {measured} is more than the {max}mA recommended for a GPIO pin. On a real Pi this can damage the LED or the GPIO pin. Add a 220Ω–1kΩ resistor in series.",
    "c.ledTooMuch": "{label}: the current is too high. The {measured} is more than the LED rating of {max}mA. Use a larger resistor.",
    "c.ledTooLittle": "{label}: the resistor is too large. With a {measured}, the LED is almost off. {formula}",
    "c.ledOn": "{label} is on: {measured}. {formula}",
    "c.resShorted": "Both legs of the {r} resistor are in the same connected column. The resistor has no effect.",
    "c.potDanger": "The potentiometer current is {i}! At the end of the knob travel, the resistance between the center leg and an outer leg is almost 0Ω. Do not connect the center leg directly to 3V3 or GND. Correct wiring: outer legs to 3V3 and GND, center leg to an MCP3008 CH pin.",
    "c.high": "high", "c.low": "low",
    "c.gpioShort": "GPIO{g} (pin {phys}) short circuit: the output is {out}, but it connects directly to {other}. The current is approximately {i}! On a real Pi this can damage the GPIO pin.",
    "c.gpioOver": "GPIO{g} (pin {phys}) output current is {i}. This is more than the recommended {max}mA.",
    "c.gpioOverVolt": "GPIO{g} (pin {phys}) is at {v}V! A GPIO pin accepts 3.3V maximum. 5V damages the Raspberry Pi.",
    "c.floating": "GPIO{g} (pin {phys}) is an input, but it has no fixed voltage (floating). The value changes randomly. Use a pull-up or pull-down in the program (for example, Button uses pull_up=True by default), or add a pull-up or pull-down resistor.",
    "c.supplyShort": "{kind} short circuit: the current is approximately {i}! Make sure that it does not connect directly to GND or to a low output.",

    // ---- MCP3008 hints ----
    "m.prefix": "MCP3008: {text}",
    "m.loose": "a leg is not in the breadboard.",
    "m.gap": "the chip must go across the center gap of the breadboard (one row of legs in row e, the other in row f). If not, the column connects the top and bottom legs together.",
    "m.unwired": "not connected yet. Wiring: VDD (16), VREF (15) → 3.3V; AGND (14), DGND (9) → GND; CLK (13) → GPIO11 (pin 23); DOUT (12) → GPIO9 (pin 21); DIN (11) → GPIO10 (pin 19); CS (10) → GPIO8 (pin 24); CH0 (1) → potentiometer center leg.",
    "m.vdd5v": "VDD (pin 16) connects to 5V! Then DOUT sends 5V to GPIO9 (MISO), and this damages the Raspberry Pi. Connect it to 3.3V (physical pin 1 or 17).",
    "m.vddMissing": "connect VDD (pin 16) to 3.3V (physical pin 1 or 17). The chip has no power now.",
    "m.vref": "connect VREF (pin 15) to 3.3V. It is the reference voltage: an input equal to VREF reads 1023.",
    "m.agnd": "connect AGND (pin 14) to GND.",
    "m.dgnd": "connect DGND (pin 9) to GND.",
    "m.swapped": "DOUT and DIN are swapped. DOUT (pin 12, data out of the chip) goes to GPIO9/MISO (physical pin 21). DIN (pin 11, commands into the chip) goes to GPIO10/MOSI (physical pin 19).",
    "m.spiPin": "connect {name} (pin {num}) to {target} (physical pin {phys}).",
    "m.cs": "connect CS/SHDN (pin 10) to GPIO8/CE0 (physical pin 24).",
    "m.chFloat": "CH{ch} (pin {num}) has a wire, but no fixed voltage. The value changes randomly.",
    "m.chOver": "CH{ch} is at {v}V. This is more than VREF, so the value stays at 1023.",
    "m.chItem": "CH{ch} {v}V → {code} (value ≈ {val})",
    "m.chSep": "; ",
    "m.noChannels": "No analog input (CH0–CH7) is connected yet.",
    "m.ok": "MCP3008 is connected correctly (CS to CE{ce}; in the program use {code} or spi.open(0, {ce})). {list}",
    "m.target3v3": "3.3V (physical pin 1 or 17)",
    "m.targetSclk": "GPIO11/SCLK (physical pin 23)",
    "m.targetMiso": "GPIO9/MISO (physical pin 21)",
    "m.targetMosi": "GPIO10/MOSI (physical pin 19)",
    "m.targetCe0": "GPIO8/CE0 (physical pin 24)",
  },
};

function detect() {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (LANGS.includes(saved)) return saved;
  } catch { /* 無痕模式等情況讀不到，改用瀏覽器語言 */ }
  // node（測試）也有 navigator，所以用 window 判斷是不是瀏覽器
  if (typeof window === "undefined") return "zh";
  const nav = globalThis.navigator;
  if (!nav?.languages && !nav?.language) return "zh";
  const list = nav.languages?.length ? nav.languages : [nav.language];
  return list.some((l) => /^zh\b/i.test(l)) ? "zh" : "en";
}

let lang = detect();

export function getLang() { return lang; }

export function setLang(next, { save = false } = {}) {
  if (!LANGS.includes(next)) return;
  lang = next;
  if (save) {
    try { globalThis.localStorage?.setItem(STORAGE_KEY, next); } catch { /* 存不了就只在這次有效 */ }
  }
}

export function t(key, params = {}) {
  const s = DICT[lang][key] ?? DICT.zh[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

// 給測試用：兩種語言的 key 是否一致
export function dictKeys(l) { return Object.keys(DICT[l]); }
