import { importMusicXml } from "./musicxml";
import { nwcDecode, readNwcBinary, type NwcCommand } from "./nwc-binary";
import type { Piece } from "./model";
const LIMIT = 20 * 1024 * 1024;
const xml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
const integer = (value: string, label: string, min: number, max: number) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new Error(`Invalid NWC ${label}.`);
  return n;
};
export function readNwcText(text: string): NwcCommand[] {
  if (
    !/^!NoteWorthyComposer\([\d.]+\)/.test(text.trimStart()) ||
    !text.includes("!NoteWorthyComposer-End")
  )
    throw new Error("Invalid or incomplete NWCTXT score.");
  const commands: NwcCommand[] = [];
  for (const line of text
    .slice(0, text.indexOf("!NoteWorthyComposer-End"))
    .split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const fields: string[] = [];
    let field = "",
      quoted = false,
      escaped = false;
    for (const char of line.slice(1)) {
      if (escaped) {
        field += char === "n" ? "\n" : char === "r" ? "\r" : char;
        escaped = false;
      } else if (char === "\\" && quoted) escaped = true;
      else if (char === '"') quoted = !quoted;
      else if (char === "|" && !quoted) {
        fields.push(field);
        field = "";
      } else field += char;
    }
    if (quoted || escaped) throw new Error("Invalid NWCTXT quoted text.");
    fields.push(field);
    const name = fields.shift()!;
    const attributes: Record<string, string> = {};
    for (const part of fields) {
      const index = part.indexOf(":");
      if (index < 0) continue;
      const key = part.slice(0, index);
      if (Object.hasOwn(attributes, key))
        throw new Error(
          `NWC ${name} with multiple ${key} fields requires MusicXML export.`,
        );
      attributes[key] = part.slice(index + 1);
    }
    commands.push({ name, fields: attributes });
    if (commands.length > 100000)
      throw new Error("NWC contains too many notation objects.");
  }
  return commands;
}
export async function decodeNwc(data: ArrayBuffer): Promise<NwcCommand[]> {
  let bytes = new Uint8Array(data);
  if (bytes.length > LIMIT)
    throw new Error("NWC files must be smaller than 20 MB.");
  if (nwcDecode(bytes.subarray(0, 6)) === "[NWZ]\0") {
    const reader = new Blob([bytes.subarray(6)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"))
      .getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > LIMIT) {
          await reader.cancel();
          throw new Error("Decompressed NWC exceeds the 20 MB limit.");
        }
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("20 MB"))
        throw error;
      throw new Error("The compressed NWC file is invalid or incomplete.");
    }
    bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
  }
  const textHeader = "!NoteWorthyComposer(";
  const decoded = nwcDecode(bytes);
  if (decoded.trimStart().startsWith(textHeader)) return readNwcText(decoded);
  const binaryHeader = "[NoteWorthy ArtWare]\0\0\0[NoteWorthy Composer]\0";
  if (
    decoded.startsWith(binaryHeader) &&
    bytes[45] === 0x4b &&
    bytes[46] === 2
  ) {
    const index = new TextDecoder("latin1").decode(bytes).indexOf(textHeader);
    if (index < 0)
      throw new Error("This NWC 2.75 file contains no embedded NWCTXT score.");
    return readNwcText(nwcDecode(bytes.subarray(index)).replace(/\0+$/, ""));
  }
  return readNwcBinary(bytes);
}

