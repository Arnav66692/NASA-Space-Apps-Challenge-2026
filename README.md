# Long Shadow

**NASA Space Apps Challenge 2026 · Lunar Landing Site Navigator**

> What changes in the first 72 hours on the Moon if touchdown slips nine days?

**Live site:** https://long-shadow-moon.vercel.app (opens with no login)

Long Shadow compares two hypothetical touchdowns at real landing sites, an original on **Mar 15, 2025 00:00 UTC** and a delayed one on **Mar 24, 2025 00:00 UTC**. For each it shows how many hours the Sun, Earth, and both are above a smooth reference horizon. Sun above means a geometric chance for solar power. Earth above means a geometric chance for direct-to-Earth radio. All geometry comes from NASA/JPL Horizons and ships with the site, so it needs no API key and no network calls.

It opens on that nine-day question at two real sites. From there you can pick **any site, any touchdown from 2024 through 2030, and any slip from 1 to 30 days**. Seven more real landing sites are in the menu, and you can type your own latitude and longitude. The address bar updates as you go, so a link reopens the exact view.

*Smooth-horizon estimate. Local terrain and lander hardware are outside this model.*

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

The live site is a Vercel project named `long-shadow-moon`. It is not connected to this repo, so a push to main does not update it. Redeploy by hand after a change with `vercel deploy --prod` from a checkout of main.

`dist/` is a plain static site with relative paths. You can deploy it anywhere:

- **Netlify:** drag `dist/` onto app.netlify.com/drop, or connect the repo with build `npm run build` and publish dir `dist`.
- **Vercel:** import the repo. It detects Vite automatically.
- **GitHub Pages:** push `dist/` to a `gh-pages` branch, or use the official "Deploy static content" action with `npm ci && npm run build`.

## What's in the app

