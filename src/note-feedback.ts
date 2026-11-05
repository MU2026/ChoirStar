import {
  assess,
  secondsAt,
  type NoteResult,
  type Part,
  type Piece,
  type Sample,
  type Settings,
} from "./model";
import { PITCH_POLL_MS } from "./pitch-analysis";

function coverage(frames: Sample[], start: number, end: number, speed: number) {
  const half = (PITCH_POLL_MS / 2000) * speed;
  let covered = 0,
    right = start;
  for (const frame of frames) {
    const left = Math.max(start, frame.time - half, right);
    const next = Math.min(end, frame.time + half);
    covered += Math.max(0, next - left);
    right = Math.max(right, next);
  }
  return covered / speed;
}

export const GRADE_COLORS = {
  Perfect: "#137d49",
  Great: "#197a9e",
  OK: "#946300",
  Poor: "#c24c21",
  Missed: "#a63052",
};
export const feedbackDelaySeconds = (settings: Pick<Settings, "offset">) =>
  0.12 + Math.max(0, settings.offset / 1000);
const grades = ["Perfect", "Great", "OK", "Poor"] as const;
const level = (value: number, limits: number[]) => {
  const i = limits.findIndex((limit) => value <= limit);
  return i < 0 ? 3 : i;
};

// Called only for newly completed notes. All times in samples use the shared
// score clock; onset tolerances below are real milliseconds at playback speed.
export function completedFeedback(
  piece: Piece,
  part: Part,
  samples: Sample[],
  settings: Settings,
  until: number,
  previous: NoteResult[] = [],
): NoteResult[] {
  const done = new Set(previous.map((r) => r.note));
  const notes = part.notes.filter(
    (n) =>
      !done.has(n.id) &&
      n.tick >= piece.bars[settings.from].start &&
      n.tick + n.length <= piece.bars[settings.to].end &&
      secondsAt(piece, n.tick + n.length) <= until,
  );
  if (!notes.length) return previous;
  const ids = new Set(notes.map((n) => n.id));
  const results = assess(
    piece,
    part,
    samples,
    settings.from,
    settings.to,
    settings.timing && !settings.speakers,
    settings.speed,
    ids,
  );
  const byId = new Map(notes.map((n) => [n.id, n]));
  return [
    ...previous,
    ...results.map((r): NoteResult => {
      const n = byId.get(r.note)!;
      const start = secondsAt(piece, n.tick),
        end = secondsAt(piece, n.tick + n.length);
      const frames = samples.filter((s) => s.time >= start && s.time < end);
      const duration = (end - start) / settings.speed;
      const voiced = frames.filter(
        (s) => s.midi !== null && s.confidence >= 0.85,
      );
      const reliable =
        coverage(voiced, start, end, settings.speed) >= duration * 0.35;
      if (r.cents === null || !reliable) {
        // Silence can be reported as missed; noisy or incomplete capture cannot.
        const silent = frames.filter(
          (s) => s.rms !== undefined && s.rms < 0.0025,
        );
        const observed = coverage(frames, start, end, settings.speed);
        const missed =
          observed >= duration * 0.6 &&
          coverage(silent, start, end, settings.speed) >= observed * 0.8;
        return {
          ...r,
          grade: missed ? "Missed" : null,
          detail: missed
            ? "No sung note detected during this note."
            : "Not assessed: insufficient reliable microphone input.",
        };
      }
      const pitch = level(r.cents, [25, 50, 100]);
      const timing =
        r.onset === null ? 0 : level(Math.abs(r.onset), [60, 120, 200]);
      return {
        ...r,
        grade: grades[Math.max(pitch, timing)],
        detail: `${Math.round(r.cents)} cents · ${r.onset === null ? "Timing unavailable; pitch grade only" : `${Math.round(r.onset)} ms onset`}`,
      };
    }),
  ];
}
