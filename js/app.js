import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
import { MAJOR_CHORDS, MINOR_CHORDS, getChordFrequencies } from "./chords.js";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

class ChordSynth {
  constructor(id) {
    this.id = id;
    this.audioContext = null;
    this.outputGain = null;
    this.filter = null;
    this.voices = [];
    this.manualMuted = false;
    this.gestureMuted = false;
    this.currentVolume = 0.16;
  }

  init(audioContextInstance, volume) {
    if (this.audioContext) {
      this.audioContext.resume();
      return;
    }

    this.audioContext = audioContextInstance;
    this.currentVolume = volume;

    this.outputGain = this.audioContext.createGain();
    this.outputGain.gain.value = volume * 0.72;

    this.filter = this.audioContext.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = this.id === "left" ? 1050 : 1250;
    this.filter.Q.value = 0.8;

    const compressor = this.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -28;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;

    this.filter.connect(compressor);
    compressor.connect(this.outputGain);
    this.outputGain.connect(this.audioContext.destination);

    const defaultChord = this.id === "left" ? MINOR_CHORDS[0] : MAJOR_CHORDS[0];
    const defaultFrequencies = getChordFrequencies(defaultChord);
    this.voices = defaultFrequencies.map((frequency, index) => this.createVoice(frequency, index));
  }

  createVoice(frequency, index) {
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = index === 0 ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    oscillator.detune.value = this.id === "left"
      ? (index % 2 === 0 ? -7 : 2)
      : (index % 2 === 0 ? -4 : 4);

    gain.gain.value = index === 0 ? 0.20 : 0.12;
    oscillator.connect(gain);
    gain.connect(this.filter);
    oscillator.start();

    return { oscillator, gain };
  }

  setChord(frequencies) {
    if (!this.audioContext || !this.voices.length) return;

    const now = this.audioContext.currentTime;

    frequencies.forEach((frequency, index) => {
      const voice = this.voices[index];
      if (!voice) return;
      voice.oscillator.frequency.cancelScheduledValues(now);
      voice.oscillator.frequency.setTargetAtTime(frequency, now, 0.045);
    });
  }

  setVolume(volume) {
    this.currentVolume = volume;
    this.updateOutputGain();
  }

  setManualMuted(muted) {
    if (this.manualMuted === muted) return;
    this.manualMuted = muted;
    this.updateOutputGain();
  }

  setGestureMuted(muted) {
    if (this.gestureMuted === muted) return;
    this.gestureMuted = muted;
    this.updateOutputGain();
  }

  updateOutputGain() {
    if (!this.audioContext || !this.outputGain) return;

    const shouldMute = this.manualMuted || this.gestureMuted;
    const targetVolume = shouldMute ? 0 : this.currentVolume * 0.72;
    const now = this.audioContext.currentTime;

    this.outputGain.gain.cancelScheduledValues(now);
    this.outputGain.gain.setTargetAtTime(targetVolume, now, 0.035);
  }
}


const video = document.querySelector("#webcam");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const stage = document.querySelector("#stage");
const startButton = document.querySelector("#startButton");
const muteButton = document.querySelector("#muteButton");
const trackingStatus = document.querySelector("#trackingStatus");
const volumeControl = document.querySelector("#volumeControl");
const smoothControl = document.querySelector("#smoothControl");
const swapHandsControl = document.querySelector("#swapHands");
const majorChordList = document.querySelector("#majorChordList");
const minorChordList = document.querySelector("#minorChordList");

const controllers = {
  left: {
    id: "left",
    handLabel: "Mão esquerda",
    lineLabel: "menores",
    chords: MINOR_CHORDS,
    selectedChordIndex: -1,
    smoothedPointer: null,
    gestureMuted: false,
    fistFrames: 0,
    openFrames: 0,
    seenThisFrame: false,
    lastPointer: null,
    synth: new ChordSynth("left"),
    chordDisplay: document.querySelector("#leftChord"),
    hintDisplay: document.querySelector("#leftHint"),
    listElement: minorChordList,
    activeClass: "minor-active",
    accent: "rgba(221, 164, 255, 0.64)",
    accentStrong: "rgba(238, 215, 255, 0.96)",
    skeleton: "rgba(221, 164, 255, 0.84)",
    textOnAccent: "#16081f"
  },
  right: {
    id: "right",
    handLabel: "Mão direita",
    lineLabel: "maiores",
    chords: MAJOR_CHORDS,
    selectedChordIndex: -1,
    smoothedPointer: null,
    gestureMuted: false,
    fistFrames: 0,
    openFrames: 0,
    seenThisFrame: false,
    lastPointer: null,
    synth: new ChordSynth("right"),
    chordDisplay: document.querySelector("#rightChord"),
    hintDisplay: document.querySelector("#rightHint"),
    listElement: majorChordList,
    activeClass: "major-active",
    accent: "rgba(143, 211, 255, 0.64)",
    accentStrong: "rgba(213, 241, 255, 0.96)",
    skeleton: "rgba(163, 255, 207, 0.82)",
    textOnAccent: "#07111f"
  }
};

