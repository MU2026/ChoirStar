import { unfold, passes, type Navigation } from "./repeats";
import {
  uid,
  type Piece,
  type Note,
  type Bar,
  type Tempo,
  type Lyric,
} from "./model";

// The browser's XML parser does not load the external MusicXML DTD. Tests
// supply a DOM document so importing this module needs no browser globals.
const children = (el: Element, name?: string): Element[] =>
  Array.from(el.childNodes)
    .filter((n): n is Element => n.nodeType === 1)
    .filter((n) => !name || n.localName === name);
const child = (el: Element, name: string) => children(el, name)[0];
const value = (el: Element, name: string, fallback = "") =>
  child(el, name)?.textContent?.trim() || fallback;
const number = (text: string, label: string, min = 0, max = 1e8) => {
  const n = Number(text);
  if (!text || !Number.isFinite(n) || n < min || n > max)
    throw new Error(`Invalid MusicXML ${label}.`);
  return n;
};
type XmlNote = Omit<Note, "id"> & {
  lyrics: Omit<Lyric, "tick" | "length">[];
  voice: string;
  tieStart: boolean;
  tieStop: boolean;
};
type Measure = Navigation & {
  notes: XmlNote[];
  length: number;
  meter: [number, number];
  key: number;
  tempos: Tempo[];
  short: boolean;
  forwardNext: boolean;
};

