import { uid, type Library } from "./model";

// Remove only unused factory profiles; keep custom singers and all histories.
export function removeUnusedDefaultSingers(library: Library): Library {
  const removed = new Set(
    library.profiles
      .filter(
        (p) =>
          ((p.id === "bass" && p.name === "Bass singer") ||
            (p.id === "alto" && p.name === "Alto singer")) &&
          !library.attempts.some((a) => a.profile === p.id),
      )
      .map((p) => p.id),
  );
  if (!removed.size) return library;
  return {
    ...library,
    profiles: library.profiles.filter((p) => !removed.has(p.id)),
    settings: Object.fromEntries(
      Object.entries(library.settings).filter(
        ([key]) => !removed.has(key.split(":")[0]),
      ),
    ),
  };
}

// Keep existing ownership intact while practice no longer asks for a singer.
export function ensurePracticeProfile(library: Library): Library {
  if (library.profiles.length) return library;
  return {
    ...library,
    profiles: [{ id: uid(), name: "Local practice" }],
  };
}
