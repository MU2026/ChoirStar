export const INSTRUMENTS = [
  { id: "piano", name: "Piano" },
  { id: "choir", name: "Choir aahs" },
  { id: "organ", name: "Soft organ" },
  { id: "strings", name: "Warm strings" },
] as const;
export type Instrument = (typeof INSTRUMENTS)[number]["id"];

// Additive synthesis keeps rehearsal sounds local, with no sample downloads.
// The choir emphasizes three broad vowel formants, rather than using voice recordings.
export function instrumentHarmonics(
  instrument: Instrument,
  frequency: number,
  sampleRate: number,
) {
  const harmonics = new Float32Array(65);
  for (let n = 1; n < harmonics.length; n++) {
    const hz = frequency * n;
    if (hz >= sampleRate / 2) break;
    harmonics[n] =
      instrument === "choir"
        ? (0.12 +
            1.5 * Math.exp(-(((hz - 800) / 220) ** 2)) +
            Math.exp(-(((hz - 1150) / 280) ** 2)) +
            0.6 * Math.exp(-(((hz - 2800) / 450) ** 2))) /
          n
        : instrument === "organ"
          ? ({ 1: 1, 2: 0.45, 3: 0.16, 4: 0.1 }[n] ?? 0)
          : instrument === "strings"
            ? 1 / n ** 1.4
            : Math.exp(-n / 6) / n ** 1.7;
  }
  return harmonics;
}