export function importMusicXml(
  text: string,
  filename: string,
  document?: Document,
): Piece {
  if (/<!ENTITY\b/i.test(text))
    throw new Error("MusicXML entity declarations are not supported.");
  const doc =
    document ?? new DOMParser().parseFromString(text, "application/xml");
  const root = doc.documentElement;
  if (
    doc.getElementsByTagName("parsererror").length ||
    root?.localName !== "score-partwise"
  )
    throw new Error(
      "Open an uncompressed, partwise MusicXML file (.musicxml or .xml).",
    );
  const warnings = new Set<string>();
  const ppq = 960;
  const partList = child(root, "part-list");
  const names = new Map(
    (partList ? children(partList, "score-part") : []).map((p) => [
      p.getAttribute("id"),
      value(p, "part-name", "Part"),
    ]),
  );
  const xmlParts = children(root, "part");
  if (!xmlParts.length || xmlParts.length > 64)
    throw new Error("MusicXML must contain between 1 and 64 parts.");
  const parsed = xmlParts.map((part, partIndex) => {
    let divisions = 1,
      meter: [number, number] = [4, 4],
      key = 0,
      transpose = 0;
    const clefs = new Map<string, "treble" | "bass">();
    const clefOctaves = new Map<string, number>();
    const measures = children(part, "measure");
    if (!measures.length || measures.length > 20000)
      throw new Error("Invalid or excessively long MusicXML score.");
    const bars = measures.map((measure, index): Measure => {
      let cursor = 0,
        lastStart = 0,
        extent = 0;
      const soundTicks = new Map<Element, number>();
      const notes: XmlNote[] = [],
        tempos: Tempo[] = [];
      for (const el of children(measure)) {
        if (el.localName === "attributes") {
          if (child(el, "divisions"))
            divisions = number(value(el, "divisions"), "divisions", 0.001);
          const time = child(el, "time");
          if (time)
            meter = [
              number(value(time, "beats"), "beats", 1, 64),
              number(value(time, "beat-type"), "beat type", 1, 128),
            ];
          const k = child(el, "key");
          if (k) key = number(value(k, "fifths"), "key signature", -7, 7);
          const trans = child(el, "transpose");
          if (trans)
            transpose =
              number(value(trans, "chromatic", "0"), "transposition", -48, 48) +
              12 *
                number(
                  value(trans, "octave-change", "0"),
                  "octave transposition",
                  -4,
                  4,
                );
          for (const clef of children(el, "clef")) {
            const sign = value(clef, "sign"),
              staff = clef.getAttribute("number") || "1";
            const kind = sign === "F" ? "bass" : "treble";
            const octave = Number(value(clef, "clef-octave-change", "0"));
            const supportedOctave = [-1, 0, 1].includes(octave);
            if (!["G", "F"].includes(sign) || !supportedOctave)
              warnings.add(
                "Unusual clefs are displayed using a standard treble or bass clef at sounding pitch.",
              );
            if (
              clefs.has(staff) &&
              (clefs.get(staff) !== kind ||
                clefOctaves.get(staff) !== (supportedOctave ? octave : 0))
            )
              warnings.add(
                "Clef changes are displayed using the initial clef.",
              );
            if (!clefs.has(staff)) {
              clefs.set(staff, kind);
              clefOctaves.set(staff, supportedOctave ? octave : 0);
            }
          }
        } else if (el.localName === "backup" || el.localName === "forward") {
          const duration =
            (number(value(el, "duration"), "duration", 0) * ppq) / divisions;
          cursor += el.localName === "backup" ? -duration : duration;
          if (cursor < -0.001)
            throw new Error(
              "MusicXML backup moves before the start of a measure.",
            );
          cursor = Math.max(0, cursor);
          extent = Math.max(extent, cursor);
        } else if (el.localName === "direction" || el.localName === "sound") {
          const sound = el.localName === "sound" ? el : child(el, "sound");
          if (sound)
            soundTicks.set(
              sound,
              cursor +
                (number(
                  value(sound, "offset", value(el, "offset", "0")),
                  "navigation offset",
                  -1e8,
                ) *
                  ppq) /
                  divisions,
            );
          const metro = el.getElementsByTagName("metronome")[0];
          let bpm = sound?.getAttribute("tempo")
            ? number(sound.getAttribute("tempo")!, "tempo", 1, 2000)
            : 0;
          if (!bpm && metro) {
            const units: Record<string, number> = {
              whole: 4,
              half: 2,
              quarter: 1,
              eighth: 0.5,
              "16th": 0.25,
            };
            const unit = units[value(metro, "beat-unit")];
            if (unit && child(metro, "per-minute"))
              bpm =
                number(value(metro, "per-minute"), "tempo", 1, 1000) *
                unit *
                (2 - 2 ** -children(metro, "beat-unit-dot").length);
          }
          if (bpm)
            tempos.push({
              tick: Math.max(
                0,
                cursor +
                  (number(value(el, "offset", "0"), "tempo offset", -1e8) *
                    ppq) /
                    divisions,
              ),
              bpm,
            });
        } else if (el.localName === "note") {
          if (child(el, "grace")) {
            warnings.add(
              "Grace notes are omitted from practice playback and assessment.",
            );
            continue;
          }
          const length =
            (number(value(el, "duration"), "note duration", 0.001) * ppq) /
            divisions;
          const chord = !!child(el, "chord"),
            tick = chord ? lastStart : cursor;
          if (!chord) {
            lastStart = cursor;
            cursor += length;
          }
          extent = Math.max(extent, tick + length);
          if (child(el, "rest")) continue;
          if (child(el, "unpitched")) {
            warnings.add("Unpitched percussion is omitted.");
            continue;
          }
          if (child(el, "cue")) {
            warnings.add(
              "Cue notes are omitted from practice playback and assessment.",
            );
            continue;
          }
          const pitch = child(el, "pitch");
          if (!pitch) throw new Error("MusicXML note has no pitch.");
          const step = value(pitch, "step"),
            octave = number(value(pitch, "octave"), "octave", -1, 9),
            alter = number(value(pitch, "alter", "0"), "alteration", -2, 2);
          const pc = (
            { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as Record<
              string,
              number
            >
          )[step];
          const midi = (octave + 1) * 12 + pc + alter + transpose;
          if (!Number.isInteger(midi) || midi < 0 || midi > 127)
            throw new Error(
              "Unsupported MusicXML pitch (microtones are not supported).",
            );
          const ties = children(el, "tie").map((t) => t.getAttribute("type"));
          notes.push({
            lyrics: children(el, "lyric")
              .filter(
                (l) =>
                  l.getAttribute("print-object") !== "no" &&
                  (el.getAttribute("print-lyric") !== "no" ||
                    l.getAttribute("print-object") === "yes"),
              )
              .map((l, i) => {
                const text = children(l)
                  .filter(
                    (c) => c.localName === "text" || c.localName === "elision",
                  )
                  .map(
                    (c) =>
                      c.textContent || (c.localName === "elision" ? " " : ""),
                  )
                  .join("")
                  .trim();
                const syllabic =
                  children(l, "syllabic").at(-1)?.textContent?.trim() ||
                  "single";
                const extension = child(l, "extend");
                const extend = extension?.getAttribute("type") || "start";
                if (text.length > 1000)
                  throw new Error(
                    "A MusicXML lyric exceeds the 1,000-character limit.",
                  );
                return {
                  verse:
                    l.getAttribute("number") ||
                    l.getAttribute("name") ||
                    String(i + 1),
                  text,
                  syllabic: (["single", "begin", "middle", "end"].includes(
                    syllabic,
                  )
                    ? syllabic
                    : "single") as Lyric["syllabic"],
                  ...(extension
                    ? {
                        extend: (["start", "continue", "stop"].includes(extend)
                          ? extend
                          : "start") as Lyric["extend"],
                      }
                    : {}),
                };
              })
              .filter((l) => l.text || l.extend),
            midi,
            tick,
            length,
            velocity: 0.7,
            voice: `${value(el, "staff", "1")}:${value(el, "voice", "1")}`,
            tieStart: ties.includes("start"),
            tieStop: ties.includes("stop"),
            ...(transpose === 0 && Math.abs(alter) <= 1
              ? {
                  spelling: {
                    note: step + (alter === 1 ? "♯" : alter === -1 ? "♭" : ""),
                    octave,
                  },
                }
              : {}),
          });
        }
      }
      const sounds = Array.from(measure.getElementsByTagName("sound"))
        .map((el) => {
          const result: Record<string, string> = {};
          for (const key of [
            "dacapo",
            "dalsegno",
            "segno",
            "coda",
            "tocoda",
            "fine",
            "time-only",
          ])
            if (el.hasAttribute(key)) result[key] = el.getAttribute(key)!;
          if (result["time-only"]) passes(result["time-only"]);
          const position = soundTicks.get(el) ?? 0;
          if ((result.segno || result.coda) && Math.abs(position) > 0.001)
            throw new Error(
              "Segno and Coda destinations must be at the start of a measure.",
            );
          if (
            ["dacapo", "dalsegno", "tocoda", "fine"].some(
              (key) => result[key],
            ) &&
            Math.abs(position - extent) > 0.001
          )
            throw new Error(
              "Navigation jumps and Fine must be at the end of a measure. Export split measures or an unfolded score.",
            );
          if (
            ["dacapo", "dalsegno", "tocoda", "segno", "coda", "fine"].some(
              (key) => el.hasAttribute(key) && !result[key],
            )
          )
            throw new Error(
              "Navigation instructions must name their destination.",
            );
          if (result.dacapo && result.dacapo !== "yes")
            throw new Error("Invalid da capo instruction.");
          return result;
        })
        .filter((s) => Object.keys(s).length);
      const endings = Array.from(measure.getElementsByTagName("ending")).map(
        (e) => {
          const type = e.getAttribute("type") || "";
          if (!["start", "stop", "discontinue"].includes(type))
            throw new Error("Invalid repeat ending type.");
          const location = (e.parentNode as Element).getAttribute("location");
          if (
            (type === "start" && location === "right") ||
            (type !== "start" && location === "left")
          )
            throw new Error(
              "Repeat endings must start at a measure's left edge and stop at its right edge.",
            );
          return {
            type,
            passes: passes(e.getAttribute("number") || ""),
            ...(e.getAttribute("choirstar-return-only") === "yes"
              ? { returnOnly: true }
              : {}),
          };
        },
      );
      const repeats = Array.from(measure.getElementsByTagName("repeat"));
      if (repeats.some((r) => r.getAttribute("after-jump") === "yes"))
        throw new Error(
          "Repeats explicitly requested after D.C./D.S. require an unfolded score.",
        );
      const backward = repeats.find(
        (r) => r.getAttribute("direction") === "backward",
      );
      const count = backward
        ? number(backward.getAttribute("times") || "2", "repeat count", 1, 16)
        : 1;
      if (!Number.isInteger(count))
        throw new Error("Invalid MusicXML repeat count.");
      return {
        notes,
        endings,
        sounds,
        length: extent,
        meter: [...meter],
        key,
        tempos,
        forward: repeats.some(
          (r) =>
            r.getAttribute("direction") === "forward" &&
            (r.parentNode as Element).getAttribute("location") !== "right",
        ),
        forwardNext: repeats.some(
          (r) =>
            r.getAttribute("direction") === "forward" &&
            (r.parentNode as Element).getAttribute("location") === "right",
        ),
        repeat: count,
        short: measure.getAttribute("implicit") === "yes" || index === 0,
      };
    });
    return {
      name: names.get(part.getAttribute("id")) || `Part ${partIndex + 1}`,
      bars,
      clefs,
      clefOctaves,
    };
  });
  const count = parsed[0].bars.length;
  if (parsed.some((p) => p.bars.length !== count))
    throw new Error(
      "MusicXML parts have different measure counts. Export a complete score.",
    );
  // Align every part using a shared bar map; shorter voices leave trailing rests.
  const source = parsed[0].bars.map((b, i) => {
    const others = parsed.map((p) => p.bars[i]);
    if (
      others.some((o) => o.meter.join() !== b.meter.join() || o.key !== b.key)
    )
      throw new Error(
        "Independent part meters or key signatures are not supported yet.",
      );
    if (new Set(others.map((o) => o.repeat).filter((n) => n > 1)).size > 1)
      throw new Error("Parts disagree about repeat counts.");
    const extent = Math.max(...others.map((o) => o.length));
    const nominal = (ppq * b.meter[0] * 4) / b.meter[1];
    return {
      ...b,
      // Parts may omit navigation, but must not disagree about explicit counts.
      endings: [
        ...new Map(
          others.flatMap((o) => o.endings).map((e) => [JSON.stringify(e), e]),
        ).values(),
      ],
      sounds: [
        ...new Map(
          others.flatMap((o) => o.sounds).map((s) => [JSON.stringify(s), s]),
        ).values(),
      ],
      length: b.short && extent > 0 ? extent : Math.max(extent, nominal),
      forward: others.some((o) => o.forward),
      forwardNext: others.some((o) => o.forwardNext),
      repeat: Math.max(...others.map((o) => o.repeat)),
    };
  });
  source.forEach((b, i) => {
    if (b.forwardNext) {
      if (!source[i + 1])
        throw new Error("Forward repeat follows the final measure.");
      source[i + 1].forward = true;
    }
  });
  const order = unfold(source);
  if (order.length !== count || order.some((n, i) => n !== i))
    warnings.add(
      "Repeats and navigation are unfolded into sequential practice bars.",
    );
  const bars: Bar[] = [],
    tempos: Tempo[] = [];
  let end = 0,
    bpm = 120;
  const sourceBpm = source.map((_, i) => {
    const start = bpm;
    const changes = parsed
      .flatMap((p) => p.bars[i].tempos)
      .sort((a, b) => a.tick - b.tick);
    if (changes.length) bpm = changes[changes.length - 1].bpm;
    return { start, changes };
  });
  for (const i of order) {
    const b = source[i],
      tempo = sourceBpm[i];
    tempos.push({ tick: end, bpm: tempo.start });
    for (const t of tempo.changes)
      tempos.push({ tick: end + t.tick, bpm: t.bpm });
    bars.push({ start: end, end: end + b.length, meter: b.meter, key: b.key });
    end += b.length;
  }
  const parts = parsed.flatMap((p) => {
    const voices = [
      ...new Set(p.bars.flatMap((b) => b.notes.map((n) => n.voice))),
    ];
    return voices.map((voice) => {
      const lyrics: Lyric[] = [];
      const notes: Note[] = [],
        active = new Map<number, Note>();
      order.forEach((sourceIndex, index) => {
        if (index && sourceIndex !== order[index - 1] + 1) active.clear();
        for (const n of p.bars[sourceIndex].notes.filter(
          (n) => n.voice === voice,
        )) {
          const tick = bars[index].start + n.tick,
            previous = active.get(n.midi);
          const { voice: _v, tieStart, tieStop, lyrics: words, ...data } = n;
          lyrics.push(...words.map((l) => ({ ...l, tick, length: n.length })));
          let note: Note;
          if (
            tieStop &&
            previous &&
            Math.abs(previous.tick + previous.length - tick) < 0.001
          ) {
            previous.length += n.length;
            note = previous;
          } else {
            note = { ...data, tick, id: uid() };
            notes.push(note);
          }
          if (tieStart) active.set(n.midi, note);
          else active.delete(n.midi);
        }
      });
      if (notes.length > 100000)
        throw new Error("A part exceeds the 100,000-note import limit.");
      return {
        id: uid(),
        name:
          p.name +
          (voices.length > 1
            ? ` · staff ${voice.split(":")[0]}, voice ${voice.split(":")[1]}`
            : ""),
        notes: notes.sort((a, b) => a.tick - b.tick),
        ...(lyrics.length
          ? { lyrics: lyrics.sort((a, b) => a.tick - b.tick) }
          : {}),
        clef: p.clefs.get(voice.split(":")[0]),
        clefOctaveChange: p.clefOctaves.get(voice.split(":")[0]) || undefined,
      };
    });
  });
  if (!parts.length || parts.length > 64)
    throw new Error("MusicXML must contain between 1 and 64 pitched voices.");
  const sorted = tempos.sort((a, b) => a.tick - b.tick);
  const unique = sorted
    .filter((t, i) => sorted[i + 1]?.tick !== t.tick)
    .filter((t, i, a) => i === 0 || a[i - 1].bpm !== t.bpm);
  return {
    id: uid(),
    title:
      value(child(root, "work") || root, "work-title") ||
      value(root, "movement-title") ||
      filename.replace(/\.(musicxml|xml)$/i, ""),
    source: "musicxml",
    ppq,
    end,
    bars,
    parts,
    tempos: unique,
    key: bars[0].key ?? 0,
    importWarnings: [...warnings],
  };
}
