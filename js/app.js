import { FilesetResolver, HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
import { CHORDS, getChordFrequencies } from "./chords.js";

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17]
];

const video = document.querySelector("#webcam");
const canvas = document.querySelector("#overlay");
const ctx = canvas.getContext("2d");
const stage = document.querySelector("#stage");
const startButton = document.querySelector("#startButton");
const muteButton = document.querySelector("#muteButton");
const trackingStatus = document.querySelector("#trackingStatus");
const currentChord = document.querySelector("#currentChord");
const currentHint = document.querySelector("#currentHint");
const volumeControl = document.querySelector("#volumeControl");
const smoothControl = document.querySelector("#smoothControl");
const chordList = document.querySelector("#chordList");

let handLandmarker;
let animationFrameId;
let lastVideoTime = -1;
let selectedChordIndex = -1;
let smoothedPointer = null;
let isRunning = false;
let lastResults = null;

const synth = new ChordSynth();

renderChordList();
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

startButton.addEventListener("click", startApp);
muteButton.addEventListener("click", toggleMute);
volumeControl.addEventListener("input", () => synth.setVolume(Number(volumeControl.value)));
smoothControl.addEventListener("input", () => {
  smoothedPointer = null;
});

async function startApp() {
  if (isRunning) return;

  setStatus("Carregando áudio e rastreamento...", "");
  startButton.disabled = true;

  try {
    await synth.init(Number(volumeControl.value));
    await setupCamera();
    await setupHandLandmarker();

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

async function setupCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador não liberou acesso à câmera.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
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
  drawBaseScene();

  const startTimeMs = performance.now();
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;
    lastResults = handLandmarker.detectForVideo(video, startTimeMs);
  }

  if (lastResults?.landmarks?.length) {
    const primaryHand = choosePrimaryHand(lastResults.landmarks);
    const pointer = getMirroredPoint(primaryHand[8]);
    const smoothAmount = Number(smoothControl.value);

    smoothedPointer = smoothPoint(smoothedPointer, pointer, smoothAmount);
    drawHands(lastResults.landmarks);
    drawPointer(smoothedPointer);
    updateChordFromPointer(smoothedPointer);
    setStatus("Mão detectada", "ok");
  } else {
    setStatus("Mostre a mão para a câmera", "");
  }

  animationFrameId = requestAnimationFrame(predictWebcam);
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

function getWheelGeometry() {
  const { width, height } = getCanvasSize();
  const radius = Math.min(width, height) * 0.39;

  return {
    centerX: width * 0.5,
    centerY: height * 0.52,
    radius,
    innerRadius: radius * 0.23
  };
}

function drawBaseScene() {
  const { width, height } = getCanvasSize();
  ctx.clearRect(0, 0, width, height);
  drawChordWheel();
}

function drawChordWheel() {
  const { centerX, centerY, radius, innerRadius } = getWheelGeometry();
  const sector = (Math.PI * 2) / CHORDS.length;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "800 18px Inter, system-ui, sans-serif";

  for (let index = 0; index < CHORDS.length; index += 1) {
    const start = -Math.PI / 2 + index * sector;
    const end = start + sector;
    const isActive = index === selectedChordIndex;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = isActive ? "rgba(143, 211, 255, 0.60)" : "rgba(255, 255, 255, 0.10)";
    ctx.strokeStyle = isActive ? "rgba(213, 241, 255, 0.95)" : "rgba(255, 255, 255, 0.18)";
    ctx.fill();
    ctx.stroke();

    const textAngle = start + sector / 2;
    const textRadius = radius * 0.72;
    const textX = centerX + Math.cos(textAngle) * textRadius;
    const textY = centerY + Math.sin(textAngle) * textRadius;

    ctx.fillStyle = isActive ? "#07111f" : "rgba(244, 247, 251, 0.92)";
    ctx.fillText(CHORDS[index].label, textX, textY);
  }

  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(5, 8, 15, 0.82)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(244, 247, 251, 0.74)";
  ctx.font = "700 13px Inter, system-ui, sans-serif";
  ctx.fillText("aponte", centerX, centerY - 8);
  ctx.fillText("aqui", centerX, centerY + 10);
  ctx.restore();
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

function choosePrimaryHand(hands) {
  const { centerX, centerY, radius } = getWheelGeometry();

  return hands
    .map((hand) => {
      const pointer = getMirroredPoint(hand[8]);
      const distanceToCenter = Math.hypot(pointer.x - centerX, pointer.y - centerY);
      return { hand, score: Math.abs(distanceToCenter - radius * 0.65) };
    })
    .sort((a, b) => a.score - b.score)[0].hand;
}

function updateChordFromPointer(pointer) {
  const { centerX, centerY, radius, innerRadius } = getWheelGeometry();
  const dx = pointer.x - centerX;
  const dy = pointer.y - centerY;
  const distance = Math.hypot(dx, dy);

  if (distance < innerRadius || distance > radius) {
    currentHint.textContent = "Mova o indicador para dentro da roda de acordes.";
    return;
  }

  const angle = Math.atan2(dy, dx);
  const normalized = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  const index = Math.floor(normalized / ((Math.PI * 2) / CHORDS.length));

  selectChord(index);
}

function selectChord(index) {
  if (index === selectedChordIndex) return;

  selectedChordIndex = index;
  const chord = CHORDS[index];
  const frequencies = getChordFrequencies(chord);

  synth.setChord(frequencies);
  currentChord.textContent = chord.label;
  currentHint.textContent = `Tocando ${chord.label} ${qualityLabel(chord.quality)}.`;

  document.querySelectorAll(".chord-pill").forEach((pill, pillIndex) => {
    pill.classList.toggle("active", pillIndex === index);
  });
}

function drawHands(hands) {
  for (const hand of hands) {
    const points = hand.map(getMirroredPoint);

    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(163, 255, 207, 0.72)";
    ctx.fillStyle = "rgba(163, 255, 207, 0.95)";

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
}

function drawPointer(point) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.24)";
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.stroke();
  ctx.restore();
}

function renderChordList() {
  chordList.innerHTML = "";

  CHORDS.forEach((chord) => {
    const pill = document.createElement("span");
    pill.className = "chord-pill";
    pill.textContent = chord.label;
    chordList.appendChild(pill);
  });
}

function setStatus(message, type) {
  trackingStatus.textContent = message;
  trackingStatus.classList.toggle("ok", type === "ok");
  trackingStatus.classList.toggle("warn", type === "warn");
}

async function toggleMute() {
  const muted = await synth.toggleMute();
  muteButton.textContent = muted ? "Ativar som" : "Silenciar";
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

class ChordSynth {
  constructor() {
    this.audioContext = null;
    this.masterGain = null;
    this.filter = null;
    this.voices = [];
    this.isMuted = false;
    this.currentVolume = 0.18;
  }

  async init(volume) {
    if (this.audioContext) {
      await this.audioContext.resume();
      return;
    }

    this.currentVolume = volume;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error("Este navegador não tem suporte à Web Audio API.");
    }

    this.audioContext = new AudioContextClass();

    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = volume;

    this.filter = this.audioContext.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 1200;
    this.filter.Q.value = 0.8;

    const compressor = this.audioContext.createDynamicsCompressor();
    compressor.threshold.value = -28;
    compressor.knee.value = 24;
    compressor.ratio.value = 8;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.18;

    this.filter.connect(compressor);
    compressor.connect(this.masterGain);
    this.masterGain.connect(this.audioContext.destination);

    const defaultFrequencies = getChordFrequencies(CHORDS[0]);

    this.voices = defaultFrequencies.map((frequency, index) => this.createVoice(frequency, index));
    selectChord(0);
  }

  createVoice(frequency, index) {
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();

    oscillator.type = index === 0 ? "triangle" : "sine";
    oscillator.frequency.value = frequency;
    oscillator.detune.value = index % 2 === 0 ? -4 : 4;

    gain.gain.value = index === 0 ? 0.22 : 0.14;
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
    if (!this.masterGain || this.isMuted) return;

    const now = this.audioContext.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(volume, now, 0.035);
  }

  async toggleMute() {
    if (!this.audioContext || !this.masterGain) return this.isMuted;

    this.isMuted = !this.isMuted;
    const now = this.audioContext.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : this.currentVolume, now, 0.035);

    return this.isMuted;
  }
}

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(animationFrameId);
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
});
