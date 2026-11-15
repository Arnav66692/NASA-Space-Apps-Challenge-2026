# Long Shadow

**NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator**

> What changes in the first 72 hours on the Moon if touchdown slips nine days?

Long Shadow compares two hypothetical touchdowns at real landing sites, an original on **Mar 15, 2025 00:00 UTC** and a delayed one on **Mar 24, 2025 00:00 UTC**. For each it shows how many hours the Sun, Earth, and both are above a smooth reference horizon. Sun above means a geometric chance for solar power. Earth above means a geometric chance for direct-to-Earth radio. All geometry comes from NASA/JPL Horizons and ships with the site, so it needs no API key and no network calls.

It opens on that nine-day question at two real sites. From there you can pick **any site, any touchdown from 2024 through 2030, and any slip from 1 to 30 days**. Seven more real landing sites are in the menu, and you can type your own latitude and longitude. The address bar updates as you go, so a link reopens the exact view.

*Smooth-horizon estimate. Local terrain, eclipses, and lander hardware are outside this model.*

## Run it

Requires Node 18+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # calculation contract: all reference totals and crossings
npm run build      # static site in dist/
npm run preview    # serve the production build locally
npm run build:single  # one self-contained HTML in dist-single/ (double-click to open; shareable as a file)
```

`dist/` is a plain static site with relative paths. You can deploy it anywhere:

- **Netlify:** drag `dist/` onto app.netlify.com/drop, or connect the repo with build `npm run build` and publish dir `dist`.
- **Vercel:** import the repo. It detects Vite automatically.
- **GitHub Pages:** push `dist/` to a `gh-pages` branch, or use the official "Deploy static content" action with `npm ci && npm run build`.

## What's in the app

| Area | What it does |
| --- | --- |
| Hero | The question, the computed answer for the selected site, the site picker, both touchdown dates, **Apply +9 days**, and the three-metric comparison |
| Change the plan | More landing sites, custom coordinates, a touchdown date and time in UTC, and a slip slider from 1 to 30 days. Every view below follows. **Copy link** shares the exact view |
| 3D globe | Moon lit by the JPL Sun direction at the selected instant. The gold line is sunrise/sunset and the dashed blue line is where Earth sits on the horizon. Applying the delay sweeps the terminator across the Moon |
| Timelines | Sun / Earth / Both above-horizon bars for both scenarios on one 0–72 h axis, with a shared cursor and labeled crossings. Click or drag to scrub |
| Sky | 3D lander scene with the Sun and Earth placed by azimuth/elevation, real shadow length, Earth phase, earthshine and a dish aimed at Earth. Plus a 2D horizon strip fitted to the actual elevation range, numeric readouts, and a live next-crossing countdown |
| Mission clock | Sticky scrubber. ←/→ moves 1 h, Shift+←/→ moves 10 min, PgUp/PgDn moves 6 h, Home/End jump to the ends. Play animates the stay |
| Replay | Blue Ghost original. Animates to the modeled sunset (~20:11 UTC, Mar 16 2025) next to Firefly's reported sunset imagery and 5+ h of night operations |
| Methods | Data, calculation, checks completed, 3D caveats, sources |

## Data

`data/*.csv` contains four presets with 73 hourly samples each (72 intervals), collected by `Get-LunarHorizons.ps1` from the JPL Horizons API. The query uses an observer table at a surface `coord@301` site, Sun `10` and Earth `399` centres, `QUANTITIES=4` (apparent airless az/el), UTC.

| Site | Coordinates | Original | Delayed |
| --- | --- | --- | --- |
| Blue Ghost | 18.562° N, 61.810° E | `blue-ghost-original.csv` | `blue-ghost-delayed.csv` |
| Athena | 84.7906° S, 29.1957° E | `athena-original.csv` | `athena-delayed.csv` |

Every other site, date and slip comes from one bundled table, `data/ephemeris.f32` (1.5 MB). It holds the points on the Moon where the Sun and Earth are overhead, hourly from 2024 through 2030, from the same JPL Horizons API (Moon seen from Earth's centre, quantities 14, 15, 19 and 20). `src/moonsky.js` turns those points into azimuth and elevation at any site on a smooth sphere at zero altitude. `tools/build_ephemeris.py` rebuilds the table. The seven extra sites use coordinates from the same NASA NSSDCA table as the presets.

To regenerate a preset (PowerShell):

```powershell
.\Get-LunarHorizons.ps1 -Name athena-delayed -Latitude -84.7906 -Longitude 29.1957 -StartUtc '2025-03-24 00:00'
```

The CSVs are imported at build time (`?raw`), then parsed and validated at load. The checks cover increasing UTC timestamps, a 72 h span, and finite values.

## Code map

```
src/data.js       CSV parse + validation, site/scenario metadata
src/calc.js       calculation contract: intervals, crossings, overlap, impact, interpolation, countdowns
src/moonsky.js    Sun and Earth direction at any site and time, from the bundled table
src/window.js     builds the 73 hourly samples of a 72 h stay for any site and date
src/ephemeris.js  loads the bundled table in the browser
src/format.js     all display rounding (after calculation)
src/timeline.js   availability bars + shared cursor
src/skystrip.js   2D horizon strip (SVG)
src/three/        globe, surface scene, procedural textures, coordinate helpers (lazy-loaded)
tests/            vitest: reference totals, events, countdowns, edge cases, table engine vs JPL
tools/            table builder and the script that fetched the 10 x 10 reference answers
docs/HANDOFF.md   the original build brief
```

## Verification

`npm test` runs 28 tests, and all pass. The first 16 cover the four presets. They reproduce the brief's full-precision totals for all four presets (Blue Ghost Sun 44.177521847 h; Athena Earth 66.497844255 → 17.750254565 h, a 48.747589690 h loss). They also cover every crossing (Blue Ghost sunset 20:10:39, Athena Earthset 18:29:52, Athena Earthrise 06:14:59), the 54 h 15 min → 53 h 15 min countdown, the zero-sample merge, and azimuth wrap across north.

The other 12 cover the any-site engine:

- **10 sites x 10 dates against direct JPL Horizons queries.** The bar was 0.5 degrees, set before the check ran. All 200 Sun and Earth directions agree within 0.006 degrees. The reference answers are saved in `tests/reference/p1_horizons.json`.
- **The four preset files.** The table reproduces all 584 Sun and Earth directions within 0.006 degrees, the same hour totals within 0.02 h, and the same crossings within 2 minutes.
- Stays outside 2024 to 2030 and bad coordinates are rejected. Far-side sites never see Earth.

Browser checks done during the build:

- Blue Ghost original → delayed at hour 0: the countdown clears and the Sun reads −71.1°, on scale.
- Athena delayed at hour 0 reads 54 h 15 min. One arrow-key step reads 53 h 15 min. After Earthrise it shows "No further crossing".
- Layout checked at desktop width and at a 390 px phone width.
- More sites, custom coordinates, the date field, the slip slider and shared links were each checked in the dev server, at desktop width and at 390 px. The production build was checked once, at desktop width, with a shared link to a far-side site.

Not yet done:

- The five-person usability test.
- Eclipse and lander-tilt validation, which is out of scope.
- Real terrain. Near the poles a ridge can hide the Sun or Earth while this model shows it up.

## Credits

- Ephemerides: NASA/JPL Horizons.
- Site coordinates: NASA NSSDCA, [lunar landing and impact sites](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html). Chandrayaan-3 is an ISRO mission, SLIM is a JAXA mission, and Chang'e 4 and 6 are CNSA missions.
- Mission report: Firefly Aerospace, Blue Ghost Mission 1 updates.
- All 3D textures and models are original and procedural. No imagery is used.
- Fonts: Inter, IBM Plex Mono (SIL OFL).
- Built with AI assistance (planning and implementation); to be disclosed in the submission's AI field.

## Team

Team Name: **Red K**  
**agastya singh, arnav singh, arsh johari, pratham tomar**
