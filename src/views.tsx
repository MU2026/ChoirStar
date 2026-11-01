import { useLayoutEffect, useRef, useState, useMemo, memo } from "react";
import { lyricLayout } from "./lyrics";
import { notationBar } from "./notation";
import { noteLabel } from "./vendor/openvox/core/music/notes";
import {
  secondsAt,
  tickAt,
  barAt,
  type Piece,
  type Settings,
  type Sample,
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
const EngravedBar = memo(function EngravedBar({ svg }: { svg: string }) {
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
});
function VolumeKnob({
  name,
  value,
  onChange,
}: {
  name: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ y: number; value: number } | null>(null);
  const set = (v: number) =>
    onChange(Math.max(0, Math.min(1, Math.round(v * 100) / 100)));
  return (
    <div
      className="volume-knob"
      role="slider"
      tabIndex={0}
      aria-label={`${name} volume`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      aria-valuetext={`${Math.round(value * 100)} percent`}
      title={`${name}: ${Math.round(value * 100)}% · Drag up/down or use arrow keys`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.focus();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, value };
      }}
      onPointerMove={(e) => {
        if (drag.current)
          set(drag.current.value + (drag.current.y - e.clientY) / 150);
      }}
      onPointerUp={(e) => {
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={(e) => {
        const values: Record<string, number> = {
          ArrowUp: value + 0.05,
          ArrowRight: value + 0.05,
          ArrowDown: value - 0.05,
          ArrowLeft: value - 0.05,
          Home: 0,
          End: 1,
          PageUp: value + 0.1,
          PageDown: value - 0.1,
        };
        if (e.key in values) {
          e.preventDefault();
          set(values[e.key]);
        }
      }}
    >
      <span
        className="knob-face"
        aria-hidden="true"
        style={{ transform: `rotate(${-135 + value * 270}deg)` }}
      >
        <i />
      </span>
      <small aria-hidden="true">{Math.round(value * 100)}</small>
    </div>
  );
}
export function Score({
  piece,
  settings,
  time,
  samples,
  running,
  playbackPosition,
  onMix,
  controlsDisabled,
  onStartingNote,
  onRange,
}: {
  piece: Piece;
  settings: Settings;
  time: number;
  samples: Sample[];
  running: boolean;
  playbackPosition: () => number;
  onMix: (id: string, patch: Partial<Settings["mix"][string]>) => void;
  controlsDisabled: boolean;
  onStartingNote: (part: string) => void;
  onRange: (range: { from: number; to: number } | null) => void;
}) {
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
    ) + 88;
  const cellWidth = Math.max(120, (width - labelWidth) / 4);
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
    return Math.max(
      0,
      Math.min(
        piece.bars.length - 1,
        Math.floor(
          (x - el.getBoundingClientRect().left + el.scrollLeft - labelWidth) /
            cellWidth,
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
  const last = Math.min(piece.bars.length, first + 7);
  const parts = piece.parts;
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
        Math.max(
          piece.bars[settings.from].start,
          tickAt(piece, Math.max(0, playbackPosition())),
        ),
      );
      const currentBar = barAt(piece, liveTick),
        b = piece.bars[currentBar];
      const position = currentBar + (liveTick - b.start) / (b.end - b.start);
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
      ref={ref}
      aria-label="Scrollable score"
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
            if (e.key === "Escape" && !controlsDisabled) {
              e.preventDefault();
              endRange(true);
              onRange(null);
            }
          }}
          onPointerDown={(e) => {
            if (
              controlsDisabled ||
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
              const shift =
                d.x > r.right - 30
                  ? 8
                  : d.x < r.left + labelWidth + 20
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
          <span
            className="ruler-label"
            style={{ width: labelWidth }}
            title="Drag across bar numbers to select. Drag either edge to resize. Click the selection or press Escape to clear."
          >
            {range
              ? `Bars ${range.from + 1}–${range.to + 1}`
              : "Drag bars to loop"}
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
                  tabIndex={controlsDisabled ? -1 : 0}
                  aria-label={
                    edge === "start" ? "Passage start bar" : "Passage end bar"
                  }
                  aria-valuemin={1}
                  aria-valuemax={piece.bars.length}
                  aria-valuenow={(edge === "start" ? range.from : range.to) + 1}
                  aria-disabled={controlsDisabled}
                  onKeyDown={(e) => {
                    if (controlsDisabled) return;
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
              {first + i + 1} · {piece.bars[first + i].meter.join("/")}
            </span>
          ))}
        </div>
        {cells.map(({ part, bars, lyrics }) => (
          <section
            key={part.id}
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
                  <div className="staff-mixer">
                    <button
                      className="staff-collapse"
                      aria-label={`Collapse ${part.name} staff`}
                      aria-expanded="true"
                      onClick={() => onMix(part.id, { visible: false })}
                    >
                      <span aria-hidden="true">▾</span> {part.name}
                    </button>
                    <div className="staff-mix-controls">
                      <button
                        className="staff-mute start-note"
                        disabled={controlsDisabled}
                        aria-label={`Starting note for ${part.name}`}
                        title={`Starting note for ${part.name}`}
                        onClick={() => onStartingNote(part.id)}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          aria-hidden="true"
                        >
                          <ellipse
                            cx="8"
                            cy="18"
                            rx="4"
                            ry="3"
                            fill="currentColor"
                          />
                          <path d="M12 18V3c0 5 9 3 6 10" />
                        </svg>
                      </button>
                      <button
                        className="staff-mute"
                        aria-label={`Mute ${part.name}`}
                        title={`Mute ${part.name}`}
                        aria-pressed={settings.mix[part.id]?.mute || false}
                        onClick={() =>
                          onMix(part.id, { mute: !settings.mix[part.id]?.mute })
                        }
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          aria-hidden="true"
                        >
                          <path d="M3 9h4l5-4v14l-5-4H3z" />
                          {settings.mix[part.id]?.mute ? (
                            <path d="m16 9 6 6m0-6-6 6" />
                          ) : (
                            <path d="M16 8q5 4 0 8" />
                          )}
                        </svg>
                      </button>
                      <VolumeKnob
                        name={part.name}
                        value={settings.mix[part.id]?.volume ?? 0.6}
                        onChange={(volume) => onMix(part.id, { volume })}
                      />
                    </div>
                  </div>
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
                      <EngravedBar svg={cell.svg} />
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
                    aria-hidden="true"
                  >
                    {lyrics.verses.map((v) => (
                      <div key={v}>
                        {lyrics.verses.length > 1 ? v + "." : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="collapsed-staff">
                <button
                  style={{ width: labelWidth }}
                  className="staff-collapse"
                  aria-label={`Expand ${part.name} staff`}
                  aria-expanded="false"
                  onClick={() => onMix(part.id, { visible: true })}
                >
                  <span aria-hidden="true">▸</span> {part.name}
                </button>
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
        <span className="muted">
          {expanded ? "Target blocks / your voice line" : "Show pitch path"}
        </span>
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
