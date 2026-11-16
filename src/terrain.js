// Terrain horizons for the built-in landing sites, from NASA LOLA elevation (16 pixels per degree).
// Built by tools/build_terrain.py. Each profile is 360 elevation angles in degrees, one per degree of
// azimuth clockwise from north. Custom points have no profile, so they stay on the smooth horizon.
// Written with an AI tool (Claude).
import TERRAIN from '../data/terrain-horizons.json';

export const TERRAIN_META = TERRAIN.meta;
export const TERRAIN_NOT_AVAILABLE = 'Terrain is not available for custom points.';

/** The site's skyline, or null when there is none (custom points and unknown ids). */
export function profileFor(siteId) {
  const p = Object.hasOwn(TERRAIN.sites, siteId) ? TERRAIN.sites[siteId] : null;
  return Array.isArray(p) && p.length === 360 ? p : null;
}

/** Can this site use the terrain horizon? */
export const hasTerrain = (siteId) => profileFor(siteId) !== null;

/** Highest point of a site's skyline in degrees, or null. */
export function maxHorizon(siteId) {
  const p = profileFor(siteId);
  return p ? Math.max(...p) : null;
}
