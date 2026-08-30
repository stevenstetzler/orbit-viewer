/**
 * The ten default bodies (Sun + 9 planets/barycenters), their known
 * natural-satellite kernels, and the manifest-driven satellite lookup --
 * extracted verbatim (data + logic) from `examples/browser-demo/index.html`.
 * See that file's own comments for the reasoning behind each choice
 * (why `target` and `bodyId` differ for the outer planets, why
 * Saturn/Uranus exclude some of their own moons, etc.) -- not repeated
 * here in full, just the parts a caller actually needs to know.
 */
import { KERNELS as KERNEL_MANIFEST } from '../../kernels/sources.mjs';

export const BODIES = [
  { target: 10, bodyId: 10, name: 'Sun', color: 0xffd34d, fallbackRadius: 5, iauFrame: 'IAU_SUN' },
  { target: 199, bodyId: 199, name: 'Mercury', color: 0x9c9c9c, fallbackRadius: 2, iauFrame: 'IAU_MERCURY' },
  { target: 299, bodyId: 299, name: 'Venus', color: 0xe8c27a, fallbackRadius: 2.4, iauFrame: 'IAU_VENUS' },
  { target: 399, bodyId: 399, name: 'Earth', color: 0x4da6ff, fallbackRadius: 2.6, iauFrame: 'IAU_EARTH' },
  { target: 4, bodyId: 499, name: 'Mars (barycenter)', color: 0xd9583a, fallbackRadius: 2.2, iauFrame: 'IAU_MARS' },
  { target: 5, bodyId: 599, name: 'Jupiter (barycenter)', color: 0xe0b98a, fallbackRadius: 3.6, iauFrame: 'IAU_JUPITER' },
  { target: 6, bodyId: 699, name: 'Saturn (barycenter)', color: 0xead6a8, fallbackRadius: 3.2, iauFrame: 'IAU_SATURN' },
  { target: 7, bodyId: 799, name: 'Uranus (barycenter)', color: 0x9fd9e8, fallbackRadius: 2.8, iauFrame: 'IAU_URANUS' },
  { target: 8, bodyId: 899, name: 'Neptune (barycenter)', color: 0x5b7fe0, fallbackRadius: 2.8, iauFrame: 'IAU_NEPTUNE' },
  { target: 9, bodyId: 999, name: 'Pluto (barycenter)', color: 0xbfa6d9, fallbackRadius: 1.4, iauFrame: 'IAU_PLUTO' },
];

/** Lowercase, URL-safe slug for a BODIES entry's own real body -- e.g. "Jupiter (barycenter)" -> "jupiter". Used for the /<body>/ routes. */
export function bodySlug(b) {
  return b.name.replace(/\s*\(.*\)\s*/g, '').trim().toLowerCase();
}

/** Look up a BODIES entry by its URL slug (see bodySlug()); null if unknown. */
export function bodyBySlug(slug) {
  return BODIES.find((b) => bodySlug(b) === slug) ?? null;
}

/**
 * Maps a body's real `bodyId` to the kernels/sources.mjs kernel most
 * likely to carry its natural satellites -- see
 * examples/browser-demo/index.html's own SATELLITE_KERNEL_FOR_BODY for
 * the full reasoning (Moon's real manifest `center` being the EMB, not
 * Earth itself; the excluded small/irregular/distant moons for Saturn
 * and Uranus).
 */
export const SATELLITE_KERNEL_FOR_BODY = {
  399: { kernelId: 'de440s', centerId: 3 },
  499: { kernelId: 'mar099' },
  599: { kernelId: 'jup365' },
  699: { kernelId: 'sat441', only: [601, 602, 603, 604, 605, 606, 607, 608, 612, 613, 614, 632, 634] },
  799: { kernelId: 'ura184-3', only: [701, 702, 703, 704, 705] },
  899: { kernelId: 'nep105' }, // Nereid only -- nep105 has no Triton
  999: { kernelId: 'plu060' },
};

// One more than the largest satellite family (Saturn, 13), so no two of
// one body's moons ever share a color via the i % length wraparound.
export const SATELLITE_COLORS = [
  0xd9d9d9, 0xffb37a, 0x8fd9c4, 0xe0a6ff, 0x7ac9ff, 0xffe27a, 0xff8fa6, 0xa6ffb3,
  0xffcc66, 0x66ffe0, 0xff99cc, 0xb3ff66, 0x9999ff, 0xff8c66,
];

/**
 * Real satellites of a body, read from kernels/sources.mjs's own
 * live-verified manifest for `kernelId`: every target whose `center` is
 * `centerId`, except `excludeIds` (must include both the body's own
 * `target` and `bodyId`, which aren't always the same value -- see the
 * SATELLITE_KERNEL_FOR_BODY doc comment above). Each entry gets a
 * *guessed* `iauFrame` (`IAU_<NAME>`), free to attempt, failing
 * gracefully at query time if the PCK doesn't actually have it.
 */
export function satellitesFromManifest(kernelId, centerId, excludeIds, only) {
  const entry = KERNEL_MANIFEST[kernelId];
  if (!entry) return [];
  return (entry.targets ?? [])
    .filter((t) => t.center === centerId && !excludeIds.includes(t.id) && (!only || only.includes(t.id)))
    .map((t, i) => ({
      target: t.id, bodyId: t.id, name: t.name, color: SATELLITE_COLORS[i % SATELLITE_COLORS.length],
      iauFrame: `IAU_${t.name.toUpperCase().replace(/\s+/g, '_')}`,
    }));
}
