import { DOMParser } from "@xmldom/xmldom";
import { expect, it, vi, afterEach } from "vitest";
import {
  scanWebsite,
  parseWebsiteExport,
  fetchLimited,
  websiteBookmarklet,
} from "../src/website";
const parse = (html: string) =>
  new DOMParser().parseFromString(
    `<html><head><title>Choir repertoire</title></head><body>${html}</body></html>`,
    "text/html",
  ) as unknown as Document;
const page = "https://choir.example/members/repertoire/";
// Browsers normalize bookmark URLs before executing their decoded payload.
const bookmarkletScript = () =>
  decodeURIComponent(new URL(websiteBookmarklet()).pathname)
    .replace(/^void\(/, "")
    .slice(0, -1);
afterEach(() => vi.unstubAllGlobals());
it("finds supported links, resolves URLs, keeps heading and list categories, rejects unsafe schemes", () => {
  const result = scanWebsite(
    parse(
      `<h1>Repertoire</h1><h2>Winter</h2><ul><li>Evening<ul><li><a href="../snow.MID?version=2#x">Snow</a></li></ul></li></ul><a href="/download?file=choir.musicxml">XML score</a><a href="/song.pdf">PDF</a><a href="/song.mxl">Compressed</a><a href="javascript:alert(1)" download="x.mid">Bad</a><a href="https://user:pass@choir.example/x.mid">Bad</a><h2>Spring</h2><a href="/spring.xml">Spring</a>`,
    ),
    page,
  );
  expect(result.entries.map((e) => e.format)).toEqual([
    "midi",
    "musicxml",
    "musicxml",
  ]);
  expect(result.entries[0].url).toBe(
    "https://choir.example/members/snow.MID?version=2",
  );
  expect(result.entries[0].category).toEqual([
    "Repertoire",
    "Winter",
    "Evening",
  ]);
  expect(result.entries[2].category).toEqual(["Repertoire", "Spring"]);
});
it("preserves table concert sections, subsections and repeated repertoire across concerts", () => {
  const result = scanWebsite(
    parse(
      `<h1>Season</h1><table><tr style="background:cyan"><td colspan="5"><strong>Concert A</strong></td></tr><tr><td colspan="5"><em>Opening</em></td></tr><tr><td><strong>First song</strong><br/>Composer</td><td><a href="/first.mid"><img alt="mid" src="icon.png"/>12 KB</a></td></tr><tr style="background:cyan"><td colspan="5"><strong>Concert B</strong></td></tr><tr><td>First song<br/>Composer</td><td><a href="/first.mid">MIDI</a><a href="/first.mid#again">Duplicate</a></td></tr></table>`,
    ),
    page,
  );
  expect(result.entries).toHaveLength(2);
  expect(result.entries[0].title).toBe("First song");
  expect(result.entries[0].category).toEqual([
    "Season",
    "Concert A",
    "Opening",
  ]);
  expect(result.entries[1].category).toEqual(["Season", "Concert B"]);
});
it("preserves details groups and base addresses without executing page content", () => {
  const doc = parse(
    `<base href="https://files.example/scores/"/><details><summary>Festival</summary><a href="one.midi">One</a></details><script>alert('never')</script>`,
  );
  expect(scanWebsite(doc, page).entries[0]).toMatchObject({
    url: "https://files.example/scores/one.midi",
    category: ["Festival"],
  });
});
it("validates website exports including supported formats and safe link URLs", () => {
  const catalogue = scanWebsite(parse('<a href="one.mid">One</a>'), page);
  expect(
    parseWebsiteExport(
      JSON.stringify({ format: "ChoirStar website", catalogue }),
    ).files,
  ).toEqual({});
  catalogue.entries[0].url = "javascript:alert(1)";
  expect(() =>
    parseWebsiteExport(
      JSON.stringify({ format: "ChoirStar website", catalogue }),
    ),
  ).toThrow();
});
it("does not send cookies to direct-import websites and enforces response limits", async () => {
  const fetcher = vi.fn(async () => new Response("123456"));
  vi.stubGlobal("fetch", fetcher);
  await expect(fetchLimited(page, 5)).rejects.toThrow("too large");
  expect(fetcher.mock.calls[0]).toEqual([
    page,
    expect.objectContaining({
      credentials: "omit",
      referrerPolicy: "no-referrer",
    }),
  ]);
});
it("emits a self-contained bookmarklet that scans the page and respects cancellation", async () => {
  vi.stubGlobal("document", parse('<a href="one.mid">One</a>'));
  vi.stubGlobal("location", new URL(page));
  const confirm = vi.fn(() => false);
  const fetcher = vi.fn();
  vi.stubGlobal("confirm", confirm);
  vi.stubGlobal("fetch", fetcher);
  const script = bookmarkletScript();
  await new Function(`return ${script}`)();
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining("1 score links"),
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps an archive separator as a parent of subsequent concert groups", () => {
  const c = scanWebsite(
    parse(
      '<table><tr><td colspan="3"><strong><em>* * * Past concerts * * *</em></strong></td></tr><tr style="background:cyan"><td colspan="3">Concert</td></tr><tr><td>Song</td><td><a href="a.mid">MIDI</a></td></tr></table>',
    ),
    page,
  );
  expect(c.entries[0].category).toEqual(["Past concerts", "Concert"]);
});
it("exports a self-contained local bundle and restricts credentials to same-origin files", async () => {
  const doc = parse(
    '<a href="a.mid">One</a><a href="https://files.example/b.xml">Two</a>',
  );
  const anchor = Object.assign(doc.createElement("a"), { click: vi.fn() });
  vi.spyOn(doc, "createElement").mockReturnValue(anchor);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("location", new URL(page));
  vi.stubGlobal("confirm", () => true);
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("setTimeout", vi.fn());
  const fetcher = vi.fn(async () => new Response("score"));
  vi.stubGlobal("fetch", fetcher);
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:application/octet-stream;base64,c2NvcmU=";
      onload: (() => void) | null = null;
      readAsDataURL() {
        this.onload?.();
      }
    },
  );
  let exported: Blob | undefined;
  const createURL = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation((blob) => {
      exported = blob as Blob;
      return "blob:test";
    });
  try {
    const script = bookmarkletScript();
    await new Function(`return ${script}`)();
    const bundle = parseWebsiteExport(await exported!.text());
    expect(Object.keys(bundle.files)).toHaveLength(2);
    expect(fetcher.mock.calls).toEqual([
      [
        "https://choir.example/members/repertoire/a.mid",
        expect.objectContaining({ credentials: "same-origin" }),
      ],
      [
        "https://files.example/b.xml",
        expect.objectContaining({ credentials: "omit" }),
      ],
    ]);
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.download).toBe("choirstar-choir.example.json");
  } finally {
    createURL.mockRestore();
  }
});

it("recognizes NWC and NWCTXT links including download names and filename parameters", () => {
  const catalogue = scanWebsite(
    parse(
      '<a href="/one.NWC">One</a><a href="/get?file=two.nwctxt">Two</a><a href="/download" download="three.nwc">Three</a>',
    ),
    page,
  );
  expect(catalogue.entries.map((e) => e.format)).toEqual(["nwc", "nwc", "nwc"]);
  expect(
    parseWebsiteExport(
      JSON.stringify({ format: "ChoirStar website", catalogue, files: {} }),
    ).catalogue,
  ).toEqual(catalogue);
});