let handLandmarker;
let animationFrameId;
let lastVideoTime = -1;
let isRunning = false;
let lastResults = null;
let audioContext = null;
let manualMuted = false;

renderChordLists();
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

startButton.addEventListener("click", startApp);
muteButton.addEventListener("click", toggleMute);
volumeControl.addEventListener("input", () => {
  for (const controller of Object.values(controllers)) {
    controller.synth.setVolume(Number(volumeControl.value));
  }
});
smoothControl.addEventListener("input", () => {
  for (const controller of Object.values(controllers)) {
    controller.smoothedPointer = null;
  }
});
swapHandsControl.addEventListener("change", () => {
  for (const controller of Object.values(controllers)) {
    controller.smoothedPointer = null;
  }
});

async function startApp() {
  if (isRunning) return;

  setStatus("Carregando áudio e rastreamento...", "");
  startButton.disabled = true;

  try {
    await setupAudio();
    await setupCamera();
    await setupHandLandmarker();

    selectChord(controllers.left, 0);
    selectChord(controllers.right, 0);

    isRunning = true;
    muteButton.disabled = false;
    startButton.textContent = "Linhando";
    setStatus("Rastreamento ativo", "ok");
    predictWebcam();
  } catch (error) {
    console.error(error);
    startButton.disabled = false;
    startButton.textContent = "Tentar novamente";
    setStatus(`Erro: ${error.message}`, "warn");
  }
}

async function setupAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("Este navegador não tem suporte à Web Audio API.");
  }

  if (!audioContext) {
    audioContext = new AudioContextClass();
  }

  await audioContext.resume();

  for (const controller of Object.values(controllers)) {
    controller.synth.init(audioContext, Number(volumeControl.value));
  }
}

async function setupCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador não liberou acesso à câmera.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      facingMode: "user"
    },
    audio: false
  });

  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = () => resolve();
  });

  await video.play();
  resizeCanvas();
}

async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm"
  );

  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 2
    });
  } catch (gpuError) {
    console.warn("GPU falhou, tentando CPU", gpuError);
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numHands: 2
    });
  }
}

function predictWebcam() {
  if (!handLandmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    animationFrameId = requestAnimationFrame(predictWebcam);
    return;
  }

  resizeCanvas();
  resetFrameState();
  clearScene();

  const startTimeMs = performance.now();
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    lastResults = handLandmarker.detectForVideo(video, startTimeMs);
  }

  if (lastResults?.landmarks?.length) {
    const assignments = assignHands(lastResults);

    for (const assignment of assignments) {
      updateControllerFromHand(assignment.controller, assignment.landmarks);
    }

    drawChordKeys(controllers.left);
    drawChordKeys(controllers.right);

    for (const assignment of assignments) {
      drawHand(assignment.landmarks, assignment.controller);
      drawPointer(assignment.controller.smoothedPointer, assignment.controller);
    }

    updateStatusFromControllers();
  } else {
    drawChordKeys(controllers.left);
    drawChordKeys(controllers.right);
    setStatus("Mostre as mãos para a câmera", "");
  }

  animationFrameId = requestAnimationFrame(predictWebcam);
}

function resetFrameState() {
  for (const controller of Object.values(controllers)) {
    controller.seenThisFrame = false;
  }
}

function assignHands(results) {
  const candidates = results.landmarks.map((landmarks, index) => {
    const detectedLabel = getHandednessLabel(results, index);
    const controllerId = normalizeHandLabel(detectedLabel, landmarks);
    const finalControllerId = swapHandsControl.checked ? oppositeHand(controllerId) : controllerId;
    return {
      landmarks,
      controller: controllers[finalControllerId],
      score: scoreHandForController(landmarks, controllers[finalControllerId])
    };
  });

  const assignments = [];
  const usedControllers = new Set();

  candidates
    .sort((a, b) => a.score - b.score)
    .forEach((candidate) => {
      let controller = candidate.controller;

      if (usedControllers.has(controller.id)) {
        const fallback = controllers[oppositeHand(controller.id)];
        if (!fallback || usedControllers.has(fallback.id)) return;
        controller = fallback;
      }

      assignments.push({ ...candidate, controller });
      usedControllers.add(controller.id);
    });

  return assignments;
}

