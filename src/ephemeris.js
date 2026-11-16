// Loads the bundled Moon table in the browser. The table holds where the Sun
// and Earth are overhead on the Moon, hourly, 2024 to 2030, from JPL Horizons
// (tools/build_ephemeris.py). No live API call is made.
// Written with an AI tool.
import tableUrl from '../data/ephemeris.f32?url';
import meta from '../data/ephemeris.json';
import { createEphemeris } from './moonsky.js';

export async function loadEphemeris() {
  const response = await fetch(tableUrl);
  if (!response.ok) throw new Error(`Moon table request failed with status ${response.status}`);
  return createEphemeris(await response.arrayBuffer(), meta);
}
