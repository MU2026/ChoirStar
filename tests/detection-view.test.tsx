import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Score } from "../src/views";
import { defaults, demoPiece } from "../src/model";

const noop = () => {};
function renderScore(detectionEnabled: boolean) {
  const piece = demoPiece();
  const settings = defaults(piece);
  settings.part = piece.parts[0].id;
  return renderToStaticMarkup(
    <Score
      detectionEnabled={detectionEnabled}
      piece={piece}
      settings={settings}
      zoom={1}
      time={0}
      samples={[]}
      running={false}
      playbackPosition={() => 0}
      controlsDisabled={false}
      passageDisabled={false}
      results={[]}
      feedbackPart={settings.part}
      onMix={noop}
      onPart={noop}
      onNote={noop}
      onRange={noop}
      onSeek={noop}
      onSpeed={noop}
      onMetronome={noop}
      onInitialPitches={noop}
    />,
  );
}

describe("optional singing detection score", () => {
  it("hides assessment UI even with a saved target, preserving the score and mixer access", () => {
    const html = renderScore(false);
    expect(html).not.toContain("Pitch path");
    expect(html).not.toContain("Sung pitch");
    expect(html).not.toContain("target-group");
    expect(html).not.toContain("notation-overlay");
    expect(html).toContain("Mixer");
    expect(html).toContain("Collapse Soprano 1 staff");
    expect(html).toContain("notation-cell");
  });
  it("restores pitch feedback and the assessed staff when enabled", () => {
    const html = renderScore(true);
    expect(html).toContain("Pitch path");
    expect(html).toContain("Sung pitch on notation");
    expect(html).toContain("target-group");
  });
});