function getHandednessLabel(results, index) {
  return results.handednesses?.[index]?.[0]?.categoryName ?? results.handedness?.[index]?.[0]?.categoryName ?? "";
}

function normalizeHandLabel(label, landmarks) {
  const normalized = String(label).toLowerCase();

  if (normalized.includes("left")) return "left";
  if (normalized.includes("right")) return "right";

  const pointer = getMirroredPoint(landmarks[8]);
  const { width } = getCanvasSize();
  return pointer.x < width / 2 ? "left" : "right";
}

function oppositeHand(controllerId) {
  return controllerId === "left" ? "right" : "left";
}

function scoreHandForController(landmarks, controller) {
  const pointer = getMirroredPoint(landmarks[8]);
  const geometry = getKeyLineGeometry(controller);
  const centerX = geometry.x + geometry.width / 2;
  const clampedY = clamp(pointer.y, geometry.y, geometry.y + geometry.height);
  const horizontalDistance = Math.abs(pointer.x - centerX);
  const verticalDistance = Math.abs(pointer.y - clampedY);
  return horizontalDistance + verticalDistance * 0.35;
}

function updateControllerFromHand(controller, landmarks) {
  const pointer = getMirroredPoint(landmarks[8]);
  const smoothAmount = Number(smoothControl.value);

  controller.seenThisFrame = true;
  controller.lastPointer = pointer;
  controller.smoothedPointer = smoothPoint(controller.smoothedPointer, pointer, smoothAmount);

  updateGestureMute(controller, landmarks);

  if (controller.gestureMuted) {
    controller.hintDisplay.textContent = "Punho fechado: esta linha está silenciada.";
    return;
  }

  updateChordFromPointer(controller, controller.smoothedPointer);
}

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function getCanvasSize() {
  return {
    width: canvas.clientWidth,
    height: canvas.clientHeight
  };
}

function getKeyLineGeometry(controller) {
  const { width, height } = getCanvasSize();
  const isNarrow = width < 760;
  const chordCount = controller.chords.length;
  const marginX = isNarrow ? width * 0.035 : Math.max(20, width * 0.024);
  const top = isNarrow ? Math.max(74, height * 0.14) : Math.max(86, height * 0.12);
  const bottom = isNarrow ? Math.max(26, height * 0.05) : Math.max(38, height * 0.06);
  const availableHeight = Math.max(260, height - top - bottom);
  const keyWidth = isNarrow
    ? Math.min(126, width * 0.26)
    : Math.min(194, Math.max(142, width * 0.112));
  const gap = Math.max(4, Math.min(9, availableHeight * 0.008));
  const segmentHeight = availableHeight / chordCount;
  const keyHeight = Math.max(18, segmentHeight - gap);
  const hitPadding = isNarrow ? 28 : 42;

  return {
    x: controller.id === "left" ? marginX : width - marginX - keyWidth,
    y: top,
    width: keyWidth,
    height: availableHeight,
    gap,
    segmentHeight,
    keyHeight,
    hitPadding
  };
}

function clearScene() {
  const { width, height } = getCanvasSize();
  ctx.clearRect(0, 0, width, height);
}

