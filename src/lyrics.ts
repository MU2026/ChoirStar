import type { Part } from "./model";
import { midiToNote } from "./vendor/openvox/core/music/notes";
import { staffYForEvent } from "./vendor/openvox/core/music/scoreModel";

export function lyricLayout(part: Part) {
  // Empty verses (common in exports) must not consume vertical space.
  const verses = [
    ...new Set((part.lyrics || []).filter((l) => l.text).map((l) => l.verse)),
  ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const clef =
    part.clef ??
    (part.notes.reduce((sum, n) => sum + n.midi, 0) / part.notes.length < 60
      ? "bass"
      : "treble");
  const bottom = part.notes.reduce(
    (max, n) =>
      Math.max(
        max,
        staffYForEvent(
          {
            ...midiToNote(n.midi),
            ...n.spelling,
            midi: n.midi,
            id: n.id,
            start: 0,
            duration: 1,
            velocity: 1,
            confidence: 1,
          },
          122,
          clef,
        ) - 77,
      ),
    0,
  );
  const top = Math.max(100, bottom + 20);
  return {
    verses,
    top,
    height: verses.length ? top + verses.length * 20 + 6 : 100,
    lines: verses.map((verse) => {
      const events = (part.lyrics || [])
        .filter((l) => l.verse === verse)
        .sort((a, b) => a.tick - b.tick);
      const segments: ((typeof events)[number] & {
        end: number;
        next?: number;
      })[] = [];
      let active: (typeof segments)[number] | undefined;
      let extending = false;
      for (const event of events) {
        if (event.text) {
          if (active) {
            active.next = event.tick;
            active.end = Math.min(active.end, event.tick);
          }
          active = { ...event, end: event.tick + event.length };
          segments.push(active);
          extending = !!event.extend && event.extend !== "stop";
        } else if (event.extend && extending && active) {
          active.end = Math.max(active.end, event.tick + event.length);
          if (event.extend === "stop") extending = false;
        }
      }
      return segments;
    }),
  };
}