export function nwcToMusicXml(commands: NwcCommand[], filename: string) {
  const warnings = new Set<string>();
  const staves: { name: string; commands: NwcCommand[] }[] = [];
  let title = filename.replace(/\.(nwc|nwctxt)$/i, "");
  for (const command of commands) {
    if (command.name === "SongInfo") title = command.fields.Title || title;
    else if (command.name === "AddStaff")
      staves.push({
        name: command.fields.Name || `Part ${staves.length + 1}`,
        commands: [],
      });
    else if (staves.length) staves.at(-1)!.commands.push(command);
  }
  if (!staves.length || staves.length > 64)
    throw new Error("NWC must contain between 1 and 64 staves.");
  const parts = staves.map((staff, i) => {
    let center = 34,
      hasClef = false,
      clefShift = 0,
      transpose = 0,
      fifths = 0,
      beats = 4,
      beatType = 4;
    let pending = "",
      used = 0,
      measure = 0;
    const measures: string[] = [];
    const accidentals = new Map<number, number>();
    const ties = new Set<string>();
    const verses = new Map<string, { text: string; syllabic: string }[]>();
    let lyricIndex = 0;
    const DIV = 960;
    const attrs = (value: string) => {
      pending += `<attributes>${value}</attributes>`;
    };
    const setTranspose = () =>
      attrs(
        `<transpose><chromatic>${transpose + clefShift}</chromatic></transpose>`,
      );
    let ending = "";
    const closeEnding = () => {
      if (ending)
        pending += `<barline location="right"><ending number="${ending}" type="stop"/></barline>`;
      ending = "";
    };
    const bar = (right = "", left = "") => {
      if (used || right) {
        measures.push(
          `<measure number="${++measure}"${measure === 1 && used < (DIV * beats * 4) / beatType ? ' implicit="yes"' : ""}>${pending}${right}</measure>`,
        );
        pending = "";
        used = 0;
        accidentals.clear();
      }
      pending += left;
      if (measures.length > 20000)
        throw new Error("NWC contains too many measures.");
    };
    attrs(
      `<divisions>${DIV}</divisions><time><beats>4</beats><beat-type>4</beat-type></time><key><fifths>0</fifths></key>`,
    );
    for (const command of staff.commands) {
      const f = command.fields,
        type = command.name;
      if (/^Lyric\d+$/.test(type)) {
        const tokens =
          (f.Text || "").replace(/\r?\n/g, " ").match(/[^\s-]+-?/g) || [];
        let continuing = false;
        verses.set(
          type.slice(5),
          tokens.map((token) => {
            const hyphen = token.endsWith("-");
            const text = token.replace(/-$/, "").replace(/_/g, " ");
            const syllabic = continuing
              ? hyphen
                ? "middle"
                : "end"
              : hyphen
                ? "begin"
                : "single";
            continuing = hyphen;
            return { text, syllabic };
          }),
        );
      } else if (type === "Clef") {
        const clefs: Record<string, [number, string, number]> = {
          Treble: [34, "G", 2],
          Bass: [22, "F", 4],
          Alto: [28, "C", 3],
          Tenor: [26, "C", 4],
        };
        const clef = clefs[f.Type];
        if (!clef) throw new Error(`NWC clef ${f.Type} is not supported.`);
        center = clef[0];
        clefShift =
          f.OctaveShift === "Octave Up"
            ? 12
            : f.OctaveShift === "Octave Down"
              ? -12
              : 0;
        if (
          f.OctaveShift &&
          !["Octave Up", "Octave Down"].includes(f.OctaveShift)
        )
          throw new Error("Unsupported NWC clef octave shift.");
        attrs(
          `<clef><sign>${clef[1]}</sign><line>${clef[2]}</line>${clefShift ? `<clef-octave-change>${clefShift / 12}</clef-octave-change>` : ""}</clef>`,
        );
        hasClef = true;
        setTranspose();
      } else if (type === "StaffInstrument") {
        if (used || measures.length)
          throw new Error(
            "NWC instrument changes within a staff require MusicXML export.",
          );
        transpose = integer(f.Trans || "0", "transposition", -48, 48);
        setTranspose();
      } else if (type === "TimeSig") {
        const match = /^(\d+)\/(\d+)$/.exec(
          f.Signature === "Common"
            ? "4/4"
            : f.Signature === "AllaBreve"
              ? "2/2"
              : f.Signature || "",
        );
        if (!match) throw new Error("Unsupported NWC time signature.");
        beats = integer(match[1], "meter", 1, 64);
        beatType = integer(match[2], "meter", 1, 64);
        attrs(
          `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`,
        );
      } else if (type === "Key") {
        if (f.Fifths !== undefined)
          fifths = integer(f.Fifths, "key signature", -7, 7);
        else {
          const keys = (f.Signature || "").split(",").filter(Boolean);
          const sign = keys.every((k) => k.endsWith("#")) ? 1 : -1;
          const standard =
            sign === 1
              ? ["F#", "C#", "G#", "D#", "A#", "E#", "B#"]
              : ["Bb", "Eb", "Ab", "Db", "Gb", "Cb", "Fb"];
          if (keys.some((k, i) => k !== standard[i]))
            throw new Error("Custom NWC key signatures are not supported.");
          fifths = keys.length * sign;
        }
        attrs(`<key><fifths>${fifths}</fifths></key>`);
        accidentals.clear();
      } else if (type === "Tempo") {
        const base = (f.Base || "Quarter").split(",");
        const factors: Record<string, number> = {
          Half: 2,
          Quarter: 1,
          Eighth: 0.5,
        };
        if (!(base[0] in factors))
          throw new Error("Unsupported NWC tempo beat unit.");
        const tempo =
          integer(f.Tempo || "120", "tempo", 1, 1000) *
          factors[base[0]] *
          (base.includes("Dotted") ? 1.5 : 1);
        pending += `<direction><sound tempo="${tempo}"/></direction>`;
      } else if (type === "Bar") {
        const style = f.Style || "Single";
        const backward = /(?:Local|Master)(?:Repeat)?Close/.test(style),
          forward = /(?:Local|Master)(?:Repeat)?Open/.test(style);
        const times = integer(f.Repeat || "2", "repeat count", 0, 20) || 2;
        if (backward || style === "SectionClose") closeEnding();
        bar(
          backward
            ? `<barline location="right"><repeat direction="backward" times="${times}"/></barline>`
            : "",
          forward
            ? '<barline location="left"><repeat direction="forward"/></barline>'
            : "",
        );
      } else if (type === "Ending") {
        closeEnding();
        if (used) bar();
        ending = f.Endings === "D" ? "16" : f.Endings || "";
        if (!(f.Endings === "D" || /^[1-7](,[1-7])*$/.test(ending)))
          throw new Error("Unsupported NWC ending numbers.");
        pending += `<barline location="left"><ending number="${ending}"${ending === "16" ? ' choirstar-return-only="yes"' : ""} type="start"/></barline>`;
      } else if (type === "Flow") {
        const styles: Record<string, string> = {
          Segno: 'segno="segno"',
          Coda: 'coda="coda"',
          Fine: 'fine="yes"',
          ToCoda: 'tocoda="coda"',
          DaCapo: 'dacapo="yes"',
          DCalFine: 'dacapo="yes"',
          DCalCoda: 'dacapo="yes"',
          DalSegno: 'dalsegno="segno"',
          DSalFine: 'dalsegno="segno"',
          DSalCoda: 'dalsegno="segno"',
        };
        const sound = styles[f.Style];
        if (!sound)
          throw new Error(`Unsupported NWC flow instruction: ${f.Style}.`);
        // Start markers belong to the following measure; jump instructions end one.
        if (["Segno", "Coda"].includes(f.Style) && used) bar();
        pending += `<direction><sound ${sound}/></direction>`;
      } else if (type === "Note" || type === "Chord" || type === "Rest") {
        // Use the default only when music starts without an explicit clef.
        if (!hasClef) {
          attrs("<clef><sign>G</sign><line>2</line></clef>");
          hasClef = true;
        }
        if (f.Dur2 || f.Pos2)
          throw new Error(
            "NWC chords with unequal voice durations require MusicXML export.",
          );
        const dur = (f.Dur || "").split(",");
        const values: Record<string, number> = {
          Whole: 4,
          Half: 2,
          "4th": 1,
          "8th": 0.5,
          "16th": 0.25,
          "32nd": 0.125,
          "64th": 0.0625,
        };
        if (!(dur[0] in values))
          throw new Error("Unsupported NWC note duration.");
        if (dur.includes("Grace")) {
          warnings.add("NWC grace notes are omitted.");
          continue;
        }
        const length =
          values[dur[0]] *
          DIV *
          (dur.includes("DblDotted")
            ? 1.75
            : dur.includes("Dotted")
              ? 1.5
              : 1) *
          (dur.includes("Triplet") ? 2 / 3 : 1);
        const positions = type === "Rest" ? [""] : (f.Pos || "").split(",");
        if (!positions.length || positions.length > 64)
          throw new Error("Invalid NWC chord size.");
        let continuingTie = false;
        for (const [index, position] of positions.entries()) {
          if (type === "Rest") {
            pending += `<note><rest/><duration>${length}</duration></note>`;
            break;
          }
          const match = /^([#bnxv]?)(-?\d+)(\^)?$/.exec(position);
          if (!match) throw new Error("Unsupported NWC note position.");
          const pitch = center + integer(match[2], "staff position", -100, 100),
            stepIndex = ((pitch % 7) + 7) % 7;
          const step = "CDEFGAB"[stepIndex],
            octave = Math.floor(pitch / 7);
          const keys =
            fifths > 0
              ? "FCGDAEB".slice(0, fifths)
              : "BEADGCF".slice(0, -fifths);
          const explicit: Record<string, number> = {
            "#": 1,
            b: -1,
            n: 0,
            x: 2,
            v: -2,
          };
          const pendingAlter = [...ties]
            .find((identity) => identity.startsWith(`${pitch}:`))
            ?.split(":")[1];
          const alter = match[1]
            ? explicit[match[1]]
            : pendingAlter !== undefined
              ? Number(pendingAlter)
              : (accidentals.get(pitch) ??
                (keys.includes(step) ? Math.sign(fifths) : 0));
          if (match[1]) accidentals.set(pitch, alter);
          const identity = `${pitch}:${alter}`;
          const stop = ties.has(identity);
          if (!index) continuingTie = stop;
          ties.delete(identity);
          if (match[3]) ties.add(identity);
          pending += `<note>${index ? "<chord/>" : ""}<pitch><step>${step}</step><alter>${alter}</alter><octave>${octave}</octave></pitch><duration>${length}</duration>${stop ? '<tie type="stop"/>' : ""}${match[3] ? '<tie type="start"/>' : ""}`;
          const lyricAllowed =
            !index &&
            (!stop || (f.Opts || "").includes("Lyric=Always")) &&
            !(f.Opts || "").includes("Lyric=Never");
          if (lyricAllowed)
            for (const [verse, tokens] of verses) {
              const token = tokens[lyricIndex];
              if (token?.text)
                pending += `<lyric number="${xml(verse)}"><syllabic>${token.syllabic}</syllabic><text>${xml(token.text)}</text></lyric>`;
            }
          pending += "</note>";
        }
        if (
          type !== "Rest" &&
          (!continuingTie || (f.Opts || "").includes("Lyric=Always")) &&
          !(f.Opts || "").includes("Lyric=Never")
        )
          lyricIndex++;
        used += length;
      } else if (type === "TempoVariance")
        warnings.add(
          "NWC expressive tempo changes and fermatas use the written note timing.",
        );
      else if (
        ![
          "StaffProperties",
          "StaffProperties2",
          "Lyrics",
          "Dynamic",
          "DynamicVariance",
          "Text",
          "PerformanceStyle",
          "MPC",
          "Pedal",
          "Boundary",
          "Spacer",
          "Marker",
          "Editor",
          "PageSetup",
          "PageMargins",
          "Font",
        ].includes(type)
      )
        throw new Error(
          `NWC command ${type} is not supported. Export MusicXML.`,
        );
    }
    closeEnding();
    bar();
    if (!measures.length)
      throw new Error("NWC staff contains no playable notes.");
    return `<part id="P${i}">${measures.join("")}</part>`;
  });
  const text = `<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>${xml(title)}</work-title></work><part-list>${staves.map((s, i) => `<score-part id="P${i}"><part-name>${xml(s.name)}</part-name></score-part>`).join("")}</part-list>${parts.join("")}</score-partwise>`;
  if (text.length > LIMIT)
    throw new Error("Converted NWC exceeds the score size limit.");
  return { text, warnings: [...warnings] };
}
export async function importNwc(
  data: ArrayBuffer,
  filename: string,
  parse?: (text: string) => Document,
): Promise<Piece> {
  const converted = nwcToMusicXml(await decodeNwc(data), filename);
  const piece = importMusicXml(
    converted.text,
    filename,
    parse?.(converted.text),
  );
  piece.source = "nwc";
  piece.importWarnings = [
    ...(piece.importWarnings || []),
    ...converted.warnings,
    "NWC converted locally to practice notation. Compare it with the original score.",
    "NWC page layout and staff mute/visibility settings are reset; review Track settings.",
  ];
  return piece;
}
