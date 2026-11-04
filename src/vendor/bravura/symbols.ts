import { glyphs, unitsPerEm } from "./glyphs";

type Glyph = keyof typeof glyphs;

// One staff space is 10 SVG units; SMuFL uses four spaces per em.
// Outlines keep the symbols independent of installed fonts and font loading.
export function musicSymbol(
  name: Glyph,
  x: number,
  baseline: number,
  width?: number,
  align: "center" | "left" = "center",
): string {
  const glyph = glyphs[name];
  const [left, , right] = glyph.bounds;
  const sy = 40 / unitsPerEm;
  const sx = width === undefined ? sy : width / (right - left);
  const origin = align === "center" ? (left + right) / 2 : left;
  return `<path data-music-symbol="${name}" d="${glyph.path}" transform="translate(${x - origin * sx} ${baseline}) scale(${sx} ${-sy})" fill="#19161d"/>`;
}

export function musicAccidental(sign: string, x: number, y: number): string {
  return musicSymbol(
    sign === "♯" ? "sharp" : sign === "♭" ? "flat" : "natural",
    x,
    y,
  );
}

export function musicTimeNumber(
  value: number,
  x: number,
  centerY: number,
): string {
  const digits = String(value)
    .split("")
    .map((digit) => `digit${digit}` as Glyph);
  const widths = digits.map(
    (digit) => (glyphs[digit].advance * 40) / unitsPerEm,
  );
  let cursor = x - widths.reduce((a, b) => a + b, 0) / 2;
  return digits
    .map((digit, index) => {
      const symbol = musicSymbol(digit, cursor + widths[index] / 2, centerY);
      cursor += widths[index];
      return symbol;
    })
    .join("");
}
