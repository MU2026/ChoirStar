import { afterEach, expect, it, vi } from "vitest";
import { fetchReloadFile } from "../src/reload-source";
import { demoPiece } from "../src/model";
import { fetchLimited } from "../src/website";
vi.mock("../src/website", () => ({ fetchLimited: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const source = () => ({
  ...demoPiece(),
  source: "nwc" as const,
  website: {
    url: "https://example.org/download?id=12",
    page: "https://example.org/scores",
    category: ["Concert"],
  },
});
it("downloads the saved original URL and retains the catalogue filename for query links", async () => {
  const p = source();
  vi.mocked(fetchLimited).mockResolvedValue(
    new Response("synthetic score", {
      headers: { "content-type": "application/octet-stream" },
    }),
  );
  const f = await fetchReloadFile(p, [
    {
      url: p.website.page,
      title: "Scores",
      entries: [
        {
          url: p.website.url,
          title: p.title,
          filename: "study.nwctxt",
          format: "nwc",
          category: [],
        },
      ],
    },
  ]);
  expect(fetchLimited).toHaveBeenCalledWith(p.website.url, 20 * 1024 * 1024);
  expect(f.name).toBe("study.nwctxt");
  expect(await f.text()).toBe("synthetic score");
});
it("uses the stored source format when the original catalogue is unavailable", async () => {
  vi.mocked(fetchLimited).mockResolvedValue(new Response("synthetic score"));
  expect((await fetchReloadFile(source(), [])).name).toBe("reload.nwc");
});
it("rejects login HTML and inaccessible sources without changing the saved score", async () => {
  const p = source(),
    before = structuredClone(p);
  vi.mocked(fetchLimited).mockResolvedValue(
    new Response("<html>Sign in</html>", {
      headers: { "content-type": "text/html" },
    }),
  );
  await expect(fetchReloadFile(p, [])).rejects.toThrow("Sign in");
  vi.mocked(fetchLimited).mockRejectedValue(new Error("CORS blocked"));
  await expect(fetchReloadFile(p, [])).rejects.toThrow("CORS blocked");
  expect(p).toEqual(before);
});
it("does not attempt a website fetch for local pieces", async () => {
  await expect(fetchReloadFile(demoPiece(), [])).rejects.toThrow(
    "No source website",
  );
  expect(fetchLimited).not.toHaveBeenCalled();
});
