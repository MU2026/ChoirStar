import { importMidi } from "./model";
import { importMusicXml } from "./musicxml";
import { importNwc } from "./nwc";

async function parseScore(file: File) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Score files must be smaller than 20 MB.");
  if (/\.(nwc|nwctxt)$/i.test(file.name))
    return importNwc(await file.arrayBuffer(), file.name);
  if (/\.(musicxml|xml)$/i.test(file.name))
    return importMusicXml(await file.text(), file.name);
  if (/\.mxl$/i.test(file.name))
    throw new Error(
      "Compressed MusicXML is not supported yet. Export an uncompressed .musicxml file.",
    );
  if (!/\.mid[i]?$/i.test(file.name))
    throw new Error("Choose a MIDI, MusicXML, NWC or NWCTXT file.");
  return importMidi(await file.arrayBuffer(), file.name);
}

export async function importScore(file: File) {
  const piece = await parseScore(file);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  piece.fileHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return piece;
}
