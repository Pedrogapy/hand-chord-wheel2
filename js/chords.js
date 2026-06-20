export const MAJOR_CHORDS = [
  { label: "C", root: "C", quality: "major" },
  { label: "G", root: "G", quality: "major" },
  { label: "D", root: "D", quality: "major" },
  { label: "A", root: "A", quality: "major" },
  { label: "E", root: "E", quality: "major" },
  { label: "B", root: "B", quality: "major" },
  { label: "F#", root: "F#", quality: "major" },
  { label: "Db", root: "Db", quality: "major" },
  { label: "Ab", root: "Ab", quality: "major" },
  { label: "Eb", root: "Eb", quality: "major" },
  { label: "Bb", root: "Bb", quality: "major" },
  { label: "F", root: "F", quality: "major" }
];

export const MINOR_CHORDS = [
  { label: "Am", root: "A", quality: "minor" },
  { label: "Em", root: "E", quality: "minor" },
  { label: "Bm", root: "B", quality: "minor" },
  { label: "F#m", root: "F#", quality: "minor" },
  { label: "C#m", root: "C#", quality: "minor" },
  { label: "G#m", root: "G#", quality: "minor" },
  { label: "Ebm", root: "Eb", quality: "minor" },
  { label: "Bbm", root: "Bb", quality: "minor" },
  { label: "Fm", root: "F", quality: "minor" },
  { label: "Cm", root: "C", quality: "minor" },
  { label: "Gm", root: "G", quality: "minor" },
  { label: "Dm", root: "D", quality: "minor" }
];

export const CHORDS = MAJOR_CHORDS;

const ROOT_TO_MIDI = {
  C: 48,
  "C#": 49,
  Db: 49,
  D: 50,
  "D#": 51,
  Eb: 51,
  E: 52,
  F: 53,
  "F#": 54,
  Gb: 54,
  G: 55,
  "G#": 56,
  Ab: 56,
  A: 57,
  "A#": 58,
  Bb: 58,
  B: 59
};

const QUALITY_INTERVALS = {
  major: [0, 4, 7, 12],
  minor: [0, 3, 7, 12],
  diminished: [0, 3, 6, 12],
  augmented: [0, 4, 8, 12],
  sus2: [0, 2, 7, 12],
  sus4: [0, 5, 7, 12],
  major7: [0, 4, 7, 11],
  minor7: [0, 3, 7, 10],
  dominant7: [0, 4, 7, 10]
};

export function getChordFrequencies(chord) {
  const rootMidi = ROOT_TO_MIDI[chord.root];
  const intervals = QUALITY_INTERVALS[chord.quality] ?? QUALITY_INTERVALS.major;

  if (rootMidi === undefined) {
    throw new Error(`Nota raiz não reconhecida: ${chord.root}`);
  }

  return intervals.map((interval) => midiToFrequency(rootMidi + interval));
}

function midiToFrequency(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
