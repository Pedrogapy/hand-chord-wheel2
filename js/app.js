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
    chordGroupLabel: "menores",
    chords: MINOR_CHORDS,
    selectedChordIndex: -1,
    smoothedPointer: null,
    gestureMuted: false,
    closedFrames: 0,
    openFrames: 0,
    poseState: "unknown",
    seenThisFrame: false,
    lastPointer: null,
    synth: new ChordSynth("left"),
    chordDisplay: document.querySelector("#leftChord"),
    hintDisplay: document.querySelector("#leftHint"),
    listElement: minorChordList,
    accent: "rgba(221, 164, 255, 0.70)",
    accentStrong: "rgba(238, 215, 255, 0.98)",
    skeleton: "rgba(221, 164, 255, 0.84)",
    textOnAccent: "#16081f",
    wheelTitle: "MENORES"
  },
  right: {
    id: "right",
    handLabel: "Mão direita",
    chordGroupLabel: "maiores",
    chords: MAJOR_CHORDS,
    selectedChordIndex: -1,
    smoothedPointer: null,
    gestureMuted: false,
    closedFrames: 0,
    openFrames: 0,
    poseState: "unknown",
    seenThisFrame: false,
    lastPointer: null,
    synth: new ChordSynth("right"),
    chordDisplay: document.querySelector("#rightChord"),
    hintDisplay: document.querySelector("#rightHint"),
    listElement: majorChordList,
    accent: "rgba(143, 211, 255, 0.70)",
    accentStrong: "rgba(213, 241, 255, 0.98)",
    skeleton: "rgba(163, 255, 207, 0.82)",
    textOnAccent: "#07111f",
    wheelTitle: "MAIORES"
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
  for (const controller of Object.values(controllers)) controller.synth.setVolume(Number(volumeControl.value));
});
smoothControl.addEventListener("input", () => {
  for (const controller of Object.values(controllers)) controller.smoothedPointer = null;
});
swapHandsControl.addEventListener("change", () => {
  for (const controller of Object.values(controllers)) controller.smoothedPointer = null;
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
    startButton.textContent = "Rodando";
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
  if (!AudioContextClass) throw new Error("Este navegador não tem suporte à Web Audio API.");
  if (!audioContext) audioContext = new AudioContextClass();
  await audioContext.resume();
  for (const controller of Object.values(controllers)) controller.synth.init(audioContext, Number(volumeControl.value));
}

async function setupCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Este navegador não liberou acesso à câmera.");
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" },
    audio: false
  });
  video.srcObject = stream;
  await new Promise((resolve) => { video.onloadedmetadata = () => resolve(); });
  await video.play();
  resizeCanvas();
}

async function setupHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm");
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
    for (const assignment of assignments) updateControllerFromHand(assignment.controller, assignment.landmarks);
    drawChordWheel(controllers.left);
    drawChordWheel(controllers.right);
    for (const assignment of assignments) {
      drawHand(assignment.landmarks, assignment.controller);
      drawPointer(assignment.controller.smoothedPointer, assignment.controller);
    }
    updateStatusFromControllers();
  } else {
    drawChordWheel(controllers.left);
    drawChordWheel(controllers.right);
    setStatus("Mostre as mãos para a câmera", "");
  }

  animationFrameId = requestAnimationFrame(predictWebcam);
}

function resetFrameState() { for (const controller of Object.values(controllers)) controller.seenThisFrame = false; }

