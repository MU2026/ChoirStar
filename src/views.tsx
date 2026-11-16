import { TransportIcon } from "./TransportIcon";
import { useLayoutEffect, useRef, useState, useMemo, memo } from "react";
import { highlightedVerse, lyricLayout } from "./lyrics";
import { notationBar } from "./notation";
import { noteLabel } from "./vendor/openvox/core/music/notes";
import { GRADE_COLORS } from "./note-feedback";
import {
  secondsAt,
  tickAt,
  barAt,
  type Piece,
  type Settings,
  type Sample,
  type NoteResult,
  type Note,
} from "./model";
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const o = new ResizeObserver((e) =>
      setWidth(Math.max(320, e[0].contentRect.width)),
    );
    o.observe(ref.current);
    return () => o.disconnect();
  }, []);
  return { ref, width };
}
const noResults: NoteResult[] = [];
const EngravedBar = memo(function EngravedBar({
  svg,
  notes,
  results,
  disabled,
  seekDisabled,
  barStart,
  onSeek,
  onNote,
}: {
  svg: string;
  notes: Note[];
  results: NoteResult[];
  disabled: boolean;
  seekDisabled: boolean;
  barStart: number;
  onSeek: (tick: number) => void;
  onNote: (midi: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Expose individual note buttons instead of flattening the SVG into an image.
    root.current?.querySelector("svg")?.setAttribute("role", "group");
    const byId = new Map(notes.map((n) => [n.id, n]));
    const grades = new Map(results.map((r) => [r.note, r]));
    root.current
      ?.querySelectorAll<SVGGElement>('[data-event-kind="note"]')
      .forEach((group) => {
        const note = byId.get(group.dataset.eventId!);
        if (!note) return;
        const result = grades.get(note.id);
        group.style.setProperty(
          "--note-color",
          result?.grade ? GRADE_COLORS[result.grade] : "#19161d",
        );
        group.dataset.graded = String(!!result?.grade);
        group.setAttribute("role", "button");
        group.setAttribute("tabindex", seekDisabled ? "-1" : "0");
        group.setAttribute("aria-disabled", String(seekDisabled));
        const description = `${noteLabel(note.midi)}${result ? ` · ${result.grade ?? "Not assessed"} · ${result.detail ?? ""}` : ""}`;
        group.setAttribute(
          "aria-label",
          `${disabled ? "Move cursor to" : "Play and move cursor to"} ${description}`,
        );
        group.querySelector("title")?.remove();
        const title = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "title",
        );
        title.textContent = description;
        group.prepend(title);
      });
  }, [svg, notes, results, disabled, seekDisabled]);
  const play = (target: EventTarget | null, seek = false) => {
    if (seekDisabled || !(target instanceof Element)) return;
    const id = target.closest<SVGGElement>('[data-event-kind="note"]')?.dataset
      .eventId;
    const note = notes.find((n) => n.id === id);
    if (note) {
      if (!disabled) onNote(note.midi);
      if (seek) onSeek(Math.max(barStart, note.tick));
    }
  };
  return (
    <div
      ref={root}
      onClick={(e) => play(e.target)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          play(e.target, true);
        }
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
function PartControls({
  open,
  part,
  mix,
  selected,
  disabled,
  onPart,
  onMix,
}: {
  open: boolean;
  part: Piece["parts"][number];
  mix: Settings["mix"][string];
  selected: boolean;
  disabled: boolean;
  onPart: () => void;
  onMix: (patch: Partial<Settings["mix"][string]>) => void;
}) {
  return (
    <div className={"part-controls" + (open ? " mixer-open" : "")}>
      <button
        className="part-handle"
        aria-expanded={mix?.visible !== false}
        aria-label={`${mix?.visible === false ? "Expand" : "Collapse"} ${part.name} staff`}
        title={`${mix?.visible === false ? "Expand" : "Collapse"} ${part.name} staff`}
        onClick={() => onMix({ visible: mix?.visible === false })}
      >
        {part.name}
      </button>
      {open && (
        <div
          className="part-mix-row"
          role="group"
          aria-label={`${part.name} controls`}
        >
          <button
            className="part-icon"
            aria-label={`Practise ${part.name}`}
            title={`Practise ${part.name}`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={onPart}
          >
            <TransportIcon kind="sing" />
          </button>
          <button
            className="part-icon"
            aria-label={`Boost ${part.name}`}
            title={`Boost ${part.name}: bring forward and quiet backing parts`}
            aria-pressed={!!mix?.boost}
            onClick={() => onMix({ boost: !mix?.boost })}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M2 10h10l8-5v14l-8-5H2zM6 14v4a2 2 0 0 0 4 0v-4M7 7v3M11 7v3M22 8v8" />
            </svg>
          </button>
          <button
            className="part-icon"
            aria-label={`Solo ${part.name}`}
            title={`Solo ${part.name} (multiple parts allowed)`}
            aria-pressed={!!mix?.solo}
            onClick={() => onMix({ solo: !mix?.solo })}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M4 14v-3a8 8 0 0 1 16 0v3M4 12H2v8h5v-8zM20 12h2v8h-5v-8z" />
            </svg>
          </button>
          <button
            className="part-icon"
            aria-label={`Mute ${part.name}`}
            title={`Mute ${part.name}`}
            aria-pressed={mix?.mute || false}
            onClick={() => onMix({ mute: !mix?.mute })}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M3 9h4l5-4v14l-5-4H3zM16 8q5 4 0 8M3 3l18 18" />
            </svg>
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={mix?.volume ?? 0.6}
            disabled={!!mix?.mute}
            aria-label={`${part.name} volume`}
            title={`${part.name}: ${Math.round((mix?.volume ?? 0.6) * 100)}%`}
            onChange={(event) => onMix({ volume: Number(event.target.value) })}
          />
        </div>
      )}
    </div>
  );
}
export function Score({
  piece,
  zoom,
  settings,
  time,
  samples,
  running,
  playbackPosition,
  onMix,
  onPart,
  controlsDisabled,
  onNote,
  results,
  feedbackPart,
  onRange,
  passageDisabled,
  onSeek,
  onSpeed,
  onMetronome,
  onInitialPitches,
}: {
  piece: Piece;
  zoom: number;
  settings: Settings;
  time: number;
  samples: Sample[];
  running: boolean;
  playbackPosition: () => number;
  onMix: (id: string, patch: Partial<Settings["mix"][string]>) => void;
  onPart: (part: string) => void;
  controlsDisabled: boolean;
  onNote: (midi: number) => void;
  results: NoteResult[];
  feedbackPart: string;
  passageDisabled: boolean;
  onSeek: (tick: number) => void;
  onSpeed: (speed: number) => void;
  onMetronome: () => void;
  onInitialPitches: () => void;
  onRange: (range: { from: number; to: number } | null) => void;
}) {
  const [mixerOpen, setMixerOpen] = useState(false);
  const partControls = (part: Piece["parts"][number]) => (
    <PartControls
      open={mixerOpen}
      part={part}
      mix={settings.mix[part.id]}
      selected={settings.part === part.id}
      disabled={controlsDisabled}
      onPart={() => onPart(part.id)}
      onMix={(patch) => onMix(part.id, patch)}
    />
  );
  const { ref, width } = useWidth();
  const [scrollBar, setScrollBar] = useState(0);
  const [pitchExpanded, setPitchExpanded] = useState(true);
  const labelWidth =
    Math.max(
      176,
      163 +
        Math.min(
          7,
          Math.max(
            Math.abs(piece.key),
            ...piece.bars.map((b) => Math.abs(b.key ?? piece.key)),
          ),
        ) *
          14,
    ) +
    4 +
    (mixerOpen ? 220 : 0);
  // Keep the 100% bar width as the zoom baseline, so larger notes also
  // receive more horizontal space instead of being squeezed into four bars.
  const cellWidth = Math.max(120, (width * zoom - labelWidth) / 4);
  const tempoTick = tickAt(piece, Math.max(0, time));
  const baseTempo =
    [...piece.tempos].reverse().find((tempo) => tempo.tick <= tempoTick)?.bpm ??
    120;
  const bpm = Math.round(baseTempo * settings.speed);
  const selected =
    settings.from > 0 || settings.to < piece.bars.length - 1 || settings.loop;
  const [draft, setDraft] = useState<{ from: number; to: number } | null>(null);
  const range =
    draft || (selected ? { from: settings.from, to: settings.to } : null);
  const rangeDrag = useRef<{
    anchor: number;
    mode: string;
    from: number;
    to: number;
    x: number;
    startX: number;
    moved: boolean;
    selected: boolean;
  } | null>(null);
  const rangeFrame = useRef(0);
  const barUnderPointer = (x: number) => {
    const el = ref.current!;
    const bounds = el.getBoundingClientRect();
    const scale = bounds.width / el.offsetWidth || 1;
    return Math.max(
      0,
      Math.min(
        piece.bars.length - 1,
        Math.floor(
          ((x - bounds.left) / scale + el.scrollLeft - labelWidth) / cellWidth,
        ),
      ),
    );
  };
  const updateRange = () => {
    const d = rangeDrag.current;
    if (!d) return;
    const at = barUnderPointer(d.x);
    const next =
      d.mode === "start"
        ? { from: Math.min(at, d.to), to: d.to }
        : d.mode === "end"
          ? { from: d.from, to: Math.max(at, d.from) }
          : { from: Math.min(d.anchor, at), to: Math.max(d.anchor, at) };
    d.from = next.from;
    d.to = next.to;
    setDraft(next);
  };
  const endRange = (cancel = false) => {
    const d = rangeDrag.current;
    rangeDrag.current = null;
    cancelAnimationFrame(rangeFrame.current);
    setDraft(null);
    if (!d || cancel) return;
    onRange(
      !d.moved && d.selected && d.mode === "new"
        ? null
        : { from: d.from, to: d.to },
    );
  };
  useLayoutEffect(() => () => cancelAnimationFrame(rangeFrame.current), []);
  const tick = Math.max(0, tickAt(piece, Math.max(0, time)));
  const bar = barAt(piece, Math.min(tick, piece.end - 1));
  const first = Math.max(0, scrollBar - 1);
  const visibleBars = Math.ceil(Math.max(0, width - labelWidth) / cellWidth);
  const last = Math.min(piece.bars.length, first + visibleBars + 3);
  const parts = piece.parts;
  const [verseChoices, setVerseChoices] = useState<
    Record<string, string | undefined>
  >({});
  const lyricLayouts = useMemo(
    () => new Map(piece.parts.map((p) => [p.id, lyricLayout(p)])),
    [piece],
  );
  // Retain already engraved bars as the window advances. Engraving is much
  // more expensive than moving the viewport, and must not run every frame.
  const engravingCache = useMemo(
    () => new Map<string, ReturnType<typeof notationBar>>(),
    [piece, cellWidth],
  );
  const cells = useMemo(
    () =>
      parts.map((p) => ({
        part: p,
        lyrics: lyricLayouts.get(p.id)!,
        bars: Array.from({ length: last - first }, (_, i) => {
          const index = first + i,
            key = `${p.id}:${index}`;
          let engraved = engravingCache.get(key);
          if (!engraved) {
            engraved = notationBar(piece, p, index, cellWidth);
            engravingCache.set(key, engraved);
          }
          return { index, ...engraved };
        }),
      })),
    [piece, settings.mix, first, last, cellWidth, engravingCache],
  );
  const animationCells = useRef(cells);
  animationCells.current = cells;
  useLayoutEffect(() => {
    const viewport = ref.current;
    const target = viewport?.querySelector<HTMLElement>(".target-group");
    if (!viewport || !target) return;
    const update = () => {
      // At large zoom levels, allow the whole target row to scroll when it
      // cannot fit above the footer; pinning it would hide the pitch pane.
      target.style.position =
        target.offsetHeight + 36 > viewport.clientHeight ? "relative" : "";
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(target);
    update();
    return () => observer.disconnect();
  }, [piece, settings.part]);
  useLayoutEffect(() => {
    const viewport = ref.current;
    if (!viewport) return;
    if (!running) {
      viewport.scrollLeft = Math.max(0, (bar - 1) * cellWidth);
      return;
    }
    let frame = 0;
    const animate = () => {
      // Use the audio clock at display refresh rate, independently of React's
      // lower-frequency feedback updates. This also follows tempo changes.
      const liveTick = Math.min(
        piece.end - 1,
        Math.max(0, tickAt(piece, Math.max(0, playbackPosition()))),
      );
      const currentBar = barAt(piece, liveTick),
        b = piece.bars[currentBar];
      const position = currentBar + (liveTick - b.start) / (b.end - b.start);
      if (!rangeDrag.current)
        viewport.scrollLeft = Math.max(0, (position - 0.75) * cellWidth);
      for (const row of animationCells.current) {
        const cell = row.bars.find((c) => c.index === currentBar);
        const cursors = viewport.querySelectorAll<SVGSVGElement>(
          `[data-playhead="${row.part.id}"]`,
        );
        if (!cell) continue;
        const x = currentBar * cellWidth + cell.x(liveTick);
        cursors.forEach(
          (cursor) => (cursor.style.transform = `translateX(${x}px)`),
        );
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [
    running,
    running ? null : bar,
    cellWidth,
    piece,
    playbackPosition,
    settings.from,
  ]);
  return (
    <div
      className="score-scroll"
      style={{ zoom }}
      ref={ref}
      aria-label="Scrollable score"
      onClick={(event) => {
        if (
          passageDisabled ||
          !(event.target instanceof Element) ||
          event.target.closest(
            ".bar-ruler, .staff-label, .lyric-label, .collapsed-staff-label, button, input, select, a",
          )
        )
          return;
        const el = ref.current!;
        const bounds = el.getBoundingClientRect();
        const scale = bounds.width / el.offsetWidth || 1;
        const x =
          (event.clientX - bounds.left) / scale + el.scrollLeft - labelWidth;
        if (x < 0 || x >= piece.bars.length * cellWidth) return;
        const index = Math.floor(x / cellWidth);
        const partId =
          event.target.closest<HTMLElement>(".part-group")?.dataset.part;
        const row = cells.find((row) => row.part.id === partId) ?? cells[0];
        const cell = row?.bars.find((cell) => cell.index === index);
        if (!cell) return;
        const noteId = event.target.closest<SVGGElement>(
          '[data-event-kind="note"]',
        )?.dataset.eventId;
        const note = row.part.notes.find((note) => note.id === noteId);
        onSeek(
          note
            ? Math.max(piece.bars[index].start, note.tick)
            : cell.tickAtX(x - index * cellWidth),
        );
      }}
      onScroll={(e) =>
        setScrollBar(Math.floor(e.currentTarget.scrollLeft / cellWidth))
      }
    >
      <div
        className="score-strip"
        style={{ width: labelWidth + piece.bars.length * cellWidth }}
      >
        <div
          className="bar-ruler"
          role="group"
          aria-label="Practice passage: drag to select bars; click selection or press Escape to clear"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !passageDisabled) {
              e.preventDefault();
              endRange(true);
              onRange(null);
            }
          }}
          onPointerDown={(e) => {
            if (
              passageDisabled ||
              e.button !== 0 ||
              (e.target as HTMLElement).closest(".ruler-label")
            )
              return;
            e.preventDefault();
            e.currentTarget.focus();
            e.currentTarget.setPointerCapture(e.pointerId);
            const at = barUnderPointer(e.clientX),
              mode = (e.target as HTMLElement).dataset.edge || "new";
            rangeDrag.current = {
              anchor: at,
              mode,
              from: range?.from ?? at,
              to: range?.to ?? at,
              x: e.clientX,
              startX: e.clientX,
              moved: false,
              selected: !!range && at >= range.from && at <= range.to,
            };
            updateRange();
            const pan = () => {
              const d = rangeDrag.current,
                el = ref.current;
              if (!d || !el) return;
              const r = el.getBoundingClientRect();
              const scale = r.width / el.offsetWidth || 1;
              const shift =
                d.x > r.right - 30
                  ? 8
                  : d.x < r.left + labelWidth * scale + 20
                    ? -8
                    : 0;
              if (shift) {
                el.scrollLeft += shift;
                d.moved = true;
                updateRange();
              }
              rangeFrame.current = requestAnimationFrame(pan);
            };
            rangeFrame.current = requestAnimationFrame(pan);
          }}
          onPointerMove={(e) => {
            const d = rangeDrag.current;
            if (d) {
              d.x = e.clientX;
              d.moved ||= Math.abs(d.x - d.startX) > 3;
              updateRange();
            }
          }}
          onPointerUp={() => endRange()}
          onPointerCancel={() => endRange(true)}
          onLostPointerCapture={() => endRange(true)}
        >
          <span className="ruler-label" style={{ width: labelWidth }}>
            <button
              className="mixer-toggle"
              aria-label="Mixer"
              title="Show or hide all part mixers"
              aria-expanded={mixerOpen}
              onClick={() => setMixerOpen((open) => !open)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="M5 3v7m0 4v7M12 3v11m0 4v3M19 3v3m0 4v11M2 10h6M9 14h6M16 6h6" />
              </svg>
            </button>
            {mixerOpen && (
              <>
                <button
                  className="metronome-toggle"
                  aria-label="Starting pitches"
                  title="Play starting pitches before each start"
                  aria-pressed={settings.initialPitches !== false}
                  onClick={onInitialPitches}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M7 3v7a5 5 0 0 0 10 0V3M10 3v7a2 2 0 0 0 4 0V3M12 15v6M9 21h6" />
                  </svg>
                </button>
                <button
                  className="metronome-toggle"
                  aria-label="Metronome"
                  title="Beat clicks (accent the first beat of each bar)"
                  aria-pressed={!!settings.metronome}
                  onClick={onMetronome}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M9 3h6l5 18H4zM12 17l5-11M14 9l4 2M8 17h8" />
                  </svg>
                </button>
                <span
                  className="mixer-tempo"
                  role="group"
                  aria-label="Playback tempo"
                >
                  <button
                    disabled={passageDisabled || settings.speed <= 0.25}
                    aria-label="Decrease tempo"
                    title="Decrease tempo by 1 BPM"
                    onClick={() =>
                      onSpeed(Math.max(0.25, (bpm - 1) / baseTempo))
                    }
                  >
                    −
                  </button>
                  <output aria-label="Tempo in BPM" title="Playback tempo">
                    {bpm} <small>BPM</small>
                  </output>
                  <button
                    disabled={passageDisabled || settings.speed >= 2}
                    aria-label="Increase tempo"
                    title="Increase tempo by 1 BPM"
                    onClick={() => onSpeed(Math.min(2, (bpm + 1) / baseTempo))}
                  >
                    +
                  </button>
                </span>
              </>
            )}
          </span>
          {range && (
            <div
              className="passage-selection"
              style={{
                left: labelWidth + range.from * cellWidth,
                width: (range.to - range.from + 1) * cellWidth,
              }}
            >
              {(["start", "end"] as const).map((edge) => (
                <span
                  key={edge}
                  data-edge={edge}
                  className={"passage-handle " + edge}
                  role="slider"
                  tabIndex={passageDisabled ? -1 : 0}
                  aria-label={
                    edge === "start" ? "Passage start bar" : "Passage end bar"
                  }
                  aria-valuemin={1}
                  aria-valuemax={piece.bars.length}
                  aria-valuenow={(edge === "start" ? range.from : range.to) + 1}
                  aria-disabled={passageDisabled}
                  onKeyDown={(e) => {
                    if (passageDisabled) return;
                    const delta =
                      e.key === "ArrowLeft"
                        ? -1
                        : e.key === "ArrowRight"
                          ? 1
                          : 0;
                    if (delta) {
                      e.preventDefault();
                      onRange(
                        edge === "start"
                          ? {
                              from: Math.max(
                                0,
                                Math.min(range.to, range.from + delta),
                              ),
                              to: range.to,
                            }
                          : {
                              from: range.from,
                              to: Math.min(
                                piece.bars.length - 1,
                                Math.max(range.from, range.to + delta),
                              ),
                            },
                      );
                    }
                  }}
                />
              ))}
            </div>
          )}
          {Array.from({ length: last - first }, (_, i) => (
            <span
              key={first + i}
              className="bar-number"
              style={{
                position: "absolute",
                left: labelWidth + (first + i) * cellWidth,
                width: cellWidth,
              }}
            >
              {" "}
              {first + i + 1}
            </span>
          ))}
        </div>
        {cells.map(({ part, bars, lyrics }) => (
          <section
            key={part.id}
            data-part={part.id}
            className={
              part.id === settings.part
                ? "part-group target-group"
                : "part-group"
            }
          >
            {settings.mix[part.id]?.visible !== false ? (
              <div
                className={
                  "staff " + (part.id === settings.part ? "target-staff" : "")
                }
                key={part.id}
                style={{ height: lyrics.height }}
              >
                <div className="staff-label" style={{ width: labelWidth }}>
                  {partControls(part)}
                  <div
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{
                      __html:
                        (bars.find((c) => c.index === bar) ?? bars[0])?.clef ||
                        "",
                    }}
                  />
                </div>
                <svg
                  className="staff-playhead"
                  style={{
                    left: labelWidth,
                    width: 2,
                    transform: running
                      ? undefined
                      : `translateX(${bar * cellWidth + (bars.find((c) => c.index === bar)?.x(tick) || 18)}px)`,
                  }}
                  height="130"
                  data-playhead={part.id}
                  aria-hidden="true"
                >
                  <line
                    x1="1"
                    x2="1"
                    y1="10"
                    y2="120"
                    stroke="var(--gold)"
                    strokeWidth="1.5"
                  />
                </svg>
                {bars.map((cell) => {
                  let path = "";
                  let pen = false;
                  let previous = -Infinity;
                  if (part.id === settings.part)
                    for (const sample of samples) {
                      const t = tickAt(piece, sample.time),
                        b = piece.bars[cell.index];
                      if (t < b.start || t >= b.end) continue;
                      if (sample.midi === null || sample.confidence < 0.85) {
                        pen = false;
                        continue;
                      }
                      if (sample.time - previous > 0.2) pen = false;
                      path += `${pen ? "L" : "M"}${cell.x(t).toFixed(2)},${cell.y(sample.midi, t).toFixed(2)} `;
                      pen = true;
                      previous = sample.time;
                    }
                  return (
                    <div
                      className="notation-cell"
                      key={cell.index}
                      style={{
                        left: labelWidth + cell.index * cellWidth,
                        width: cellWidth,
                      }}
                    >
                      <EngravedBar
                        svg={cell.svg}
                        notes={part.notes}
                        results={part.id === feedbackPart ? results : noResults}
                        disabled={controlsDisabled}
                        seekDisabled={passageDisabled}
                        barStart={piece.bars[cell.index].start}
                        onSeek={onSeek}
                        onNote={onNote}
                      />
                      {lyrics.verses.length > 0 && (
                        <svg
                          className="staff-lyrics"
                          style={{
                            top: lyrics.top + 15,
                            height: lyrics.verses.length * 20,
                          }}
                          width={cellWidth}
                          height={lyrics.verses.length * 20}
                          viewBox={`0 0 ${cellWidth} ${lyrics.verses.length * 20}`}
                          aria-label={`Lyrics for ${part.name}, bar ${cell.index + 1}`}
                        >
                          {lyrics.verses.length > 1 &&
                            lyrics.verses.map(
                              (verse, row) =>
                                verse ===
                                  highlightedVerse(
                                    lyrics,
                                    piece.bars[cell.index],
                                    verseChoices[part.id],
                                  ) && (
                                  <rect
                                    key={verse}
                                    className="active-verse-background"
                                    x={0}
                                    y={row * 20}
                                    width={cellWidth}
                                    height={20}
                                    rx={3}
                                  />
                                ),
                            )}
                          {lyrics.lines.map((line, row) =>
                            line.map((l, i) => {
                              const b = piece.bars[cell.index];
                              const starts =
                                l.tick >= b.start && l.tick < b.end;
                              const extendsHere =
                                !!l.extend && l.end > b.start && l.tick < b.end;
                              if (!starts && !extendsHere) return null;
                              const x = cell.x(Math.max(b.start, l.tick));
                              const nextX =
                                l.next !== undefined && l.next < b.end
                                  ? cell.x(l.next)
                                  : cellWidth;
                              const available = Math.max(
                                8,
                                Math.min(cellWidth - x - 2, nextX - x - 5),
                              );
                              const textWidth = Math.min(
                                l.text.length * 6.5,
                                available,
                              );
                              const y = row * 20 + 14;
                              return (
                                <g key={`${row}:${i}`}>
                                  {starts && (
                                    <text
                                      x={x - 4}
                                      y={y}
                                      textLength={
                                        l.text.length * 6.5 > available
                                          ? textWidth
                                          : undefined
                                      }
                                      lengthAdjust="spacingAndGlyphs"
                                    >
                                      {l.text}
                                    </text>
                                  )}
                                  {starts &&
                                    (l.syllabic === "begin" ||
                                      l.syllabic === "middle") &&
                                    nextX - x - textWidth > 8 && (
                                      <text
                                        x={
                                          x +
                                          textWidth +
                                          (nextX - x - textWidth) / 2 -
                                          4
                                        }
                                        y={y}
                                      >
                                        -
                                      </text>
                                    )}
                                  {extendsHere &&
                                    cell.x(Math.min(b.end, l.end)) >
                                      x + (starts ? textWidth : 0) + 4 && (
                                      <line
                                        x1={starts ? x + textWidth : x}
                                        x2={cell.x(Math.min(b.end, l.end)) - 2}
                                        y1={y + 2}
                                        y2={y + 2}
                                        stroke="currentColor"
                                        strokeWidth="1"
                                      />
                                    )}
                                </g>
                              );
                            }),
                          )}
                        </svg>
                      )}
                      <svg
                        className="notation-overlay"
                        viewBox={`0 0 ${cellWidth} 130`}
                        aria-label={
                          part.id === settings.part
                            ? "Sung pitch on notation"
                            : undefined
                        }
                      >
                        <path
                          d={path}
                          fill="none"
                          stroke="var(--accent)"
                          strokeWidth="2.5"
                        />
                      </svg>
                    </div>
                  );
                })}
                {lyrics.verses.length > 0 && (
                  <div
                    className="lyric-label"
                    style={{
                      width: labelWidth,
                      height: lyrics.height - 100,
                      paddingTop: lyrics.top - 100,
                    }}
                    aria-label={`Verse highlighting for ${part.name}`}
                  >
                    {lyrics.verses.map((v) => (
                      <div key={v}>
                        {lyrics.verses.length > 1 && (
                          <button
                            className="verse-choice"
                            aria-label={`Highlight verse ${v} for ${part.name}`}
                            aria-pressed={verseChoices[part.id] === v}
                            data-active={
                              highlightedVerse(
                                lyrics,
                                piece.bars[bar],
                                verseChoices[part.id],
                              ) === v
                            }
                            title={
                              verseChoices[part.id] === v
                                ? "Return to automatic verse highlighting"
                                : `Highlight verse ${v} (click again for automatic)`
                            }
                            onClick={() =>
                              setVerseChoices((current) => ({
                                ...current,
                                [part.id]:
                                  current[part.id] === v ? undefined : v,
                              }))
                            }
                          >
                            {v}.
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="collapsed-staff">
                <div
                  className="collapsed-staff-label"
                  style={{ width: labelWidth }}
                >
                  {partControls(part)}
                </div>
              </div>
            )}
            {part.id === settings.part && (
              <PitchView
                piece={piece}
                settings={settings}
                time={time}
                samples={samples}
                bars={bars}
                cellWidth={cellWidth}
                labelWidth={labelWidth}
                viewportWidth={width}
                expanded={pitchExpanded}
                onToggle={() => setPitchExpanded((v) => !v)}
                running={running}
              />
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
function PitchView({
  piece,
  settings,
  time,
  samples,
  bars,
  cellWidth,
  labelWidth,
  viewportWidth,
  expanded,
  onToggle,
  running,
}: {
  piece: Piece;
  settings: Settings;
  time: number;
  samples: Sample[];
  bars: ({ index: number } & ReturnType<typeof notationBar>)[];
  cellWidth: number;
  labelWidth: number;
  viewportWidth: number;
  expanded: boolean;
  onToggle: () => void;
  running: boolean;
}) {
  const part = piece.parts.find((p) => p.id === settings.part)!;
  const bounds = useMemo(() => {
    const pitches = part.notes.map((n) => n.midi);
    return { low: Math.min(...pitches) - 3, high: Math.max(...pitches) + 3 };
  }, [part]);
  const { low, high } = bounds;
  const height = 155;
  const y = (m: number) => 16 + ((high - m) / (high - low)) * (height - 32);
  const tick = Math.max(0, tickAt(piece, Math.max(0, time)));
  const bar = barAt(piece, Math.min(piece.end - 1, tick));
  const levels = Array.from(
    { length: high - low + 1 },
    (_, i) => low + i,
  ).filter((_, i) => i % 2 === 0);
  return (
    <div className="pitch-pane inline-pitch">
      <button
        className="pitch-toggle"
        style={{ width: viewportWidth }}
        aria-expanded={expanded}
        aria-controls="pitch-graph"
        onClick={onToggle}
      >
        <strong>
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> Pitch path ·{" "}
          {part.name}
        </strong>
        {!expanded && <span className="muted">Show pitch path</span>}
      </button>
      {expanded && (
        <div
          id="pitch-graph"
          className="pitch-timeline"
          style={{ height }}
          role="img"
          aria-label="Target note blocks and detected sung pitch, aligned with notation"
        >
          <svg
            className="pitch-labels"
            style={{ width: labelWidth }}
            height={height}
          >
            {levels.map((m) => (
              <text key={m} x={labelWidth - 32} y={y(m) + 4}>
                {noteLabel(m)}
              </text>
            ))}
          </svg>
          {bars.map((cell) => {
            const b = piece.bars[cell.index];
            let path = "",
              pen = false,
              previous = -Infinity;
            for (const s of samples) {
              const t = tickAt(piece, s.time);
              if (t < b.start || t >= b.end) continue;
              if (s.midi === null || s.confidence < 0.85) {
                pen = false;
                continue;
              }
              if (s.time - previous > 0.2) pen = false;
              path += `${pen ? "L" : "M"}${cell.x(t).toFixed(2)},${y(Math.max(low, Math.min(high, s.midi))).toFixed(2)} `;
              pen = true;
              previous = s.time;
            }
            return (
              <svg
                key={cell.index}
                className="pitch-cell"
                style={{
                  left: labelWidth + cell.index * cellWidth,
                  width: cellWidth,
                }}
                height={height}
                viewBox={`0 0 ${cellWidth} ${height}`}
              >
                {levels.map((m) => (
                  <line
                    key={m}
                    x1="0"
                    x2={cellWidth}
                    y1={y(m)}
                    y2={y(m)}
                    stroke="var(--line)"
                  />
                ))}
                <line x1="0" x2="0" y1="0" y2={height} stroke="var(--line)" />
                {part.notes
                  .filter((n) => n.tick < b.end && n.tick + n.length > b.start)
                  .map((n) => (
                    <rect
                      key={n.id}
                      x={cell.x(Math.max(b.start, n.tick))}
                      y={y(n.midi) - 4}
                      width={Math.max(
                        2,
                        cell.x(Math.min(b.end, n.tick + n.length)) -
                          cell.x(Math.max(b.start, n.tick)) -
                          2,
                      )}
                      height="8"
                      rx="3"
                      fill="var(--target)"
                    />
                  ))}
                <path
                  d={path}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                />
              </svg>
            );
          })}
          <svg
            className="pitch-playhead"
            style={{
              left: labelWidth,
              width: 2,
              transform: running
                ? undefined
                : `translateX(${bar * cellWidth + (bars.find((c) => c.index === bar)?.x(tick) || 18)}px)`,
            }}
            data-playhead={part.id}
            height={height}
            aria-hidden="true"
          >
            <line
              x1="1"
              x2="1"
              y1="0"
              y2={height}
              stroke="var(--gold)"
              strokeWidth="1.5"
            />
          </svg>
        </div>
      )}
    </div>
  );
}