function drawChordKeys(controller) {
  const geometry = getKeyLineGeometry(controller);
  const { x, y, width, height, gap, segmentHeight, keyHeight } = geometry;
  const label = controller.id === "left" ? "MENORES" : "MAIORES";

  ctx.save();

  ctx.fillStyle = "rgba(5, 8, 15, 0.42)";
  ctx.strokeStyle = controller.gestureMuted ? "rgba(255, 143, 143, 0.62)" : "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 2;
  roundRect(ctx, x - 8, y - 42, width + 16, height + 54, 22);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = controller.gestureMuted ? "rgba(255, 180, 180, 0.94)" : "rgba(244, 247, 251, 0.86)";
  ctx.font = "900 15px Inter, system-ui, sans-serif";
  ctx.fillText(label, x + width / 2, y - 20);

  for (let index = 0; index < controller.chords.length; index += 1) {
    const keyY = y + index * segmentHeight + gap / 2;
    const isActive = index === controller.selectedChordIndex;

    ctx.beginPath();
    roundRect(ctx, x, keyY, width, keyHeight, 15);
    ctx.fillStyle = isActive && !controller.gestureMuted ? controller.accent : "rgba(255, 255, 255, 0.105)";
    ctx.strokeStyle = isActive && !controller.gestureMuted ? controller.accentStrong : "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = isActive && !controller.gestureMuted ? 3 : 1.5;
    ctx.fill();
    ctx.stroke();

    if (isActive && !controller.gestureMuted) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
      roundRect(ctx, x + 8, keyY + 7, width - 16, Math.max(4, keyHeight * 0.16), 999);
      ctx.fill();
    }

    ctx.fillStyle = isActive && !controller.gestureMuted ? controller.textOnAccent : "rgba(244, 247, 251, 0.92)";
    ctx.font = `900 ${Math.max(15, Math.min(26, keyHeight * 0.44))}px Inter, system-ui, sans-serif`;
    ctx.fillText(controller.chords[index].label, x + width / 2, keyY + keyHeight / 2);
  }

  if (controller.gestureMuted) {
    ctx.fillStyle = "rgba(40, 12, 18, 0.46)";
    roundRect(ctx, x, y, width, height, 18);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 210, 210, 0.94)";
    ctx.font = "900 18px Inter, system-ui, sans-serif";
    ctx.fillText("SILENCIADO", x + width / 2, y + height / 2);
  }

  ctx.restore();
}

function roundRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  if (typeof context.roundRect === "function") {
    context.beginPath();
    context.roundRect(x, y, width, height, safeRadius);
    return;
  }

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
}

function getMirroredPoint(landmark) {
  const { width, height } = getCanvasSize();
  return {
    x: (1 - landmark.x) * width,
    y: landmark.y * height
  };
}

function smoothPoint(previous, next, amount) {
  if (!previous) return next;

  return {
    x: previous.x * amount + next.x * (1 - amount),
    y: previous.y * amount + next.y * (1 - amount)
  };
}

function updateGestureMute(controller, landmarks) {
  const fistClosed = isFistClosed(landmarks);

  if (fistClosed) {
    controller.fistFrames += 1;
    controller.openFrames = 0;
  } else {
    controller.openFrames += 1;
    controller.fistFrames = 0;
  }

  if (controller.fistFrames >= 4 && !controller.gestureMuted) {
    controller.gestureMuted = true;
    controller.synth.setGestureMuted(true);
  }

  if (controller.openFrames >= 4 && controller.gestureMuted) {
    controller.gestureMuted = false;
    controller.synth.setGestureMuted(false);
  }
}

function isFistClosed(hand) {
  const palmCenter = averagePoint([hand[0], hand[5], hand[9], hand[13], hand[17]]);
  const wrist = hand[0];
  const fingers = [
    { tip: hand[8], pip: hand[6], mcp: hand[5] },
    { tip: hand[12], pip: hand[10], mcp: hand[9] },
    { tip: hand[16], pip: hand[14], mcp: hand[13] },
    { tip: hand[20], pip: hand[18], mcp: hand[17] }
  ];

  let extendedFingers = 0;
  let curledFingers = 0;

  for (const finger of fingers) {
    const tipToPalm = distance3d(finger.tip, palmCenter);
    const pipToPalm = distance3d(finger.pip, palmCenter);
    const mcpToPalm = distance3d(finger.mcp, palmCenter);
    const tipToWrist = distance3d(finger.tip, wrist);
    const pipToWrist = distance3d(finger.pip, wrist);

    const isExtended = tipToPalm > pipToPalm * 1.12 && tipToPalm > mcpToPalm * 1.22;
    const isCurled = tipToPalm <= pipToPalm * 1.08 || tipToWrist <= pipToWrist * 1.05;

    if (isExtended) extendedFingers += 1;
    if (isCurled) curledFingers += 1;
  }

  return curledFingers >= 3 && extendedFingers <= 1;
}

function averagePoint(points) {
  return points.reduce(
    (acc, point) => ({
      x: acc.x + point.x / points.length,
      y: acc.y + point.y / points.length,
      z: acc.z + (point.z ?? 0) / points.length
    }),
    { x: 0, y: 0, z: 0 }
  );
}

function distance3d(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
}

