/*
  Voice -> OSC -> p5.js sketch
  Matches Python OSC messages from class_4:
    /speech/text   (string)
    /speech/color  (r, g, b)
    /speech/number (int)

  This sketch expects a p5.js OSC bridge (socket.io) running locally.
*/

const OSC_HOST = "127.0.0.1";
const OSC_BRIDGE_PORT = 8081;
const OSC_IN_PORT = 12000;  // Must match Python OSC_PORT
const OSC_OUT_PORT = 12001; // Optional return port

let socket = null;
let oscStatus = "not connected";

let transcript = "Say a color or a number.";
let currentNumber = 0;

let bgColor = { r: 20, g: 20, b: 26 };
let targetColor = { r: 20, g: 20, b: 26 };
let flash = 0;

const GRAPH_MAX_RAW_POINTS = 5000;
const GRAPH_MAX_VISIBLE_POINTS = 220;
let numberHistory = [];

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("monospace");
  textAlign(CENTER, CENTER);
  setupOsc(OSC_HOST, OSC_IN_PORT, OSC_OUT_PORT);
}

function draw() {
  bgColor.r = lerp(bgColor.r, targetColor.r, 0.12);
  bgColor.g = lerp(bgColor.g, targetColor.g, 0.12);
  bgColor.b = lerp(bgColor.b, targetColor.b, 0.12);
  background(bgColor.r, bgColor.g, bgColor.b);

  drawNumberDots();
  drawNumberGraph();
  drawHud();
  drawFlash();
}

function drawNumberDots() {
  const n = constrain(Math.floor(currentNumber), 0, 10);
  if (n === 0) return;

  const radius = min(width, height) * 0.23;
  const dotSize = max(14, min(width, height) * 0.03);
  const cx = width * 0.5;
  const cy = height * 0.53;

  noStroke();
  fill(255, 230);
  for (let i = 0; i < n; i++) {
    const angle = TWO_PI * (i / n) - HALF_PI;
    const x = cx + cos(angle) * radius;
    const y = cy + sin(angle) * radius;
    circle(x, y, dotSize);
  }
}

function drawHud() {
  fill(255);
  noStroke();

  textSize(min(width, height) * 0.035);
  text(`OSC: ${oscStatus}`, width * 0.5, height * 0.08);

  textSize(min(width, height) * 0.07);
  text(transcript, width * 0.5, height * 0.22);

  textSize(min(width, height) * 0.12);
  text(currentNumber, width * 0.5, height * 0.46);

  textSize(min(width, height) * 0.03);
  text("Listen for /speech/text, /speech/color, /speech/number", width * 0.5, height * 0.92);
}

function drawNumberGraph() {
  const panelW = width * 0.78;
  const panelH = height * 0.2;
  const panelX = (width - panelW) * 0.5;
  const panelY = height * 0.63;
  const pad = 14;
  const graphX = panelX + pad;
  const graphY = panelY + pad;
  const graphW = panelW - pad * 2;
  const graphH = panelH - pad * 2;

  noStroke();
  fill(8, 8, 10, 150);
  rect(panelX, panelY, panelW, panelH, 10);

  // Grid
  stroke(255, 40);
  strokeWeight(1);
  for (let i = 0; i <= 5; i++) {
    const y = graphY + (graphH * i) / 5;
    line(graphX, y, graphX + graphW, y);
  }

  const { points, stride } = downsampleHistory(numberHistory, GRAPH_MAX_VISIBLE_POINTS);
  if (points.length > 0) {
    noFill();
    stroke(255, 230);
    strokeWeight(2);
    beginShape();
    for (let i = 0; i < points.length; i++) {
      const x = graphX + (i * graphW) / max(1, points.length - 1);
      const y = map(points[i], 0, 10, graphY + graphH, graphY);
      vertex(x, y);
    }
    endShape();

    noStroke();
    fill(255, 230);
    const last = points[points.length - 1];
    const lx = graphX + graphW;
    const ly = map(last, 0, 10, graphY + graphH, graphY);
    circle(lx, ly, 6);
  }

  noStroke();
  fill(255, 180);
  textAlign(LEFT, TOP);
  textSize(min(width, height) * 0.018);
  text(
    `Number History  raw:${numberHistory.length}  shown:${points.length}  stride:${stride}  max-shown:${GRAPH_MAX_VISIBLE_POINTS}`,
    graphX,
    graphY + graphH + 4
  );
  textAlign(CENTER, CENTER);
}

function downsampleHistory(values, maxVisible) {
  const n = values.length;
  if (n === 0) return { points: [], stride: 1 };

  const stride = max(1, ceil(n / maxVisible));
  const points = [];
  for (let i = 0; i < n; i += stride) {
    points.push(values[i]);
  }

  // Ensure we always include the newest value
  if (points[points.length - 1] !== values[n - 1]) {
    points.push(values[n - 1]);
  }

  return { points, stride };
}

function drawFlash() {
  if (flash <= 0) return;
  noStroke();
  fill(255, flash * 80);
  rect(0, 0, width, height);
  flash *= 0.85;
}

function setupOsc(host, inPort, outPort) {
  if (typeof io === "undefined") {
    oscStatus = "socket.io missing";
    return;
  }

  socket = io.connect(`http://${host}:${OSC_BRIDGE_PORT}`, {
    port: OSC_BRIDGE_PORT,
    rememberTransport: false,
  });

  socket.on("connect", () => {
    oscStatus = `connected (${host}:${inPort})`;
    socket.emit("config", {
      server: { port: inPort, host },
      client: { port: outPort, host },
    });
  });

  socket.on("disconnect", () => {
    oscStatus = "disconnected";
  });

  socket.on("message", (msg) => {
    if (!msg || !msg.address) return;
    handleOsc(msg.address, msg.args);
  });
}

function handleOsc(address, rawArgs) {
  const args = normalizeArgs(rawArgs);

  if (address === "/speech/text") {
    transcript = String(args[0] ?? "");
    flash = 1.0;
    return;
  }

  if (address === "/speech/color") {
    let colorArgs = args;
    if (Array.isArray(args[0])) colorArgs = args[0];
    if (colorArgs.length >= 3) {
      targetColor = {
        r: Number(colorArgs[0]) || 0,
        g: Number(colorArgs[1]) || 0,
        b: Number(colorArgs[2]) || 0,
      };
      flash = 1.0;
    }
    return;
  }

  if (address === "/speech/number") {
    currentNumber = Number(args[0]) || 0;
    addHistoryPoint(currentNumber);
    flash = 1.0;
  }
}

function addHistoryPoint(value) {
  numberHistory.push(constrain(Number(value) || 0, 0, 10));
  if (numberHistory.length > GRAPH_MAX_RAW_POINTS) {
    numberHistory.splice(0, numberHistory.length - GRAPH_MAX_RAW_POINTS);
  }
}

function normalizeArgs(rawArgs) {
  if (!Array.isArray(rawArgs)) {
    return rawArgs === undefined ? [] : [rawArgs];
  }

  return rawArgs.map((arg) => {
    if (arg && typeof arg === "object" && "value" in arg) {
      return arg.value;
    }
    return arg;
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// Compatibility path for environments that call receiveOsc(address, args)
function receiveOsc(address, value) {
  handleOsc(address, value);
}
