# Long Shadow website build handoff

Build and verify **Long Shadow**, our NASA Space Apps Challenge entry for [Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/). The website should let a first-time user answer one question quickly: **What changes in the first 72 hours on the Moon if touchdown slips nine days?** Build the actual app in the project workspace, run it, and verify the interactions against the acceptance checks below. If an app already exists, inspect it and reuse pieces that serve the new design. If the workspace has no frontend, use a small static frontend that the team can run and deploy easily. A production build should work with bundled data and without an API key or live Horizons requests.

## Start here

This is the single-file edition. Restore each file in the embedded appendices at the path in its heading. Copy the content inside each code fence into that file. Use the restored CSVs as the source of truth. Each file has 73 rows plus its header. The expected results below are for verification. The prototype review findings are described in the brief.

### Ship in this order

1. Build the data adapter and calculation logic. Wire up two site presets, the original and delayed scenarios, timelines, and a scrubber. Verify these against the numbers below.
2. Finish one polished, responsive comparison screen, the Blue Ghost replay, and a short methods and sources section. Deploy a public static build early so teammates can test it.
3. Make 3D an optional view if the 2D app and submission are ready. Keep the preset build deployable throughout. The larger calendar, CSV and brief exports, separate Planner/Classroom/Explore modes, terrain modeling, eclipse forecasting, and lander tilt are deferred. Leave go/no-go verdicts out of the demo.

## User experience and visual direction

