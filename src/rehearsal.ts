import type { Mix, Piece, Settings } from "./model";

/** Solo is additive; mute always wins. Boost keeps the backing parts quiet. */
export function rehearsalGains(mix: Record<string, Mix>) {
  const values = Object.values(mix);
  const solo = values.some((part) => part.solo);
  const boosted = values.some(
    (part) => part.boost && !part.mute && (!solo || part.solo),
  );
  return Object.fromEntries(
    Object.entries(mix).map(([id, part]) => [
      id,
      part.mute || (solo && !part.solo)
        ? 0
        : part.volume * (boosted ? (part.boost ? 2 : 0.12) : 1),
    ]),
  );
}

/** A seek outside the loop is a lead-in; the next iteration keeps its range. */
export function playbackEndTick(
  piece: Piece,
  settings: Settings,
  tick: number,
) {
  const end = piece.bars[settings.to].end;
  return settings.loop && tick < end ? end : piece.end;
}

/** Denominator beats follow each bar's meter, with an accented first beat. */
export function metronomeTicks(piece: Piece) {
  return piece.bars.flatMap((bar) => {
    const ticks = [];
    const step = (piece.ppq * 4) / bar.meter[1];
    for (let beat = 0; bar.start + beat * step < bar.end - 1e-6; beat++)
      ticks.push({ tick: bar.start + beat * step, accent: beat === 0 });
    return ticks;
  });
}
