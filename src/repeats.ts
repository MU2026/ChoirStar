// Navigation is resolved once for the whole score, before notes and lyrics are timed.
export type Navigation = {
  forward: boolean;
  repeat: number;
  endings: { type: string; passes: number[]; returnOnly?: boolean }[];
  sounds: Record<string, string>[];
};
export function passes(text: string): number[] {
  if (!/^\d+(\s*,\s*\d+)*$/.test(text))
    throw new Error("Invalid repeat ending or time-only numbers.");
  const result = text.split(",").map(Number);
  if (result.some((n) => n < 1 || n > 16))
    throw new Error("Repeat pass numbers must be between 1 and 16.");
  return result;
}
export function unfold(source: Navigation[]): number[] {
  const ranges: {
    start: number;
    end: number;
    passes: number[];
    returnOnly?: boolean;
    owner: number;
  }[] = [];
  let open:
    { start: number; passes: number[]; returnOnly?: boolean } | undefined;
  source.forEach((b, i) => {
    for (const e of b.endings) {
      if (e.type === "start") {
        if (open) throw new Error("Overlapping repeat endings.");
        open = { start: i, passes: e.passes, returnOnly: e.returnOnly };
      } else {
        if (!open || open.passes.join() !== e.passes.join())
          throw new Error("Unmatched repeat ending boundary.");
        ranges.push({ ...open, end: i, owner: -1 });
        open = undefined;
      }
    }
  });
  if (open) throw new Error("Unclosed repeat endings.");
  const blocks: {
    start: number;
    end: number;
    times: number;
    closes: number[];
  }[] = [];
  const stack: number[] = [];
  let implicit = 0;
  source.forEach((b, i) => {
    if (b.forward) stack.push(i);
    if (b.repeat > 1) {
      const ending = ranges.find((r) => r.start <= i && r.end >= i);
      const previous = blocks.at(-1);
      const continuation =
        !stack.length &&
        ending &&
        !ending.passes.includes(1) &&
        previous &&
        ranges.some((r) => r.start <= previous.end && r.end >= previous.end);
      const times =
        ending && !ending.returnOnly
          ? Math.max(b.repeat, ...ending.passes.map((n) => n + 1))
          : b.repeat;
      if (continuation) {
        previous.end = i;
        previous.closes.push(i);
        previous.times = Math.max(previous.times, times);
      } else
        blocks.push({
          start: stack.pop() ?? implicit,
          end: i,
          times,
          closes: [i],
        });
      if (!stack.length) implicit = i + 1;
    }
  });
  if (stack.length) throw new Error("Unclosed forward repeat.");
  for (const range of ranges) {
    const candidates = blocks
      .map((b, owner) => ({ ...b, owner }))
      .filter((b) => b.start <= range.start)
      .sort(
        (a, b) =>
          Number(b.end >= range.start) - Number(a.end >= range.start) ||
          (a.end >= range.start
            ? b.start - a.start || a.end - b.end
            : b.end - a.end),
      );
    if (!candidates.length)
      throw new Error("Repeat endings require a repeat section.");
    range.owner = candidates[0].owner;
  }
  const marker = (kind: string, name: string) => {
    const found = source.flatMap((b, i) =>
      b.sounds.some((s) => s[kind] === name) ? [i] : [],
    );
    if (found.length !== 1)
      throw new Error(`Missing or ambiguous ${kind} marker: ${name}.`);
    return found[0];
  };
  // Validate even unreachable jumps, rather than silently importing a damaged score.
  source.forEach((b) =>
    b.sounds.forEach((s) => {
      if (s.dalsegno) marker("segno", s.dalsegno);
      if (s.tocoda) marker("coda", s.tocoda);
    }),
  );
  source.forEach((b) => {
    const jumps = new Set(
      b.sounds.flatMap((s) =>
        ["dacapo", "dalsegno", "tocoda"]
          .filter((key) => s[key])
          .map((key) => `${key}:${s[key]}`),
      ),
    );
    if (jumps.size > 1)
      throw new Error("Conflicting navigation jumps in one measure.");
  });
  const played = blocks.map(() => 1);
  const jumped = new Set<number>();
  const order: number[] = [];
  let pc = 0,
    returning = false,
    steps = 0;
  while (pc < source.length) {
    if (++steps > 100000 || order.length >= 20000)
      throw new Error(
        "Expanded score exceeds the navigation or 20,000-bar limit.",
      );
    const b = source[pc];
    const ending = ranges.find((r) => pc >= r.start && pc <= r.end);
    const audible =
      !ending ||
      (ending.returnOnly
        ? returning
        : !(
            returning &&
            ranges.some((r) => r.owner === ending.owner && r.returnOnly)
          ) && ending.passes.includes(played[ending.owner]));
    if (audible) order.push(pc);
    const enclosing = blocks
      .map((b, i) => ({ ...b, i }))
      .filter((b) => b.start <= pc && pc <= b.end)
      .sort((a, b) => b.start - a.start || a.end - b.end)[0];
    const pass = enclosing
      ? played[enclosing.i]
      : ending
        ? played[ending.owner]
        : 1;
    let destination: number | undefined;
    if (audible)
      for (const s of b.sounds) {
        if (
          s["time-only"] &&
          !passes(s["time-only"]).includes(returning ? 2 : pass)
        )
          continue;
        if (s.fine && returning) return order;
        if (s.tocoda && returning) {
          destination = marker("coda", s.tocoda);
          if (destination <= pc) throw new Error("Coda must follow its jump.");
        }
        if ((s.dacapo || s.dalsegno) && !jumped.has(pc)) {
          jumped.add(pc);
          returning = true;
          destination = s.dalsegno ? marker("segno", s.dalsegno) : 0;
          if (destination > pc)
            throw new Error("D.C./D.S. must jump backward.");
        }
      }
    if (destination !== undefined) {
      pc = destination;
      continue;
    }
    const closing = blocks.findIndex((r) => r.closes.includes(pc));
    if (
      closing >= 0 &&
      audible &&
      !returning &&
      played[closing] < blocks[closing].times
    ) {
      played[closing]++;
      const outer = blocks[closing];
      blocks.forEach((b, i) => {
        if (i !== closing && b.start >= outer.start && b.end < outer.end)
          played[i] = 1;
      });
      pc = outer.start;
    } else pc++;
  }
  return order;
}