| Area | What it does |
| --- | --- |
| Hero | The question, the computed answer for the selected site, the site picker, both touchdown dates, **Apply +9 days**, and the three-metric comparison |
| Change the plan | More landing sites, custom coordinates, a touchdown date and time in UTC, and a slip slider from 1 to 30 days. Every view below follows. **Copy link** shares the exact view |
| Slip strip | One cell per day of delay, 0 to 30, each with Sun, Earth and both hours on the same 72 h scale. The slips with the most and the fewest hours with both up are marked. Click a cell to set the slip |
| Eclipse flag | When Earth passes in front of the Sun (a lunar eclipse seen from the surface), the timeline marks it and the time the Sun is fully covered is counted as no sunlight |
| 3D globe | Moon lit by the JPL Sun direction at the selected instant. The gold line is sunrise/sunset and the dashed blue line is where Earth sits on the horizon. Applying the delay sweeps the terminator across the Moon |
| Timelines | Sun / Earth / Both above-horizon bars for both scenarios on one 0–72 h axis, with a shared cursor and labeled crossings. Click or drag to scrub |
| Sky | 3D lander scene with the Sun and Earth placed by azimuth/elevation, real shadow length, Earth phase, earthshine and a dish aimed at Earth. Plus a 2D horizon strip fitted to the actual elevation range, numeric readouts, and a live next-crossing countdown |
| Mission clock | Sticky scrubber. ←/→ moves 1 h, Shift+←/→ moves 10 min, PgUp/PgDn moves 6 h, Home/End jump to the ends. Play animates the stay |
| Replay | Blue Ghost original. Animates to the modeled sunset (~20:11 UTC, Mar 16 2025) next to Firefly's reported sunset imagery and 5+ h of night operations. A second replay shows Mar 14, 2025 at the same site, when the model puts the Sun behind Earth from 06:18 to 08:35 UTC. That window covers the reported totality for the whole Moon, 06:26 to 07:31 UTC |
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
src/eclipse.js    when Earth covers the Sun at a site, fully or partly
src/slips.js      the same 72 h analysis for every slip from 0 to 30 days, and the ranking
src/slipstrip.js  the slip strip view
src/unseen.css    the look: loads after styles.css and restyles it
src/chrome.js     header, menu, cursor ring, the opening, and the switch between home and the navigator
src/fonts/        Inter and Newsreader (SIL OFL 1.1), licences included
src/format.js     all display rounding (after calculation)
src/timeline.js   availability bars + shared cursor
src/skystrip.js   2D horizon strip (SVG)
src/three/        globe, surface scene, procedural textures, coordinate helpers (lazy-loaded)
tests/            vitest: reference totals, events, countdowns, edge cases, table engine vs JPL
tools/            table builder and the script that fetched the 10 x 10 reference answers
docs/HANDOFF.md   the original build brief
```

## Verification

`npm test` runs 41 tests, and all pass. The first 16 cover the four presets. They reproduce the brief's full-precision totals for all four presets (Blue Ghost Sun 44.177521847 h; Athena Earth 66.497844255 → 17.750254565 h, a 48.747589690 h loss). They also cover every crossing (Blue Ghost sunset 20:10:39, Athena Earthset 18:29:52, Athena Earthrise 06:14:59), the 54 h 15 min → 53 h 15 min countdown, the zero-sample merge, and azimuth wrap across north.

The other 12 cover the any-site engine:

- **10 sites x 10 dates against direct JPL Horizons queries.** The bar was 0.5 degrees, set before the check ran. All 200 Sun and Earth directions agree within 0.006 degrees. The reference answers are saved in `tests/reference/p1_horizons.json`.
- **The four preset files.** The table reproduces all 584 Sun and Earth directions within 0.006 degrees, the same hour totals within 0.02 h, and the same crossings within 2 minutes.
- Stays outside 2024 to 2030 and bad coordinates are rejected. Far-side sites never see Earth.

The last 13 cover the eclipse flag and the slip strip. Both bars were set before the first run.

- **Eclipse of Mar 14, 2025 at the Blue Ghost site.** The bar was 2 minutes from an earlier pilot result, 06:18 to 08:34 UTC. The model gives 06:18:09 to 08:35:15 UTC, so both edges pass. The window covers the reported whole-Moon totality, 06:26 to 07:31 UTC. It is about twice as long, because one site stays in Earth's shadow longer than the whole Moon stays fully covered.
- Sunlit hours drop by the eclipse length and nothing else changes. The four preset stays show no eclipse and keep their numbers. A far-side site is not flagged.
- **Slip strip.** The bar was 0.2 h. The cells for slip 0 and slip 9 match the four preset files at Athena and Blue Ghost. The strip stops at the end of the table.

Browser checks done during the build:

- Blue Ghost original → delayed at hour 0: the countdown clears and the Sun reads −71.1°, on scale.
- Athena delayed at hour 0 reads 54 h 15 min. One arrow-key step reads 53 h 15 min. After Earthrise it shows "No further crossing".
- Layout checked at desktop width and at a 390 px phone width.
- More sites, custom coordinates, the date field, the slip slider and shared links were each checked in the dev server, at desktop width and at 390 px. The production build was checked once, at desktop width, with a shared link to a far-side site.

Not yet done:

- The five-person usability test.
- Lander-tilt validation, which is out of scope.
- Partial cover of the Sun is marked but still counted as full sunlight.
- The slip strip and eclipse flag were checked in the production build at desktop width and at 375 px. They have not been checked on a real phone.
- Real terrain. Near the poles a ridge can hide the Sun or Earth while this model shows it up.

## Design

The look follows [unseen.co](https://unseen.co): a one-screen home over a live 3D scene, a transparent header with rolling nav letters, white pills and discs, a menu panel from the right, a cursor ring, and a dark long-scroll page for the tool. Layout, type scale and motion were matched to measurements of that site. All code here is original, and none of unseen's code, fonts, images or copy is used. Inter and Newsreader stand in for its two typefaces. The two small icons (arrow and close) are from Phosphor Icons (MIT).

The home screen is the same globe as the navigator, zoomed until the Moon is a horizon. The day and night line on it comes from the JPL Sun direction for the plan on screen.

Not done in this pass: sound, a film grain pass, and a real lunar surface map on the globe (it is still the procedural texture). The look was checked in Chrome at 1440, 1920, 1024 and 390 wide, with reduced motion, and with a shared link. It has not been checked in Safari or Firefox, or on a real phone.

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
