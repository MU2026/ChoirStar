# Upstream provenance

Imported 2026-10-31 from https://github.com/vadymyem/OpenVox at commit `ce7f85eb8279d910ee01cd16aa97707bb2bccaf0` (AGPL-3.0-only).

Unmodified source snapshot, preserving the `src/` layout under `src/vendor/openvox/`:
- `src/core/music/notes.ts`: note naming and pitch conversions.
- `src/core/music/scoreModel.ts`: notation rhythm, rests, and ties.
- `src/core/music/scoreRenderer.ts`: SVG notation renderer.
- `src/core/audio/pitchDetector.ts`: YIN monophonic detector.
- `src/types/index.ts`: type declarations required by notation.

Copyright © 2026 Vadym Yemelianov / AuthorChe. LICENSE at the project root is the complete upstream AGPL-3.0 license. Upstream NOTICE and trademark policy are preserved alongside the snapshot. No upstream branding, analytics, donation flows, or network services are imported. These files have no runtime package dependencies.

ChoirStar adapters live outside the snapshot. Notation uses beat-based synthetic seconds at 60 BPM, while playback uses the complete MIDI tempo map. Each part is its own score; the upstream four-voice type is not an ensemble track-count limit. Record local upstream changes here with date and purpose.

Updates: compare this pinned commit with a selected newer upstream commit, import deliberately, run regression tests, and record the new base. Do not merge the whole upstream app.


## music21 NWC field reader, 2026-11-04

Source: music21 10.5.2, published wheel `music21-10.5.2-py3-none-any.whl` from [PyPI](https://pypi.org/project/music21/10.5.2/), SHA-256 `dba8696eafab709a244b6f18c64399edcccf4e96ddd1e0e4de7eff0a291c2dec`. This exact release archive, rather than a moving branch, is the pinned source identity. Original paths reviewed: `music21/noteworthy/binaryTranslate.py`, `constants.py`, `translate.py`, and the distribution LICENSE. Copyright (c) 2006-2026 Michael Scott Asato Cuthbert. Applicable license: BSD-3-Clause. The binary reader's own header states that no code was taken from nwc2xml; the GPL project was acknowledged for file-format documentation.

Adaptation: `src/nwc-binary.ts` ports the needed binary field reading to TypeScript and neutral notation commands. Local modifications dated 2026-11-04: bounds checking and limits, explicit supported-version/object errors, no permissive fallback to an unknown binary version, retained lyrics/transposition, no Python/music21 objects, and no runtime package dependency. Only supported binary versions are accepted. Protocol constants used by this reader are adapted from the same release. Preserve this attribution with the code.

`src/nwc.ts` is ChoirStar's bounded browser decompression, NWCTXT reader and MusicXML adapter. It uses native DecompressionStream and the existing MusicXML importer. All conversion is local. The full BSD notice is retained at `src/vendor/music21/LICENSE` and `public/licenses/music21-BSD-3-Clause.txt`; the public source notice acknowledges the adaptation. No corpus, private music, music21 runtime, viewer, synthesizer or unrelated dependencies were imported.

The earlier zz85/nwc-viewer and mzealey/nwc2xml sources were investigated only. No code from those GPL-v2 converter implementations was imported into ChoirStar because their applicable license terms did not establish a compatible grant for the current combined application.

Local modification, 2026-11-05: `src/nwc-binary.ts` retains each binary lyric slot, including whitespace-only entries, in the neutral command. The MusicXML adapter preserves these skipped notes and converts leading binary syllable-joining hyphens to MusicXML syllabic markers. No additional upstream code or dependency was imported.

Further local correction, 2026-11-05: retain slur state and lyric-assignment flags from binary note fields, including chord members. The adapter extends slurred syllables instead of advancing their token index and honors explicit Always/Never overrides. Binary flag interpretation was checked against the private input bytes and its existing MusicXML export; no converter implementation was copied and no new dependency was added.

## Traditional notation symbols, 2026-11-04

Bravura OpenType font from [Steinberg's Bravura repository](https://github.com/steinbergmedia/bravura), pinned commit `37b194378b710cc40e406ab6c4b07608bb9548ae`, original file `redist/otf/Bravura.otf`. Copyright © 2026 Steinberg Media Technologies GmbH; SIL Open Font License 1.1, Reserved Font Name "Bravura". Full notice: `public/licenses/Bravura-OFL.txt`.

`src/vendor/bravura/glyphs.ts` contains SVG outlines extracted from the unmodified font for noteheads, clefs, rests, accidentals, flags and time-signature digits. The outlines retain the OFL license. They are embedded drawing content, not a renamed or modified font. Reproduce with `scripts/extract-notation-glyphs.py` and the pinned OTF using Python fonttools (conversion tool only). No font runtime, network requests or new application dependencies are needed. `symbols.ts` places the outlines on the existing ten-unit staff grid.

Local OpenVox modification, 2026-11-04: `scoreRenderer.ts` accepts an optional traditional-symbol mode, retaining the original mode and shared rhythm spacing/overlay coordinates. Stems, beams, ties and ledger lines remain SVG geometry. The practice toolbar lets the user compare both styles; the selection lasts for the current application session.

Header alignment correction, 2026-11-04: both notation styles now use the measured Bravura clef and time-signature outlines. System Unicode font fallback made the original G clef too small. SMuFL time-signature digits use a centre origin; placing that origin as a text baseline shifted the traditional signature down one staff space. The two rows are now centred 10 and 30 SVG units below the top staff line. The G-clef origin remains on the G line, with a 70.24-unit ink height against a 40-unit staff.

Beam/flag correction, 2026-11-04: `scoreRenderer.ts` draws independent flags only for ungrouped notes. Beamed groups with mixed short durations retain their extra subdivision as secondary beam segments or short beamlets, instead of attaching a flag to a beamed note. Regression coverage exercises equal eighths, eighth/sixteenth pairs, isolated eighths, both stem directions and both notation styles.

Single notation style, 2026-11-04: Bravura symbols are now the only notation style. Removed the original geometric noteheads, hand-drawn rests/flags and text accidentals, together with the style option, practice toolbar switch and associated view state. Rhythm spacing, beam handling and pitch overlay coordinates remain shared with the existing renderer. Earlier entries above describe the incremental implementation history.
