# ChoirStar

Browser-based choir practice with MIDI/MusicXML import, a rehearsal mixer, synchronized notation and piano roll, and microphone pitch feedback.

Try it at https://mu2026.github.io/ChoirStar/ . This is an early prototype, designed primarily for desktop browsers; phone usability and microphone behavior vary by device.

## Practice

Create a singer profile, import a score or try the original 12-part study, then open practice. Select your assessed part in Track settings. Staff names collapse their notation; the pitch view collapses separately. Each staff has starting-note, mute and volume controls. Drag the bar ruler to choose a loop; click it again to clear. Playback speed ranges from 25% to 200%.

Use headphones for microphone practice. HTTPS and browser microphone permission are required. Bluetooth and browser processing can add latency; onset scoring is optional and requires calibration. Feedback is experimental and uncertain input is left unassessed.

MusicXML supports uncompressed partwise `.musicxml`/`.xml` files, multiple voices, ties, tempo/key changes, simple repeat unfolding and lyrics. Compressed `.mxl`, alternate endings, nested repeats and D.C./D.S. navigation are not yet supported. Grace/cue notes and unpitched percussion are omitted with notices. Notation is simplified, not a reproduction of the source page. All nonempty verses are shown; repeat-specific verse filtering is not implemented. MIDI notation infers short release gaps as articulation only for nearby conventional note lengths; actual playback timing is preserved.

## Your data

Scores, profiles, results and optional recordings stay in browser storage on your device. ChoirStar does not upload them or use analytics. GitHub Pages serves the application and receives normal web requests. Clearing site data can erase your library. Use History & backup to export/restore data and manage recordings. Different devices and site addresses have separate libraries.

No copyrighted repertoire or recordings are bundled. The 12-part study is synthetic.

## Build

Requires Node.js 22.12+ (or a newer compatible LTS version) and npm.

```sh
npm ci
npm test
npm run dev
```

Production build:

```sh
npm run build
npm run preview
```

For GitHub Pages under `/ChoirStar/`, build with an exact source link:

```sh
VITE_SOURCE_URL="https://github.com/MU2026/ChoirStar/tree/$(git rev-parse HEAD)" npm run build -- --base=/ChoirStar/
```

Publish only the contents of `dist/` to the `gh-pages` branch, including an empty `.nojekyll` file, and configure Pages to serve that branch's root directory. The main branch contains the corresponding source. Publication is manual; changing main alone does not deploy a new site. No server or account backend is required.

## License and provenance

GNU AGPL-3.0-only. See LICENSE, NOTICE, THIRD_PARTY_NOTICES.md and docs/upstream.md. Includes an attributed, pinned OpenVox source snapshot. ChoirStar is an independent derivative, not an official OpenVox distribution. Runtime dependency license texts are in public/licenses/. The application's Source code link identifies its exact build revision.
