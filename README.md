# ChoirStar

Browser-based choir practice with MIDI, MusicXML and NWC import, a rehearsal mixer, synchronized notation and piano roll, and microphone pitch feedback.

Try it at https://mu2026.github.io/ChoirStar/ . This is an early prototype, designed primarily for desktop browsers; phone usability and microphone behavior vary by device.

## Practice

Use **Import → Local File** or **Import → Website** to add scores, then select a piece to open practice. Choose **My part** beside its staff. Staff names collapse their notation; the pitch view collapses separately. Each staff has starting-note, mute and volume controls. Drag the bar ruler to choose a loop; click it again to clear. Click the current speed to adjust it between 25% and 200%. Audio settings offer synthesized piano, choir, organ and strings sounds. Import warnings open from a small warning handle in the practice header.

Organize pieces in folders and subfolders with drag and drop or the move selector, and undo the latest organization change. A shared score can appear in several concert folders. Removing one appearance preserves the others; removing the final appearance asks for confirmation before deleting associated practice data. Existing local singer profiles and their history remain preserved internally.

Use headphones for microphone practice. HTTPS and browser microphone permission are required. Bluetooth and browser processing can add latency; onset scoring is optional and requires calibration. Feedback is experimental and uncertain input is left unassessed.

MusicXML supports uncompressed partwise `.musicxml`/`.xml` files, multiple voices, ties, tempo/key changes and lyrics. MusicXML and NWC unfold supported nested repeats, repeat counts, numbered endings and D.C./D.S., Fine and Coda navigation. Ambiguous or unsupported navigation produces an error. Compressed `.mxl` is not supported. Grace/cue notes and unpitched percussion are omitted with notices. Notation is simplified, not a reproduction of the source page. All nonempty verses are shown; repeat-specific verse filtering is not implemented. MIDI notation infers short release gaps as articulation only for nearby conventional note lengths; actual playback timing is preserved.

NWC conversion runs locally for binary NWC 1.75/2.0/2.01, embedded-text NWC 2.75 and standalone `.nwctxt`. Unsupported binary versions or notation records produce readable errors. Staff transposition and octave shifts affect sounding pitches. Initial bass clefs and octave treble clefs are preserved; later clef changes use the initial display clef with a warning. Re-import older scores to apply import corrections.

## Your data

Scores, profiles, results and optional recordings stay in browser storage on your device. ChoirStar does not upload them or use analytics. GitHub Pages serves the application and receives normal web requests. Clearing site data can erase your library. Use History & backup to export/restore data and manage recordings. Different devices and site addresses have separate libraries.

No copyrighted repertoire or recordings are bundled. Test scores are synthetic.

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

## Website libraries

Open **Import → Website**. Enter a repertoire page address and choose **Read page**. The catalogue lists MIDI, uncompressed MusicXML and supported NWC files with the page's headings and table groups. Filter the list, select scores and choose **Import selected**. Repeated links in different groups import only once, while preserving their separate catalogue appearances.

For a members-only website, use **Open website / sign in** to authenticate on that website. ChoirStar cannot directly read arbitrary signed-in tabs. Expand **Signed-in or blocked website?** and drag **Export to ChoirStar** to a desktop browser's bookmarks bar. Invoke that bookmark on the repertoire page to download a local catalogue with available score files, then import the resulting JSON in ChoirStar. The helper never exports credentials or uploads scores. Keep the page open until it finishes. Sites may restrict scripts/downloads; in that case save the page as HTML, enter its original URL in ChoirStar, import the HTML, and use **Open file** / **Attach file** for protected scores.

Catalogues remain in local storage and backups; embedded raw score downloads are held only for the current import session. Only imported practice scores are retained. Pages, scores and recordings are not sent to GitHub or a proxy. Direct URL imports require the source site's cross-origin permission. PDF, audio and compressed MusicXML are not supported, and linked subpages are not crawled. Grouping is inferred from page structure and may not reproduce every site's custom layout.