function assignHands(results) {
  const candidates = results.landmarks.map((landmarks, index) => {
    const detectedLabel = getHandednessLabel(results, index);
    const controllerId = normalizeHandLabel(detectedLabel, landmarks);
    const finalControllerId = swapHandsControl.checked ? oppositeHand(controllerId) : controllerId;
    return { landmarks, controller: controllers[finalControllerId], score: scoreHandForController(landmarks, controllers[finalControllerId]) };
  });

  const assignments = [];
  const usedControllers = new Set();
  candidates.sort((a, b) => a.score - b.score).forEach((candidate) => {
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

function oppositeHand(controllerId) { return controllerId === "left" ? "right" : "left"; }

function scoreHandForController(landmarks, controller) {
  const pointer = getMirroredPoint(landmarks[8]);
  const geometry = getWheelGeometry(controller);
  const dx = pointer.x - geometry.cx;
  const dy = pointer.y - geometry.cy;
  const radialDistance = Math.abs(Math.hypot(dx, dy) - geometry.selectionRadius);
  const sidePenalty = controller.id === "left" ? Math.max(0, pointer.x - geometry.cx) : Math.max(0, geometry.cx - pointer.x);
  return radialDistance * 0.6 + sidePenalty * 0.4;
}

function updateControllerFromHand(controller, landmarks) {
  const pointer = getMirroredPoint(landmarks[8]);
  const smoothAmount = Number(smoothControl.value);
  controller.seenThisFrame = true;
  controller.lastPointer = pointer;
  controller.smoothedPointer = smoothPoint(controller.smoothedPointer, pointer, smoothAmount);
  updateGestureMute(controller, landmarks);
  if (controller.gestureMuted) {
    controller.hintDisplay.textContent = "Punho fechado: esta roda está silenciada.";
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

function getCanvasSize() { return { width: canvas.clientWidth, height: canvas.clientHeight }; }

function getWheelGeometry(controller) {
  const { width, height } = getCanvasSize();
  const isNarrow = width < 920;
  const outerRadius = clamp(Math.min(width * (isNarrow ? 0.19 : 0.15), height * 0.26), 110, isNarrow ? 170 : 190);
  const innerRadius = outerRadius * 0.42;
  const selectionRadius = (innerRadius + outerRadius) / 2;
  const segmentAngle = (Math.PI * 2) / controller.chords.length;
  const startAngle = -Math.PI / 2;
  const hitPadding = 22;
  let cx;
  let cy;
  if (isNarrow) {
    cx = width / 2;
    cy = controller.id === "left" ? height * 0.34 : height * 0.72;
  } else {
    cx = controller.id === "left" ? width * 0.25 : width * 0.75;
    cy = height * 0.62;
  }
  return { cx, cy, outerRadius, innerRadius, selectionRadius, segmentAngle, startAngle, hitPadding, titleY: cy - outerRadius - 22 };
}

function clearScene() { const { width, height } = getCanvasSize(); ctx.clearRect(0, 0, width, height); }

function drawChordWheel(controller) {
  const geometry = getWheelGeometry(controller);
  const { cx, cy, outerRadius, innerRadius, segmentAngle, startAngle, titleY } = geometry;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = controller.gestureMuted ? "rgba(40, 12, 18, 0.30)" : "rgba(5, 8, 15, 0.28)";
  ctx.strokeStyle = controller.gestureMuted ? "rgba(255, 143, 143, 0.72)" : "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius + 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = controller.gestureMuted ? "rgba(255, 180, 180, 0.96)" : "rgba(244, 247, 251, 0.92)";
  ctx.font = "900 18px Inter, system-ui, sans-serif";
  ctx.fillText(controller.wheelTitle, cx, titleY);

  for (let index = 0; index < controller.chords.length; index += 1) {
    const angleStart = startAngle + index * segmentAngle;
    const angleEnd = angleStart + segmentAngle;
    const midAngle = angleStart + segmentAngle / 2;
    const isActive = index === controller.selectedChordIndex && !controller.gestureMuted;
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, angleStart, angleEnd);
    ctx.arc(cx, cy, innerRadius, angleEnd, angleStart, true);
    ctx.closePath();
    ctx.fillStyle = isActive ? controller.accent : "rgba(255, 255, 255, 0.10)";
    ctx.strokeStyle = isActive ? controller.accentStrong : "rgba(255, 255, 255, 0.18)";
    ctx.lineWidth = isActive ? 3 : 1.5;
    ctx.fill();
    ctx.stroke();
    const labelRadius = innerRadius + (outerRadius - innerRadius) * 0.56;
    const tx = cx + Math.cos(midAngle) * labelRadius;
    const ty = cy + Math.sin(midAngle) * labelRadius;
    ctx.fillStyle = isActive ? controller.textOnAccent : "rgba(244, 247, 251, 0.95)";
    ctx.font = `900 ${Math.max(12, Math.min(22, outerRadius * 0.17))}px Inter, system-ui, sans-serif`;
    ctx.fillText(controller.chords[index].label, tx, ty);
  }

  ctx.beginPath();
  ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2);
  ctx.fillStyle = controller.gestureMuted ? "rgba(65, 18, 24, 0.86)" : "rgba(6, 10, 18, 0.92)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = controller.gestureMuted ? "rgba(255, 143, 143, 0.78)" : "rgba(255, 255, 255, 0.16)";
  ctx.stroke();

  if (controller.gestureMuted) {
    ctx.fillStyle = "rgba(255, 210, 210, 0.96)";
    ctx.font = "900 18px Inter, system-ui, sans-serif";
    ctx.fillText("SILENCIADO", cx, cy - 6);
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(255, 220, 220, 0.92)";
    ctx.fillText("Abra a mão para voltar", cx, cy + 16);
  } else {
    ctx.fillStyle = "rgba(200, 210, 226, 0.92)";
    ctx.font = "900 14px Inter, system-ui, sans-serif";
    ctx.fillText("ZONA NEUTRA", cx, cy - 6);
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    ctx.fillStyle = "rgba(174, 184, 202, 0.94)";
    ctx.fillText("no centro não troca", cx, cy + 16);
  }
  ctx.restore();
}

function getMirroredPoint(landmark) {
  const { width, height } = getCanvasSize();
  return { x: (1 - landmark.x) * width, y: landmark.y * height };
}

function smoothPoint(previous, next, amount) {
  if (!previous) return next;
  return { x: previous.x * amount + next.x * (1 - amount), y: previous.y * amount + next.y * (1 - amount) };
}

function updateGestureMute(controller, landmarks) {
  const pose = classifyHandPose(landmarks);
  controller.poseState = pose;
  if (pose === "closed") {
    controller.closedFrames += 1;
    controller.openFrames = 0;
  } else if (pose === "open") {
    controller.openFrames += 1;
    controller.closedFrames = 0;
  } else {
    controller.closedFrames = Math.max(0, controller.closedFrames - 1);
    controller.openFrames = Math.max(0, controller.openFrames - 1);
  }
  if (controller.closedFrames >= 3 && !controller.gestureMuted) {
    controller.gestureMuted = true;
    controller.synth.setGestureMuted(true);
  }
  if (controller.openFrames >= 3 && controller.gestureMuted) {
    controller.gestureMuted = false;
    controller.synth.setGestureMuted(false);
  }
}

function classifyHandPose(hand) {
  const palmCenter = averagePoint([hand[0], hand[5], hand[9], hand[13], hand[17]]);
  const wrist = hand[0];
  const fingerDefs = [
    { tip: hand[8], pip: hand[6], mcp: hand[5] },
    { tip: hand[12], pip: hand[10], mcp: hand[9] },
    { tip: hand[16], pip: hand[14], mcp: hand[13] },
    { tip: hand[20], pip: hand[18], mcp: hand[17] }
  ];
  let extendedCount = 0;
  let curledCount = 0;
  for (const finger of fingerDefs) {
    const tipToPalm = distance3d(finger.tip, palmCenter);
    const pipToPalm = distance3d(finger.pip, palmCenter);
    const mcpToPalm = distance3d(finger.mcp, palmCenter);
    const tipToWrist = distance3d(finger.tip, wrist);
    const pipToWrist = distance3d(finger.pip, wrist);
    const extended = tipToPalm > pipToPalm * 1.16 && tipToPalm > mcpToPalm * 1.34 && tipToWrist > pipToWrist * 1.08;
    const curled = tipToPalm < pipToPalm * 1.04 || tipToWrist < pipToWrist * 1.02;
    if (extended) extendedCount += 1;
    if (curled) curledCount += 1;
  }
  const thumbTip = hand[4];
  const thumbIp = hand[3];
  const thumbMcp = hand[2];
  const indexMcp = hand[5];
  const thumbExtended = distance3d(thumbTip, indexMcp) > distance3d(thumbIp, indexMcp) * 1.15 && distance3d(thumbTip, wrist) > distance3d(thumbMcp, wrist) * 1.05;
  const thumbCurled = distance3d(thumbTip, palmCenter) < distance3d(thumbIp, palmCenter) * 1.05;
  const openScore = extendedCount + (thumbExtended ? 1 : 0);
  const closedScore = curledCount + (thumbCurled ? 1 : 0);
  if (openScore >= 4 && curledCount <= 1) return "open";
  if (closedScore >= 4 && extendedCount <= 1) return "closed";
  return "other";
}

function averagePoint(points) {
  return points.reduce((acc, point) => ({
    x: acc.x + point.x / points.length,
    y: acc.y + point.y / points.length,
    z: acc.z + (point.z ?? 0) / points.length
  }), { x: 0, y: 0, z: 0 });
}

function distance3d(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0)); }

function updateChordFromPointer(controller, pointer) {
  const geometry = getWheelGeometry(controller);
  const dx = pointer.x - geometry.cx;
  const dy = pointer.y - geometry.cy;
  const radius = Math.hypot(dx, dy);
  if (radius < geometry.innerRadius) {
    controller.hintDisplay.textContent = "Centro da roda: zona neutra. No meio não há troca de nota.";
    return;
  }
  if (radius > geometry.outerRadius + geometry.hitPadding) {
    controller.hintDisplay.textContent = `Mova o indicador da ${controller.handLabel.toLowerCase()} para a roda de acordes ${controller.chordGroupLabel}.`;
    return;
  }
  const angle = normalizeAngle(Math.atan2(dy, dx) - geometry.startAngle);
  const index = clamp(Math.floor(angle / geometry.segmentAngle), 0, controller.chords.length - 1);
  selectChord(controller, index);
}

function normalizeAngle(angle) { const turn = Math.PI * 2; return ((angle % turn) + turn) % turn; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function selectChord(controller, index) {
  if (index === controller.selectedChordIndex) return;
  controller.selectedChordIndex = index;
  const chord = controller.chords[index];
  controller.synth.setChord(getChordFrequencies(chord));
  controller.chordDisplay.textContent = chord.label;
  controller.hintDisplay.textContent = `Tocando ${chord.label} ${qualityLabel(chord.quality)}.`;
  controller.listElement.querySelectorAll(".chord-pill").forEach((pill, pillIndex) => pill.classList.toggle("active", pillIndex === index));
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

function renderChordLists() { renderChordList(controllers.left); renderChordList(controllers.right); }
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
  if (leftSeen) { setStatus(controllers.left.gestureMuted ? "Mão esquerda em punho: roda menor silenciada" : "Mão esquerda detectada", "ok"); return; }
  if (rightSeen) { setStatus(controllers.right.gestureMuted ? "Mão direita em punho: roda maior silenciada" : "Mão direita detectada", "ok"); return; }
  setStatus("Mostre as mãos para a câmera", "");
}

function setStatus(message, type) {
  trackingStatus.textContent = message;
  trackingStatus.classList.toggle("ok", type === "ok");
  trackingStatus.classList.toggle("warn", type === "warn");
}

async function toggleMute() {
  manualMuted = !manualMuted;
  for (const controller of Object.values(controllers)) controller.synth.setManualMuted(manualMuted);
  muteButton.textContent = manualMuted ? "Ativar tudo" : "Silenciar tudo";
}

function qualityLabel(quality) {
  const labels = { major: "maior", minor: "menor", diminished: "diminuto", augmented: "aumentado", sus2: "sus2", sus4: "sus4", major7: "maior com sétima maior", minor7: "menor com sétima", dominant7: "com sétima" };
  return labels[quality] ?? quality;
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(animationFrameId);
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  if (audioContext?.state !== "closed") audioContext?.close();
});