function updateChordFromPointer(controller, pointer) {
  const geometry = getKeyLineGeometry(controller);
  const hitLeft = geometry.x - geometry.hitPadding;
  const hitRight = geometry.x + geometry.width + geometry.hitPadding;
  const hitTop = geometry.y;
  const hitBottom = geometry.y + geometry.height;

  if (pointer.x < hitLeft || pointer.x > hitRight || pointer.y < hitTop || pointer.y > hitBottom) {
    const side = controller.id === "left" ? "esquerda" : "direita";
    controller.hintDisplay.textContent = `Mova o indicador da ${controller.handLabel.toLowerCase()} para a linha de teclas da ${side}.`;
    return;
  }

  const relativeY = clamp(pointer.y - geometry.y, 0, geometry.height - 1);
  const index = clamp(
    Math.floor(relativeY / geometry.segmentHeight),
    0,
    controller.chords.length - 1
  );

  selectChord(controller, index);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function selectChord(controller, index) {
  if (index === controller.selectedChordIndex) return;

  controller.selectedChordIndex = index;
  const chord = controller.chords[index];
  const frequencies = getChordFrequencies(chord);

  controller.synth.setChord(frequencies);
  controller.chordDisplay.textContent = chord.label;
  controller.hintDisplay.textContent = `Tocando ${chord.label} ${qualityLabel(chord.quality)}.`;

  controller.listElement.querySelectorAll(".chord-pill").forEach((pill, pillIndex) => {
    pill.classList.toggle("active", pillIndex === index);
  });
}

function drawHand(landmarks, controller) {
  const points = landmarks.map(getMirroredPoint);

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = controller.skeleton;
  ctx.fillStyle = controller.skeleton;

  for (const [start, end] of HAND_CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(points[start].x, points[start].y);
    ctx.lineTo(points[end].x, points[end].y);
    ctx.stroke();
  }

  for (const point of points) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawPointer(point, controller) {
  if (!point) return;

  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
  ctx.fillStyle = controller.gestureMuted ? "rgba(255, 143, 143, 0.30)" : "rgba(255, 255, 255, 0.24)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = controller.gestureMuted ? "rgba(255, 143, 143, 0.95)" : controller.accentStrong;
  ctx.stroke();
  ctx.restore();
}

function renderChordLists() {
  renderChordList(controllers.left);
  renderChordList(controllers.right);
}

function renderChordList(controller) {
  controller.listElement.innerHTML = "";

  controller.chords.forEach((chord) => {
    const pill = document.createElement("span");
    pill.className = `chord-pill ${controller.id}`;
    pill.textContent = chord.label;
    controller.listElement.appendChild(pill);
  });
}

function updateStatusFromControllers() {
  const leftSeen = controllers.left.seenThisFrame;
  const rightSeen = controllers.right.seenThisFrame;

  if (leftSeen && rightSeen) {
    const mutedParts = [];
    if (controllers.left.gestureMuted) mutedParts.push("esquerda silenciada");
    if (controllers.right.gestureMuted) mutedParts.push("direita silenciada");
    setStatus(mutedParts.length ? `Duas mãos detectadas · ${mutedParts.join(" · ")}` : "Duas mãos detectadas", "ok");
    return;
  }

  if (leftSeen) {
    setStatus(controllers.left.gestureMuted ? "Mão esquerda em punho: linha menor silenciada" : "Mão esquerda detectada", "ok");
    return;
  }

  if (rightSeen) {
    setStatus(controllers.right.gestureMuted ? "Mão direita em punho: linha maior silenciada" : "Mão direita detectada", "ok");
    return;
  }

  setStatus("Mostre as mãos para a câmera", "");
}

function setStatus(message, type) {
  trackingStatus.textContent = message;
  trackingStatus.classList.toggle("ok", type === "ok");
  trackingStatus.classList.toggle("warn", type === "warn");
}

async function toggleMute() {
  manualMuted = !manualMuted;

  for (const controller of Object.values(controllers)) {
    controller.synth.setManualMuted(manualMuted);
  }

  muteButton.textContent = manualMuted ? "Ativar tudo" : "Silenciar tudo";
}

function qualityLabel(quality) {
  const labels = {
    major: "maior",
    minor: "menor",
    diminished: "diminuto",
    augmented: "aumentado",
    sus2: "sus2",
    sus4: "sus4",
    major7: "maior com sétima maior",
    minor7: "menor com sétima",
    dominant7: "com sétima"
  };

  return labels[quality] ?? quality;
}


window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(animationFrameId);
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
});
