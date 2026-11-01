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