- **Open on Athena** so both metrics change when the schedule slips. Lead with the nine-day question and show the answer above the fold. Put the site picker, original touchdown (**March 15, 2025 at 00:00 UTC**), and delayed touchdown (**March 24, 2025 at 00:00 UTC**) in the same workflow. A clear **Apply +9 days** action can reveal or focus the delayed comparison. Label both touchdown dates visibly. A single centered interaction should anchor the 30-second demo.
- **Show three metrics** for original and delayed scenarios: hours with Sun above horizon, Earth above horizon, and both above horizon. Show the change once, with clear language like “48.7 fewer hours of Earth visibility.” Athena’s explanation is **“After the delay, Earth is above the horizon for 17.8 hours, all during modeled darkness.”** The earlier scenario offers 66.5 hours with both above the horizon. Use “smooth-horizon estimate” beside the results.
- **Make mission time easy to read.** Give each scenario two separate above-horizon bars for Sun and Earth, aligned on the same elapsed **0–72 h** axis. Mark estimated crossing positions and make the UTC event time available in text. An overlap bar is optional. Use clear row labels plus patterns or icons as appropriate. The chart should remain legible on a narrow phone screen without requiring color recognition or hovering.
- **Sync the sky view and countdowns.** The scrubber should select elapsed time, with the active scenario and its UTC instant visible. Plot Sun and Earth on a 2D horizon strip using azimuth horizontally and elevation vertically. Support keyboard operation, show a visible focus indicator, and provide text equivalents for the chart and status. Changing the site, scenario, or time must update all dependent views. A shared elapsed-time cursor across both timelines is useful for comparing the same point in the two stays.
- **Give Blue Ghost a real replay interaction.** A button should select Blue Ghost original and jump to, or step through, the estimated sunset. Label **~20:11 UTC on March 16, 2025** as the model’s crossing. Beside it, show that Firefly reported sunset imagery that day and operations for just over five hours into lunar night. Use Firefly’s reported observation and operations duration with clear attribution. Any precise observed sunset time needs its own source. [Firefly mission updates](https://investors.fireflyspace.com/news-releases/news-release-details/blue-ghost-mission-1-live-updates)
- **Use a cohesive, restrained visual style.** Aim for an editorial science instrument with one dominant comparison visualization, a strong headline, precise axis labels, generous spacing, and a limited gold-for-Sun and blue-for-Earth palette. Use clean sans-serif text and tabular numerals for times and measurements. Avoid stacked rounded cards for every fragment, repeated metrics, excessive gradients, and decorative labels. On mobile, place the comparison before detailed plots and keep the date and units readable. If time allows, add one purposeful lunar visual for the replay, using a credited asset or an original treatment. The visuals should help explain the event.

The existing prototype calculated the totals correctly. Review found two interaction/visual errors worth checking in the rebuild. Switching original/delayed or moving the slider refreshed the sky and left the countdown stale. Delayed Blue Ghost’s Sun read **−71.1°** while its marker was clipped to **−45°**. Fit the actual angle range or clearly indicate an off-scale marker. Athena’s elevation lines also blended together near 0° on mobile, and the delayed graph lacked a visible 0° reference. Availability bars address most of this. If elevation plots are included for both scenarios, show the horizon reference on both.

## Data and exact scope

These are **hypothetical touchdowns at real landing sites**. Each file has **73 hourly samples and 72 intervals**. Both endpoints are present. Ship these four supported scenarios first. The date control should expose only supported presets. To support a continuous date slider or custom coordinates, generate valid geometry for the entire following 72-hour window. Four isolated files cover these four scenarios. An optional comparison mode can choose independently among the scenarios that already exist.

| Site and coordinates | Scenario | Start UTC | End UTC | CSV |
| --- | --- | --- | --- | --- |
| Blue Ghost · 18.562° N, 61.810° E | Original | Mar 15, 2025 00:00 | Mar 18, 2025 00:00 | `data/blue-ghost-original.csv` |
| Blue Ghost · 18.562° N, 61.810° E | Delayed | Mar 24, 2025 00:00 | Mar 27, 2025 00:00 | `data/blue-ghost-delayed.csv` |
| Athena · 84.7906° S, 29.1957° E | Original | Mar 15, 2025 00:00 | Mar 18, 2025 00:00 | `data/athena-original.csv` |
| Athena · 84.7906° S, 29.1957° E | Delayed | Mar 24, 2025 00:00 | Mar 27, 2025 00:00 | `data/athena-delayed.csv` |

CSV fields are `timeUtc`, `sunElevationDeg`, `earthElevationDeg`, `sunAzimuthDeg`, `earthAzimuthDeg`, `latitudeDeg`, and `longitudeEastDeg`. Parse timestamps as UTC and angles as numbers. Validate that timestamps increase, the grid spans 72 hours, and values are finite. Parse the saved CSV encoding normally and format coordinates for display at their cited precision. Alternatively, convert these CSVs into bundled JSON at build time and keep the CSVs in the repo for reproducibility.

JPL settings used by the collector are observer tables, surface observer `coord@301`, geodetic site coordinates in **east longitude, latitude, altitude km** order, zero altitude in the reference model, Sun center target `10`, Earth center target `399`, apparent airless elevation and azimuth (`QUANTITIES=4`), hourly time step, and UTC dates. Elevation is measured relative to the smooth reference horizon. Azimuth runs clockwise from north. The collector joins Sun and Earth rows by checked timestamps. [JPL Horizons API](https://ssd-api.jpl.nasa.gov/doc/horizons.html) · [JPL Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html) · [NASA landing site coordinates](https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html)

To regenerate a preset from the project folder in PowerShell, use the name, coordinates, and start time from the table. For example:

```powershell
.\Get-LunarHorizons.ps1 -Name athena-delayed -Latitude -84.7906 -Longitude 29.1957 -StartUtc '2025-03-24 00:00'
```

Use a new name for a new scenario. Use `-StepMinutes 5` and a separate name to check a crossing at finer resolution.

Put this next to the numbers and explain it in Methods: **“Smooth-horizon estimate. Local terrain, eclipses, and lander hardware are outside this model.”** Earth above the horizon indicates a geometric opportunity for direct radio. Sun above the horizon indicates a geometric opportunity for solar power. On polar terrain, local ridges can materially change both windows. [NASA south-pole shadows](https://science.nasa.gov/resource/shadows-near-the-moons-south-pole/)

## Calculation contract

1. **Classify each elevation.** An object’s center is above the modeled horizon when `elevation > 0`. Process Sun and Earth independently in timestamp order.
2. **Interpolate crossings.** When adjacent samples change above-horizon status, compute `f = e0 / (e0 - e1)` and `tCross = t0 + f * (t1 - t0)`. Positive to nonpositive is a setting event. The reverse is a rising event. Use actual timestamps in milliseconds and keep precision through the calculations. Treat a zero sample as on the horizon. Merge touching visibility intervals so an exact zero sample does not create spurious duration gaps.
3. **Build the above-horizon intervals.** If both samples are positive, include the whole interval. If both are nonpositive, include none. For a setting include `[t0, tCross]`, and for a rising include `[tCross, t1]`. Sum interval lengths in hours. Drive the bars and totals from these same intervals. For full-window cases show “Above for all 72 h” or “Below for all 72 h.”
4. **Calculate overlap.** Intersect Sun and Earth intervals. Each pair contributes `max(0, min(sunEnd, earthEnd) - max(sunStart, earthStart))`. Sum the intersections in hours. Blue Ghost’s overlap matches its Sun hours. Athena’s delayed overlap is zero even though Earth rises late in the window.
5. **Calculate delay impact.** For each metric use `delayedHours - originalHours`. Round to one decimal for display after subtracting. Format whole hours and optionally phrase losses as “X fewer hours.”
6. **Calculate live countdowns.** For the next crossing in the active scenario, use `crossingTime - selectedTime`. At the start, selected time equals touchdown. On scrub, recompute from the selected UTC instant. After the last event, show the current horizon status and “No further crossing in this window.” Round displayed UTC events and durations to the nearest minute. A touchdown countdown is elapsed time to the event. Athena delayed Earthrise takes ~54 h 15 min to occur and leaves ~17 h 45 min of visibility.
7. **Render the selected sky.** The existing interface uses hourly samples. If replay jumps to a sub-hour instant, interpolate elevation between its neighboring rows. Interpolate azimuth across north using the shorter angular path, so 359° to 1° passes through 0°. Keep the plot and numeric status consistent. Ensure it can represent the approximately −71.3° minimum sampled Sun elevation in the delayed Blue Ghost window or explicitly show an off-scale marker.

### Expected totals and differences

Values below are in hours. Derive totals from the CSVs. Use the full-precision values for calculation checks and the rounded values in the user interface.

| Metric | Blue Ghost original | Blue Ghost delayed | Blue Ghost change | Athena original | Athena delayed | Athena change |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Sun above horizon | 44.177521847 | 0 | −44.177521847 | 72 | 0 | −72 |
| Earth above horizon | 72 | 72 | 0 | 66.497844255 | 17.750254565 | −48.747589690 |
| Both above horizon | 44.177521847 | 0 | −44.177521847 | 66.497844255 | 0 | −66.497844255 |

Rounded comparison values are Blue Ghost Sun **44.2 → 0 h**, Blue Ghost Earth **72 → 72 h**, Athena Sun **72 → 0 h**, Athena Earth **66.5 → 17.8 h** with a **48.7 h loss**, and Athena overlap **66.5 → 0 h**.

### Expected events and timeline directions

| Scenario | Sun | Earth | Countdown at touchdown |
| --- | --- | --- | --- |
| Blue Ghost original | Above until sunset around Mar 16 **20:11 UTC** (interpolated 20:10:39) | Above all 72 h | Sunset **44 h 11 min** |
| Blue Ghost delayed | Below all 72 h | Above all 72 h | No crossings |
| Athena original | Above all 72 h | Above until Earthset around Mar 17 **18:30 UTC** (interpolated 18:29:52) | Earthset **66 h 30 min** |
| Athena delayed | Below all 72 h | Below until Earthrise around Mar 26 **06:15 UTC** (interpolated 06:14:59), then above | Earthrise **54 h 15 min** |

A separate five-minute JPL query brackets Blue Ghost’s original sunset on March 16 between 20:10 UTC (+0.005209°) and 20:15 UTC (−0.034776°). The broader plan target of 10 sites and 10 dates within 0.5° of direct JPL angle queries is still unverified. Report only the checks completed. The original eclipse comparison used incompatible landing-site and whole-Moon events, and the tipped-SLIM pilot test failed. Leave those out of the build’s validation claims.

## Acceptance checks before handing the build back

- All four presets show the reference totals and crossings above. Verify numeric calculations before UI formatting. Test wholly above, wholly below, rising, setting, and overlap cases.
- Switch Blue Ghost from original to delayed at hour 0. The sunset countdown clears, and the sky readout shows the Sun near −71.1°.
- At Athena delayed hour 0, Earthrise is **54 h 15 min** away. Advance the slider by one hour and it becomes **53 h 15 min**. After Earthrise, show Earth above the horizon and no further crossing. Check keyboard scrubbing and switching back to Blue Ghost.
- Check desktop and a roughly 390 px phone viewport. The dates, visibility bars, metric values, and event labels stay legible. Check focus, contrast, and that no essential information depends on color alone.
- Verify the public link works signed out and the core demo runs with the preset data bundled. Supply run/build steps, the deployed URL if available, and a short account of tests run and any issues still open.

## Team delivery and submission

- **App** owns integration, browser/mobile QA, and the public deployment. **Data** owns the CSVs and provenance. **Science** checks the deployed values, assumptions, and replay language. **Story** recruits testers, runs the session, produces the video, and fills the project page with the team owner.
- **Five-person usability test.** Ask first-time adult users when the Sun sets at Blue Ghost in the original scenario. The target is at least four correct and a median time of 60 seconds or less. Then ask which Athena landing time gets more daylight in the first 72 hours and by how much. Record answers, time, and friction without names or faces. Fix the biggest repeated blocker and report actual results. This is still pending.
- **30-second demo.** Open with Blue Ghost’s replay, show Athena’s nine-day date shift and the change in the visibility bars, then show the JPL source and a measured test result if available. Use English captions and keep the recording to the app screen. Verify the current guide’s demo and publicity requirements.
- **Submission.** Team target is **Sunday, November 15 at noon PT**. The global cutoff is **11:59 p.m. local time** that day. The owner checks for an earlier local judging deadline, confirms all four members are registered and listed, and fills the summary, project description, NASA data usage, references and licenses as applicable, and AI disclosure. Confirm that the app, demo, and repo links open in a private window before using **Submit for Judging** and verifying the status. The team should make the design choices and accurately disclose AI assistance, including planning, implementation, and any generated assets that were used. [Official 2026 timeline](https://www.spaceappschallenge.org/2026/) · [Submission resources](https://www.spaceappschallenge.org/resources/)

## Embedded project files

### data/blue-ghost-original.csv

```csv
"timeUtc","sunElevationDeg","earthElevationDeg","sunAzimuthDeg","earthAzimuthDeg","latitudeDeg","longitudeEastDeg"
"2025-03-15T00:00:00Z","21.132895","28.484953","262.467058","260.162537","18.562","61.81"
"2025-03-15T01:00:00Z","20.657344","28.458457","262.653195","260.246667","18.562","61.81"
"2025-03-15T02:00:00Z","20.18159","28.431701","262.838165","260.330754","18.562","61.81"
"2025-03-15T03:00:00Z","19.705639","28.404689","263.022004","260.414792","18.562","61.81"
"2025-03-15T04:00:00Z","19.229498","28.377419","263.204746","260.498774","18.562","61.81"
"2025-03-15T05:00:00Z","18.753171","28.349895","263.386427","260.582695","18.562","61.81"
"2025-03-15T06:00:00Z","18.276665","28.322117","263.56708","260.666548","18.562","61.81"
"2025-03-15T07:00:00Z","17.799985","28.294086","263.746737","260.750328","18.562","61.81"
"2025-03-15T08:00:00Z","17.323138","28.265805","263.925433","260.834028","18.562","61.81"
"2025-03-15T09:00:00Z","16.846128","28.237274","264.103198","260.917643","18.562","61.81"
"2025-03-15T10:00:00Z","16.368961","28.208496","264.280064","261.001167","18.562","61.81"
"2025-03-15T11:00:00Z","15.891642","28.179472","264.456063","261.084593","18.562","61.81"
"2025-03-15T12:00:00Z","15.414176","28.150203","264.631223","261.167915","18.562","61.81"
"2025-03-15T13:00:00Z","14.936569","28.120691","264.805577","261.251129","18.562","61.81"
"2025-03-15T14:00:00Z","14.458825","28.090937","264.979152","261.334228","18.562","61.81"
"2025-03-15T15:00:00Z","13.980949","28.060944","265.151978","261.417206","18.562","61.81"
"2025-03-15T16:00:00Z","13.502946","28.030714","265.324084","261.500057","18.562","61.81"
"2025-03-15T17:00:00Z","13.024821","28.000247","265.495498","261.582776","18.562","61.81"
"2025-03-15T18:00:00Z","12.546579","27.969546","265.666247","261.665357","18.562","61.81"
"2025-03-15T19:00:00Z","12.068223","27.938612","265.836359","261.747794","18.562","61.81"
"2025-03-15T20:00:00Z","11.58976","27.907448","266.005862","261.830082","18.562","61.81"
"2025-03-15T21:00:00Z","11.111192","27.876055","266.174781","261.912215","18.562","61.81"
"2025-03-15T22:00:00Z","10.632526","27.844435","266.343144","261.994187","18.562","61.81"
"2025-03-15T23:00:00Z","10.153764","27.812591","266.510975","262.075993","18.562","61.81"
"2025-03-16T00:00:00Z","9.674912","27.780524","266.678302","262.157627","18.562","61.81"
"2025-03-16T01:00:00Z","9.195974","27.748236","266.84515","262.239083","18.562","61.81"
"2025-03-16T02:00:00Z","8.716953","27.71573","267.011544","262.320357","18.562","61.81"
"2025-03-16T03:00:00Z","8.237855","27.683007","267.177509","262.401443","18.562","61.81"
"2025-03-16T04:00:00Z","7.758683","27.65007","267.343069","262.482334","18.562","61.81"
"2025-03-16T05:00:00Z","7.279441","27.616921","267.50825","262.563027","18.562","61.81"
"2025-03-16T06:00:00Z","6.800134","27.583561","267.673076","262.643515","18.562","61.81"
"2025-03-16T07:00:00Z","6.320766","27.549994","267.837571","262.723793","18.562","61.81"
"2025-03-16T08:00:00Z","5.84134","27.516221","268.001759","262.803856","18.562","61.81"
"2025-03-16T09:00:00Z","5.36186","27.482245","268.165664","262.883698","18.562","61.81"
"2025-03-16T10:00:00Z","4.882331","27.448069","268.329309","262.963315","18.562","61.81"
"2025-03-16T11:00:00Z","4.402757","27.413694","268.492718","263.0427","18.562","61.81"
"2025-03-16T12:00:00Z","3.923141","27.379122","268.655915","263.12185","18.562","61.81"
"2025-03-16T13:00:00Z","3.443487","27.344357","268.818923","263.200758","18.562","61.81"
"2025-03-16T14:00:00Z","2.963799","27.309401","268.981765","263.279419","18.562","61.81"
"2025-03-16T15:00:00Z","2.484082","27.274257","269.144464","263.357829","18.562","61.81"
"2025-03-16T16:00:00Z","2.004338","27.238926","269.307043","263.435982","18.562","61.81"
"2025-03-16T17:00:00Z","1.524572","27.203411","269.469526","263.513873","18.562","61.81"
"2025-03-16T18:00:00Z","1.044787","27.167715","269.631935","263.591498","18.562","61.81"
"2025-03-16T19:00:00Z","0.564988","27.131841","269.794293","263.668851","18.562","61.81"
"2025-03-16T20:00:00Z","0.085178","27.095791","269.956623","263.745927","18.562","61.81"
"2025-03-16T21:00:00Z","-0.394639","27.059568","270.118947","263.822721","18.562","61.81"
"2025-03-16T22:00:00Z","-0.87446","27.023175","270.28129","263.899228","18.562","61.81"
"2025-03-16T23:00:00Z","-1.354279","26.986614","270.443673","263.975445","18.562","61.81"
"2025-03-17T00:00:00Z","-1.834095","26.949888","270.60612","264.051365","18.562","61.81"
"2025-03-17T01:00:00Z","-2.313902","26.913","270.768654","264.126983","18.562","61.81"
"2025-03-17T02:00:00Z","-2.793697","26.875953","270.931297","264.202296","18.562","61.81"
"2025-03-17T03:00:00Z","-3.273476","26.838749","271.094072","264.277298","18.562","61.81"
"2025-03-17T04:00:00Z","-3.753235","26.801391","271.257003","264.351985","18.562","61.81"
"2025-03-17T05:00:00Z","-4.23297","26.763883","271.420113","264.426352","18.562","61.81"
"2025-03-17T06:00:00Z","-4.712678","26.726228","271.583425","264.500394","18.562","61.81"
"2025-03-17T07:00:00Z","-5.192355","26.688427","271.746962","264.574106","18.562","61.81"
"2025-03-17T08:00:00Z","-5.671996","26.650485","271.910749","264.647485","18.562","61.81"
"2025-03-17T09:00:00Z","-6.151597","26.612404","272.074808","264.720525","18.562","61.81"
"2025-03-17T10:00:00Z","-6.631156","26.574187","272.239164","264.793221","18.562","61.81"
"2025-03-17T11:00:00Z","-7.110666","26.535837","272.403841","264.86557","18.562","61.81"
"2025-03-17T12:00:00Z","-7.590126","26.497358","272.568862","264.937567","18.562","61.81"
"2025-03-17T13:00:00Z","-8.06953","26.458752","272.734252","265.009207","18.562","61.81"
"2025-03-17T14:00:00Z","-8.548874","26.420024","272.900036","265.080486","18.562","61.81"
"2025-03-17T15:00:00Z","-9.028155","26.381175","273.066238","265.151399","18.562","61.81"
"2025-03-17T16:00:00Z","-9.507367","26.342209","273.232883","265.221943","18.562","61.81"
"2025-03-17T17:00:00Z","-9.986508","26.303129","273.399997","265.292112","18.562","61.81"
"2025-03-17T18:00:00Z","-10.465572","26.263939","273.567605","265.361903","18.562","61.81"
"2025-03-17T19:00:00Z","-10.944555","26.224642","273.735732","265.43131","18.562","61.81"
"2025-03-17T20:00:00Z","-11.423453","26.185241","273.904406","265.50033","18.562","61.81"
"2025-03-17T21:00:00Z","-11.902261","26.145739","274.073651","265.568959","18.562","61.81"
"2025-03-17T22:00:00Z","-12.380975","26.10614","274.243495","265.637192","18.562","61.81"
"2025-03-17T23:00:00Z","-12.859591","26.066447","274.413965","265.705025","18.562","61.81"
"2025-03-18T00:00:00Z","-13.338103","26.026664","274.585089","265.772454","18.562","61.81"
```

### data/blue-ghost-delayed.csv

```csv
"timeUtc","sunElevationDeg","earthElevationDeg","sunAzimuthDeg","earthAzimuthDeg","latitudeDeg","longitudeEastDeg"
"2025-03-24T00:00:00Z","-71.070059","21.33165","351.20255","269.474799","18.562","61.81"
"2025-03-24T01:00:00Z","-71.136298","21.320287","352.758358","269.448322","18.562","61.81"
"2025-03-24T02:00:00Z","-71.189517","21.309391","354.323728","269.421016","18.562","61.81"
"2025-03-24T03:00:00Z","-71.229603","21.298966","355.896638","269.392878","18.562","61.81"
"2025-03-24T04:00:00Z","-71.256472","21.289012","357.475003","269.36391","18.562","61.81"
"2025-03-24T05:00:00Z","-71.270065","21.279533","359.056693","269.334108","18.562","61.81"
"2025-03-24T06:00:00Z","-71.270351","21.27053","0.63955","269.303474","18.562","61.81"
"2025-03-24T07:00:00Z","-71.257331","21.262007","2.221404","269.272005","18.562","61.81"
"2025-03-24T08:00:00Z","-71.23103","21.253966","3.800096","269.239701","18.562","61.81"
"2025-03-24T09:00:00Z","-71.191503","21.246409","5.373492","269.206562","18.562","61.81"
"2025-03-24T10:00:00Z","-71.138833","21.239337","6.939503","269.172587","18.562","61.81"
"2025-03-24T11:00:00Z","-71.073128","21.232754","8.496103","269.137776","18.562","61.81"
"2025-03-24T12:00:00Z","-70.994522","21.226662","10.041339","269.102127","18.562","61.81"
"2025-03-24T13:00:00Z","-70.903175","21.221061","11.573354","269.065642","18.562","61.81"
"2025-03-24T14:00:00Z","-70.799267","21.215955","13.090388","269.028318","18.562","61.81"
"2025-03-24T15:00:00Z","-70.683","21.211345","14.5908","268.990158","18.562","61.81"
"2025-03-24T16:00:00Z","-70.554596","21.207234","16.073067","268.951159","18.562","61.81"
"2025-03-24T17:00:00Z","-70.414292","21.203622","17.535796","268.911323","18.562","61.81"
"2025-03-24T18:00:00Z","-70.262342","21.200512","18.977725","268.870648","18.562","61.81"
"2025-03-24T19:00:00Z","-70.099011","21.197905","20.397727","268.829136","18.562","61.81"
"2025-03-24T20:00:00Z","-69.924577","21.195803","21.794809","268.786787","18.562","61.81"
"2025-03-24T21:00:00Z","-69.739327","21.194208","23.168113","268.743601","18.562","61.81"
"2025-03-24T22:00:00Z","-69.543553","21.193121","24.516912","268.699578","18.562","61.81"
"2025-03-24T23:00:00Z","-69.337554","21.192543","25.840604","268.654718","18.562","61.81"
"2025-03-25T00:00:00Z","-69.121633","21.192476","27.138709","268.609023","18.562","61.81"
"2025-03-25T01:00:00Z","-68.896094","21.192922","28.410865","268.562493","18.562","61.81"
"2025-03-25T02:00:00Z","-68.661241","21.19388","29.656816","268.515129","18.562","61.81"
"2025-03-25T03:00:00Z","-68.417378","21.195354","30.876409","268.466931","18.562","61.81"
"2025-03-25T04:00:00Z","-68.164808","21.197343","32.069583","268.417901","18.562","61.81"
"2025-03-25T05:00:00Z","-67.903827","21.199848","33.236366","268.368039","18.562","61.81"
"2025-03-25T06:00:00Z","-67.634731","21.202871","34.376862","268.317347","18.562","61.81"
"2025-03-25T07:00:00Z","-67.357808","21.206413","35.491247","268.265826","18.562","61.81"
"2025-03-25T08:00:00Z","-67.073342","21.210475","36.57976","268.213478","18.562","61.81"
"2025-03-25T09:00:00Z","-66.781611","21.215056","37.642695","268.160303","18.562","61.81"
"2025-03-25T10:00:00Z","-66.482884","21.220158","38.680396","268.106303","18.562","61.81"
"2025-03-25T11:00:00Z","-66.177425","21.225782","39.693249","268.05148","18.562","61.81"
"2025-03-25T12:00:00Z","-65.865489","21.231928","40.681677","267.995836","18.562","61.81"
"2025-03-25T13:00:00Z","-65.547324","21.238596","41.646133","267.939373","18.562","61.81"
"2025-03-25T14:00:00Z","-65.223171","21.245788","42.587094","267.882092","18.562","61.81"
"2025-03-25T15:00:00Z","-64.893261","21.253502","43.505062","267.823995","18.562","61.81"
"2025-03-25T16:00:00Z","-64.557817","21.26174","44.40055","267.765086","18.562","61.81"
"2025-03-25T17:00:00Z","-64.217058","21.270502","45.274086","267.705366","18.562","61.81"
"2025-03-25T18:00:00Z","-63.87119","21.279787","46.126207","267.644838","18.562","61.81"
"2025-03-25T19:00:00Z","-63.520413","21.289596","46.957453","267.583503","18.562","61.81"
"2025-03-25T20:00:00Z","-63.164922","21.299929","47.768371","267.521366","18.562","61.81"
"2025-03-25T21:00:00Z","-62.8049","21.310785","48.559503","267.458429","18.562","61.81"
"2025-03-25T22:00:00Z","-62.440526","21.322164","49.331393","267.394694","18.562","61.81"
"2025-03-25T23:00:00Z","-62.071969","21.334067","50.084579","267.330165","18.562","61.81"
"2025-03-26T00:00:00Z","-61.699395","21.346492","50.819594","267.264844","18.562","61.81"
"2025-03-26T01:00:00Z","-61.32296","21.35944","51.536964","267.198736","18.562","61.81"
"2025-03-26T02:00:00Z","-60.942814","21.372909","52.237206","267.131844","18.562","61.81"
"2025-03-26T03:00:00Z","-60.559101","21.386899","52.920831","267.06417","18.562","61.81"
"2025-03-26T04:00:00Z","-60.171959","21.401409","53.588336","266.99572","18.562","61.81"
"2025-03-26T05:00:00Z","-59.781522","21.416439","54.240209","266.926496","18.562","61.81"
"2025-03-26T06:00:00Z","-59.387914","21.431987","54.876929","266.856503","18.562","61.81"
"2025-03-26T07:00:00Z","-58.991258","21.448054","55.49896","266.785745","18.562","61.81"
"2025-03-26T08:00:00Z","-58.591669","21.464637","56.106756","266.714226","18.562","61.81"
"2025-03-26T09:00:00Z","-58.189259","21.481735","56.700759","266.64195","18.562","61.81"
"2025-03-26T10:00:00Z","-57.784133","21.499348","57.281398","266.568922","18.562","61.81"
"2025-03-26T11:00:00Z","-57.376394","21.517474","57.849091","266.495147","18.562","61.81"
"2025-03-26T12:00:00Z","-56.966138","21.536111","58.404244","266.420628","18.562","61.81"
"2025-03-26T13:00:00Z","-56.55346","21.555259","58.947249","266.345372","18.562","61.81"
"2025-03-26T14:00:00Z","-56.138448","21.574916","59.478487","266.269384","18.562","61.81"
"2025-03-26T15:00:00Z","-55.721187","21.595079","59.998329","266.192667","18.562","61.81"
"2025-03-26T16:00:00Z","-55.301759","21.615748","60.507132","266.115229","18.562","61.81"
"2025-03-26T17:00:00Z","-54.880243","21.636921","61.005242","266.037074","18.562","61.81"
"2025-03-26T18:00:00Z","-54.456714","21.658595","61.492995","265.958208","18.562","61.81"
"2025-03-26T19:00:00Z","-54.031243","21.680768","61.970715","265.878636","18.562","61.81"
"2025-03-26T20:00:00Z","-53.6039","21.70344","62.438715","265.798365","18.562","61.81"
"2025-03-26T21:00:00Z","-53.174749","21.726607","62.897299","265.717401","18.562","61.81"
"2025-03-26T22:00:00Z","-52.743855","21.750267","63.34676","265.63575","18.562","61.81"
"2025-03-26T23:00:00Z","-52.311278","21.774418","63.787382","265.553418","18.562","61.81"
"2025-03-27T00:00:00Z","-51.877076","21.799057","64.219437","265.470412","18.562","61.81"
```

### data/athena-original.csv

```csv
"timeUtc","sunElevationDeg","earthElevationDeg","sunAzimuthDeg","earthAzimuthDeg","latitudeDeg","longitudeEastDeg"
"2025-03-15T00:00:00Z","4.329865","3.766924","324.877164","332.742795","-84.7906","29.195699999999988"
"2025-03-15T01:00:00Z","4.302035","3.70538","324.370146","332.694131","-84.7906","29.195699999999988"
"2025-03-15T02:00:00Z","4.273877","3.643898","323.863161","332.645279","-84.7906","29.195699999999988"
"2025-03-15T03:00:00Z","4.245391","3.582484","323.356211","332.596241","-84.7906","29.195699999999988"
"2025-03-15T04:00:00Z","4.21658","3.521141","322.849295","332.547019","-84.7906","29.195699999999988"
"2025-03-15T05:00:00Z","4.187446","3.459873","322.342414","332.497617","-84.7906","29.195699999999988"
"2025-03-15T06:00:00Z","4.157992","3.398685","321.835568","332.448036","-84.7906","29.195699999999988"
"2025-03-15T07:00:00Z","4.128219","3.337581","321.328756","332.398281","-84.7906","29.195699999999988"
"2025-03-15T08:00:00Z","4.098131","3.276565","320.82198","332.348352","-84.7906","29.195699999999988"
"2025-03-15T09:00:00Z","4.067728","3.215641","320.315238","332.298254","-84.7906","29.195699999999988"
"2025-03-15T10:00:00Z","4.037014","3.154814","319.80853","332.247989","-84.7906","29.195699999999988"
"2025-03-15T11:00:00Z","4.005991","3.094088","319.301858","332.197559","-84.7906","29.195699999999988"
"2025-03-15T12:00:00Z","3.974661","3.033467","318.795221","332.146967","-84.7906","29.195699999999988"
"2025-03-15T13:00:00Z","3.943027","2.972954","318.288618","332.096217","-84.7906","29.195699999999988"
"2025-03-15T14:00:00Z","3.911091","2.912555","317.782051","332.04531","-84.7906","29.195699999999988"
"2025-03-15T15:00:00Z","3.878855","2.852273","317.275518","331.994249","-84.7906","29.195699999999988"
"2025-03-15T16:00:00Z","3.846322","2.792113","316.76902","331.943038","-84.7906","29.195699999999988"
"2025-03-15T17:00:00Z","3.813494","2.732078","316.262557","331.89168","-84.7906","29.195699999999988"
"2025-03-15T18:00:00Z","3.780374","2.672172","315.756128","331.840176","-84.7906","29.195699999999988"
"2025-03-15T19:00:00Z","3.746965","2.6124","315.249734","331.78853","-84.7906","29.195699999999988"
"2025-03-15T20:00:00Z","3.713269","2.552766","314.743375","331.736745","-84.7906","29.195699999999988"
"2025-03-15T21:00:00Z","3.679288","2.493273","314.23705","331.684823","-84.7906","29.195699999999988"
"2025-03-15T22:00:00Z","3.645025","2.433926","313.730759","331.632768","-84.7906","29.195699999999988"
"2025-03-15T23:00:00Z","3.610482","2.374729","313.224503","331.580582","-84.7906","29.195699999999988"
"2025-03-16T00:00:00Z","3.575663","2.315685","312.718281","331.528269","-84.7906","29.195699999999988"
"2025-03-16T01:00:00Z","3.54057","2.256798","312.212092","331.475831","-84.7906","29.195699999999988"
"2025-03-16T02:00:00Z","3.505206","2.198073","311.705938","331.423271","-84.7906","29.195699999999988"
"2025-03-16T03:00:00Z","3.469573","2.139513","311.199817","331.370592","-84.7906","29.195699999999988"
"2025-03-16T04:00:00Z","3.433673","2.081123","310.69373","331.317797","-84.7906","29.195699999999988"
"2025-03-16T05:00:00Z","3.397511","2.022905","310.187676","331.26489","-84.7906","29.195699999999988"
"2025-03-16T06:00:00Z","3.361088","1.964865","309.681654","331.211872","-84.7906","29.195699999999988"
"2025-03-16T07:00:00Z","3.324407","1.907005","309.175666","331.158748","-84.7906","29.195699999999988"
"2025-03-16T08:00:00Z","3.287471","1.84933","308.669711","331.10552","-84.7906","29.195699999999988"
"2025-03-16T09:00:00Z","3.250284","1.791843","308.163788","331.052191","-84.7906","29.195699999999988"
"2025-03-16T10:00:00Z","3.212846","1.734549","307.657897","330.998765","-84.7906","29.195699999999988"
"2025-03-16T11:00:00Z","3.175162","1.67745","307.152038","330.945244","-84.7906","29.195699999999988"
"2025-03-16T12:00:00Z","3.137235","1.620551","306.64621","330.891632","-84.7906","29.195699999999988"
"2025-03-16T13:00:00Z","3.099067","1.563856","306.140414","330.837931","-84.7906","29.195699999999988"
"2025-03-16T14:00:00Z","3.060661","1.507368","305.634649","330.784146","-84.7906","29.195699999999988"
"2025-03-16T15:00:00Z","3.02202","1.45109","305.128915","330.730278","-84.7906","29.195699999999988"
"2025-03-16T16:00:00Z","2.983146","1.395027","304.623212","330.676332","-84.7906","29.195699999999988"
"2025-03-16T17:00:00Z","2.944044","1.339183","304.117538","330.62231","-84.7906","29.195699999999988"
"2025-03-16T18:00:00Z","2.904716","1.28356","303.611895","330.568215","-84.7906","29.195699999999988"
"2025-03-16T19:00:00Z","2.865165","1.228163","303.106281","330.514052","-84.7906","29.195699999999988"
"2025-03-16T20:00:00Z","2.825393","1.172995","302.600696","330.459822","-84.7906","29.195699999999988"
"2025-03-16T21:00:00Z","2.785404","1.118059","302.09514","330.40553","-84.7906","29.195699999999988"
"2025-03-16T22:00:00Z","2.745201","1.06336","301.589612","330.351178","-84.7906","29.195699999999988"
"2025-03-16T23:00:00Z","2.704788","1.008901","301.084112","330.296771","-84.7906","29.195699999999988"
"2025-03-17T00:00:00Z","2.664166","0.954685","300.57864","330.24231","-84.7906","29.195699999999988"
"2025-03-17T01:00:00Z","2.623339","0.900716","300.073196","330.1878","-84.7906","29.195699999999988"
"2025-03-17T02:00:00Z","2.582311","0.846997","299.567778","330.133244","-84.7906","29.195699999999988"
"2025-03-17T03:00:00Z","2.541083","0.793533","299.062386","330.078646","-84.7906","29.195699999999988"
"2025-03-17T04:00:00Z","2.499661","0.740326","298.557021","330.024007","-84.7906","29.195699999999988"
"2025-03-17T05:00:00Z","2.458045","0.687379","298.051681","329.969333","-84.7906","29.195699999999988"
"2025-03-17T06:00:00Z","2.416241","0.634697","297.546366","329.914627","-84.7906","29.195699999999988"
"2025-03-17T07:00:00Z","2.37425","0.582283","297.041076","329.859891","-84.7906","29.195699999999988"
"2025-03-17T08:00:00Z","2.332077","0.53014","296.53581","329.80513","-84.7906","29.195699999999988"
"2025-03-17T09:00:00Z","2.289723","0.478272","296.030568","329.750347","-84.7906","29.195699999999988"
"2025-03-17T10:00:00Z","2.247193","0.426681","295.525349","329.695545","-84.7906","29.195699999999988"
"2025-03-17T11:00:00Z","2.20449","0.375372","295.020153","329.640727","-84.7906","29.195699999999988"
"2025-03-17T12:00:00Z","2.161617","0.324348","294.514979","329.585899","-84.7906","29.195699999999988"
"2025-03-17T13:00:00Z","2.118577","0.273611","294.009827","329.531062","-84.7906","29.195699999999988"
"2025-03-17T14:00:00Z","2.075373","0.223166","293.504696","329.47622","-84.7906","29.195699999999988"
"2025-03-17T15:00:00Z","2.032009","0.173015","292.999586","329.421378","-84.7906","29.195699999999988"
"2025-03-17T16:00:00Z","1.988488","0.123163","292.494496","329.366538","-84.7906","29.195699999999988"
"2025-03-17T17:00:00Z","1.944813","0.073611","291.989426","329.311704","-84.7906","29.195699999999988"
"2025-03-17T18:00:00Z","1.900987","0.024364","291.484374","329.25688","-84.7906","29.195699999999988"
"2025-03-17T19:00:00Z","1.857015","-0.024575","290.979342","329.20207","-84.7906","29.195699999999988"
"2025-03-17T20:00:00Z","1.812899","-0.073204","290.474327","329.147277","-84.7906","29.195699999999988"
"2025-03-17T21:00:00Z","1.768642","-0.121518","289.969329","329.092505","-84.7906","29.195699999999988"
"2025-03-17T22:00:00Z","1.724248","-0.169515","289.464349","329.037757","-84.7906","29.195699999999988"
"2025-03-17T23:00:00Z","1.67972","-0.217192","288.959384","328.983037","-84.7906","29.195699999999988"
"2025-03-18T00:00:00Z","1.635062","-0.264545","288.454435","328.92835","-84.7906","29.195699999999988"
```

### data/athena-delayed.csv

```csv
"timeUtc","sunElevationDeg","earthElevationDeg","sunAzimuthDeg","earthAzimuthDeg","latitudeDeg","longitudeEastDeg"
"2025-03-24T00:00:00Z","-4.402575","-2.329156","215.578961","323.533707","-84.7906","29.195699999999988"
"2025-03-24T01:00:00Z","-4.430238","-2.302697","215.070006","323.528998","-84.7906","29.195699999999988"
"2025-03-24T02:00:00Z","-4.457568","-2.275606","214.561002","323.524939","-84.7906","29.195699999999988"
"2025-03-24T03:00:00Z","-4.484561","-2.247881","214.051949","323.521533","-84.7906","29.195699999999988"
"2025-03-24T04:00:00Z","-4.511217","-2.219523","213.542849","323.518783","-84.7906","29.195699999999988"
"2025-03-24T05:00:00Z","-4.537532","-2.190533","213.033701","323.516692","-84.7906","29.195699999999988"
"2025-03-24T06:00:00Z","-4.563505","-2.160909","212.524505","323.515263","-84.7906","29.195699999999988"
"2025-03-24T07:00:00Z","-4.589135","-2.130653","212.015263","323.514499","-84.7906","29.195699999999988"
"2025-03-24T08:00:00Z","-4.614418","-2.099763","211.505973","323.514402","-84.7906","29.195699999999988"
"2025-03-24T09:00:00Z","-4.639353","-2.068242","210.996636","323.514976","-84.7906","29.195699999999988"
"2025-03-24T10:00:00Z","-4.663939","-2.036088","210.487254","323.516222","-84.7906","29.195699999999988"
"2025-03-24T11:00:00Z","-4.688173","-2.003303","209.977825","323.518143","-84.7906","29.195699999999988"
"2025-03-24T12:00:00Z","-4.712053","-1.969886","209.468351","323.520742","-84.7906","29.195699999999988"
"2025-03-24T13:00:00Z","-4.735577","-1.935839","208.958831","323.524022","-84.7906","29.195699999999988"
"2025-03-24T14:00:00Z","-4.758744","-1.901161","208.449267","323.527984","-84.7906","29.195699999999988"
"2025-03-24T15:00:00Z","-4.781552","-1.865855","207.939658","323.532631","-84.7906","29.195699999999988"
"2025-03-24T16:00:00Z","-4.804","-1.829919","207.430005","323.537965","-84.7906","29.195699999999988"
"2025-03-24T17:00:00Z","-4.826084","-1.793356","206.920308","323.543989","-84.7906","29.195699999999988"
"2025-03-24T18:00:00Z","-4.847805","-1.756166","206.410568","323.550704","-84.7906","29.195699999999988"
"2025-03-24T19:00:00Z","-4.869159","-1.71835","205.900785","323.558113","-84.7906","29.195699999999988"
"2025-03-24T20:00:00Z","-4.890146","-1.679909","205.390959","323.566217","-84.7906","29.195699999999988"
"2025-03-24T21:00:00Z","-4.910764","-1.640845","204.881092","323.575019","-84.7906","29.195699999999988"
"2025-03-24T22:00:00Z","-4.931011","-1.601158","204.371183","323.58452","-84.7906","29.195699999999988"
"2025-03-24T23:00:00Z","-4.950885","-1.560851","203.861233","323.594721","-84.7906","29.195699999999988"
"2025-03-25T00:00:00Z","-4.970386","-1.519923","203.351242","323.605626","-84.7906","29.195699999999988"
"2025-03-25T01:00:00Z","-4.989512","-1.478378","202.841211","323.617234","-84.7906","29.195699999999988"
"2025-03-25T02:00:00Z","-5.00826","-1.436215","202.33114","323.629549","-84.7906","29.195699999999988"
"2025-03-25T03:00:00Z","-5.026631","-1.393438","201.821031","323.64257","-84.7906","29.195699999999988"
"2025-03-25T04:00:00Z","-5.044622","-1.350048","201.310882","323.6563","-84.7906","29.195699999999988"
"2025-03-25T05:00:00Z","-5.062231","-1.306046","200.800696","323.67074","-84.7906","29.195699999999988"
"2025-03-25T06:00:00Z","-5.079459","-1.261435","200.290472","323.685891","-84.7906","29.195699999999988"
"2025-03-25T07:00:00Z","-5.096302","-1.216217","199.780211","323.701755","-84.7906","29.195699999999988"
"2025-03-25T08:00:00Z","-5.112761","-1.170393","199.269913","323.718331","-84.7906","29.195699999999988"
"2025-03-25T09:00:00Z","-5.128833","-1.123966","198.75958","323.735621","-84.7906","29.195699999999988"
"2025-03-25T10:00:00Z","-5.144519","-1.076939","198.249211","323.753627","-84.7906","29.195699999999988"
"2025-03-25T11:00:00Z","-5.159815","-1.029313","197.738808","323.772348","-84.7906","29.195699999999988"
"2025-03-25T12:00:00Z","-5.174721","-0.981092","197.22837","323.791785","-84.7906","29.195699999999988"
"2025-03-25T13:00:00Z","-5.189237","-0.932277","196.717899","323.81194","-84.7906","29.195699999999988"
"2025-03-25T14:00:00Z","-5.203361","-0.882872","196.207395","323.832812","-84.7906","29.195699999999988"
"2025-03-25T15:00:00Z","-5.217091","-0.83288","195.696858","323.854402","-84.7906","29.195699999999988"
"2025-03-25T16:00:00Z","-5.230427","-0.782303","195.18629","323.87671","-84.7906","29.195699999999988"
"2025-03-25T17:00:00Z","-5.243369","-0.731144","194.675691","323.899737","-84.7906","29.195699999999988"
"2025-03-25T18:00:00Z","-5.255914","-0.679406","194.165061","323.923482","-84.7906","29.195699999999988"
"2025-03-25T19:00:00Z","-5.268061","-0.627093","193.654401","323.947946","-84.7906","29.195699999999988"
"2025-03-25T20:00:00Z","-5.279811","-0.574209","193.143713","323.973128","-84.7906","29.195699999999988"
"2025-03-25T21:00:00Z","-5.291162","-0.520755","192.632995","323.999029","-84.7906","29.195699999999988"
"2025-03-25T22:00:00Z","-5.302114","-0.466737","192.12225","324.025648","-84.7906","29.195699999999988"
"2025-03-25T23:00:00Z","-5.312665","-0.412158","191.611478","324.052985","-84.7906","29.195699999999988"
"2025-03-26T00:00:00Z","-5.322814","-0.357021","191.100679","324.081039","-84.7906","29.195699999999988"
"2025-03-26T01:00:00Z","-5.332562","-0.30133","190.589854","324.10981","-84.7906","29.195699999999988"
"2025-03-26T02:00:00Z","-5.341906","-0.24509","190.079004","324.139297","-84.7906","29.195699999999988"
"2025-03-26T03:00:00Z","-5.350847","-0.188304","189.56813","324.1695","-84.7906","29.195699999999988"
"2025-03-26T04:00:00Z","-5.359384","-0.130977","189.057232","324.200417","-84.7906","29.195699999999988"
"2025-03-26T05:00:00Z","-5.367517","-0.073113","188.546311","324.232047","-84.7906","29.195699999999988"
"2025-03-26T06:00:00Z","-5.375244","-0.014716","188.035368","324.26439","-84.7906","29.195699999999988"
"2025-03-26T07:00:00Z","-5.382564","0.044208","187.524403","324.297444","-84.7906","29.195699999999988"
"2025-03-26T08:00:00Z","-5.389479","0.103655","187.013417","324.331208","-84.7906","29.195699999999988"
"2025-03-26T09:00:00Z","-5.395987","0.163621","186.502412","324.365681","-84.7906","29.195699999999988"
"2025-03-26T10:00:00Z","-5.402087","0.224101","185.991386","324.40086","-84.7906","29.195699999999988"
"2025-03-26T11:00:00Z","-5.407779","0.285089","185.480342","324.436745","-84.7906","29.195699999999988"
"2025-03-26T12:00:00Z","-5.413064","0.34658","184.96928","324.473334","-84.7906","29.195699999999988"
"2025-03-26T13:00:00Z","-5.417939","0.408569","184.458201","324.510624","-84.7906","29.195699999999988"
"2025-03-26T14:00:00Z","-5.422406","0.471051","183.947106","324.548615","-84.7906","29.195699999999988"
"2025-03-26T15:00:00Z","-5.426463","0.53402","183.435994","324.587303","-84.7906","29.195699999999988"
"2025-03-26T16:00:00Z","-5.430112","0.59747","182.924868","324.626687","-84.7906","29.195699999999988"
"2025-03-26T17:00:00Z","-5.43335","0.661396","182.413728","324.666764","-84.7906","29.195699999999988"
"2025-03-26T18:00:00Z","-5.436178","0.725792","181.902574","324.707532","-84.7906","29.195699999999988"
"2025-03-26T19:00:00Z","-5.438597","0.790652","181.391408","324.748989","-84.7906","29.195699999999988"
"2025-03-26T20:00:00Z","-5.440605","0.85597","180.880229","324.791131","-84.7906","29.195699999999988"
"2025-03-26T21:00:00Z","-5.442203","0.921739","180.36904","324.833957","-84.7906","29.195699999999988"
"2025-03-26T22:00:00Z","-5.443391","0.987953","179.85784","324.877462","-84.7906","29.195699999999988"
"2025-03-26T23:00:00Z","-5.444168","1.054607","179.346631","324.921645","-84.7906","29.195699999999988"
"2025-03-27T00:00:00Z","-5.444535","1.121692","178.835412","324.966501","-84.7906","29.195699999999988"
```

### Get-LunarHorizons.ps1

```powershell
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9_-]*$')]
    [string]$Name,

    [Parameter(Mandatory)]
    [ValidateRange(-90, 90)]
    [double]$Latitude,

    [Parameter(Mandatory)]
    [ValidateRange(-180, 360)]
    [double]$Longitude,

    [Parameter(Mandatory)]
    [string]$StartUtc,

    [ValidateSet(1, 5, 10, 15, 30, 60)]
    [int]$StepMinutes = 60,

    [string]$OutputDirectory = (Join-Path $PSScriptRoot 'data')
)

$ErrorActionPreference = 'Stop'
$culture = [Globalization.CultureInfo]::InvariantCulture
$start = [DateTime]::ParseExact($StartUtc, 'yyyy-MM-dd HH:mm', $culture)
$stop = $start.AddHours(72)
$longitudeEast = ($Longitude + 360) % 360
$siteCoordinates = '{0},{1},0' -f $longitudeEast.ToString($culture), $Latitude.ToString($culture)
$expectedCount = 72 * 60 / $StepMinutes + 1

function Get-HorizonsAngles([string]$TargetId) {
    $parameters = [ordered]@{
        COMMAND = $TargetId
        EPHEM_TYPE = 'OBSERVER'
        CENTER = 'coord@301'
        COORD_TYPE = 'GEODETIC'
        SITE_COORD = $siteCoordinates
        START_TIME = $start.ToString('yyyy-MM-dd HH:mm', $culture)
        STOP_TIME = $stop.ToString('yyyy-MM-dd HH:mm', $culture)
        STEP_SIZE = "$StepMinutes min"
        QUANTITIES = '4'
        CSV_FORMAT = 'YES'
        TIME_TYPE = 'UT'
        APPARENT = 'AIRLESS'
        ELEV_CUT = '-90'
    }
    $query = ($parameters.GetEnumerator() | ForEach-Object {
        '{0}={1}' -f $_.Key, [Uri]::EscapeDataString("'$($_.Value)'")
    }) -join '&'

    $result = Invoke-RestMethod -TimeoutSec 30 -Uri "https://ssd.jpl.nasa.gov/api/horizons.api?format=json&$query"
    if ($result.error) {
        throw "Horizons target $TargetId returned an error: $($result.error)"
    }
    $table = [regex]::Match([string]$result.result, '(?s)\$\$SOE\s*(.*?)\s*\$\$EOE')
    if (-not $table.Success) {
        throw "Horizons target $TargetId returned no data table: $($result.result)"
    }

    foreach ($line in ($table.Groups[1].Value -split '\r?\n')) {
        # Quantity 4 puts azimuth and elevation after two status columns.
        $fields = $line -split ','
        $time = [DateTime]::ParseExact($fields[0].Trim(), 'yyyy-MMM-dd HH:mm', $culture)
        [pscustomobject]@{
            Time = $time
            Azimuth = [double]::Parse($fields[3].Trim(), $culture)
            Elevation = [double]::Parse($fields[4].Trim(), $culture)
        }
    }
}

$sun = @(Get-HorizonsAngles '10')
$earth = @(Get-HorizonsAngles '399')
if ($sun.Count -ne $expectedCount -or $earth.Count -ne $expectedCount) {
    throw "Expected $expectedCount rows. Horizons returned $($sun.Count) for the Sun and $($earth.Count) for Earth."
}

$rows = for ($i = 0; $i -lt $sun.Count; $i++) {
    $expectedTime = $start.AddMinutes($i * $StepMinutes)
    if ($sun[$i].Time -ne $expectedTime -or $earth[$i].Time -ne $expectedTime) {
        throw "Horizons returned an unexpected timestamp in row $($i + 1)."
    }
    [pscustomobject]@{
        timeUtc = $expectedTime.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", $culture)
        sunElevationDeg = $sun[$i].Elevation.ToString($culture)
        earthElevationDeg = $earth[$i].Elevation.ToString($culture)
        sunAzimuthDeg = $sun[$i].Azimuth.ToString($culture)
        earthAzimuthDeg = $earth[$i].Azimuth.ToString($culture)
        latitudeDeg = $Latitude.ToString($culture)
        longitudeEastDeg = $longitudeEast.ToString($culture)
    }
}

New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$outputFile = Join-Path $OutputDirectory "$Name.csv"
$rows | Export-Csv -LiteralPath $outputFile -NoTypeInformation -Encoding utf8
Write-Host "Saved $($rows.Count) rows to $outputFile"
```

## Appendix Updated Team Plan

# Long Shadow

**NASA Space Apps Challenge · Lunar Landing Site Navigator · November 14–15, 2026**

**Our demo question**  
If our Moon landing moves nine days later, how much daylight and direct-to-Earth visibility do we gain or lose during the first 72 hours on the surface?

We’re building a web app that answers that question from a spot on the Moon. Near the south pole, the Sun skims the horizon, so even a ridge can cast a long shadow. We’ll use NASA JPL Horizons for the Sun and Earth positions and show a clear estimate for a smooth lunar horizon. [Challenge brief](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/) · [NASA’s south-pole shadow visualization](https://science.nasa.gov/resource/shadows-near-the-moons-south-pole/)

## What we’re shipping

1. **One comparison screen.** Pick a site and a touchdown time in UTC. Show the original landing and a second landing at the same site nine days later. Let users change the second date and, if time allows, its site. Start with a few sourced presets, including Blue Ghost and a south-pole example. Add custom coordinates once the preset flow works.
2. **A horizon strip and a 72-hour timeline.** Show where the Sun and Earth are relative to the horizon, shade the periods each is above it, and give the total hours for both scenarios. Use text and icons alongside color. Put the difference in one sentence, such as “The later landing has 18 fewer hours with the Sun above the modeled horizon.” Use the actual computed result in the demo.
3. **One mission replay.** Open Blue Ghost at its March 16, 2025 sunset. Show the model’s estimate next to what Firefly reported, with each labeled. Firefly reported that the lander took sunset images and continued operating for just over five hours into lunar night. Use a precise observed sunset time only if we have a source for it. [Firefly mission updates](https://investors.fireflyspace.com/news-releases/news-release-details/blue-ghost-mission-1-live-updates)

Put this beside the results: **“Smooth-horizon estimate. Local terrain, eclipses, and lander hardware are outside this model.”** Use **“Sun above horizon”** and **“Earth above horizon”** as metric labels. These measure opportunities for solar power and direct radio. Skip the go/no-go verdict. Show the supported dates in the picker and account for the full 72-hour window when setting its limits.

**Fallback for the demo.** If arbitrary sites or dates are still unstable Saturday evening, ship the same comparison with a few labeled, precomputed JPL scenarios and fixed date choices. Use the 2D horizon strip as the main view. Once the public comparison and replay work, 3D is the first optional addition. Save the calendar, separate classroom and explorer modes, exports, terrain modeling, and tipped-lander simulation for later.

## Four owners

| Owner | Before the Saturday checkpoint | Before submission |
| --- | --- | --- |
| **Data** | Send App and Science a sample with site coordinates, UTC timestamps, and Sun and Earth directions. Provide a precomputed pair for the demo. | Package the supported data and document its date range, site coordinates, and sources. Keep the demo runnable without a live API call. |
| **Science** | Calculate visibility windows and totals for the first scenario. Agree with App on the exact meaning and units of every output. | Check results against direct JPL site queries and verify replay wording. Supply the assumptions and measured errors for the project page. |
| **App** | Deploy the one-site horizon strip and timeline to a public URL. Wire the first scenario end to end. | Add the second scenario and test on phone and desktop. Make the range limits and model assumptions visible. |
| **Story** | Recruit five first-time adult testers for Sunday and draft the demo and project page. | Run the test, record the demo, finish source credits and AI disclosure, and check public links. Coordinate with the team owner, who submits. |

## How we’ll check it

- **Numbers.** Keep the original target of 10 sites and 10 dates with Sun and Earth directions within 0.5° of direct JPL Horizons queries at matching sites and UTC times. Include polar and near-horizon cases. Check a horizon crossing separately and report the timing difference. Publish what we actually ran, including the worst difference and any failures. [JPL Horizons documentation](https://ssd.jpl.nasa.gov/horizons/manual.html)
- **Mission evidence.** The pilot’s eclipse numbers compare a landing-site estimate with the period when the entire Moon was in Earth’s deepest shadow. Leave eclipse validation out of the demo until we have a site-specific reference. The plan also reports that the tipped-SLIM check failed. Keep that result in the pilot notes. [NASA’s eclipse timings](https://science.nasa.gov/solar-system/moon/what-you-need-to-know-about-the-march-2025-total-lunar-eclipse/)
- **Usability.** Give five first-time adult testers the same sunset question and time their attempts. Keep the original target of at least four correct and a median time of 60 seconds or less. Then ask which landing time gives more daylight in the first 72 hours. Record accuracy, time, and where people got stuck. Fix the most common blocker and report the actual results without names.

## Schedule in Pacific time

| When | What needs to be ready |
| --- | --- |
| **Saturday, now** | Agree on the scope, claim the four roles, and pick the demo scenario. The team owner confirms registration, the Team Members list, and any local judging or presentation cutoff. |
| **Saturday, 6 p.m.** | One real scenario works on the public link. Check a sample against JPL. If the data path is unstable, switch to the precomputed demo scenarios. |
| **Saturday, 10 p.m.** | Two scenarios compare end to end. Blue Ghost replay and model assumptions are in place. Do a full demo run. |
| **Sunday, 8–10 a.m.** | Finish the science checks, tighten the mobile layout, and prepare the submission fields. |
| **Sunday, 10–11 a.m.** | Run the five-person test, fix the biggest usability issue, and record the screen demo. |
| **Sunday, 11 a.m.–noon** | Open the live app, demo, and repo links in a private window. The team owner submits for judging and verifies the submission status. Move this earlier if the local schedule requires it. |
| **Sunday afternoon** | Use the buffer for critical fixes and confirm submission status after any changes. The official global cutoff is **11:59 p.m. local time on Nov. 15**. |

[Official Space Apps timeline](https://www.spaceappschallenge.org/2026/)

## Demo and submission

**30-second screen recording**

- **0–7 sec** · Open the Blue Ghost replay. “Blue Ghost photographed sunset from the Moon and kept operating for hours into lunar night.”
- **7–23 sec** · Apply the nine-day delay. Point to the original and delayed timelines and the hours gained or lost. Keep the smooth-horizon label in view.
- **23–30 sec** · Show the source and one measured test result if available. End on the comparison screen.

**Submission checklist**

- Confirm all four teammates are registered for the same event and listed on the team page. Check the current guide and local organizer’s instructions for any earlier deadline and for demo, publicity, and AI requirements.
- Fill in the project summary, description, NASA data usage, and references. Credit Horizons and other sources actually used, with licenses where applicable. Name the supported sites and dates, model assumptions, and checks completed.
- Agree as a team on the design choices. Record how AI contributed to the plan or project and disclose it accurately in the applicable field.
- Use English captions and keep the recording to the app screen. Verify the app, demo, and repo links open without signing in. Select **Submit for Judging** and confirm the submission status.

[Space Apps participant resources](https://www.spaceappschallenge.org/resources/)
