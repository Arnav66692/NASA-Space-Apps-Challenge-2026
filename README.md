# NASA-Space-Apps-Challenge-2026
# Long Shadow

A web tool for the NASA Space Apps Challenge 2026 (**Lunar Landing Site Navigator**).

Pick any place on the Moon and any day, and see in seconds whether a lander there has **sunlight for power** and a **line of sight to Earth for radio**.

- **Live demo:** _TODO: add link_
- **Demo video (30 s):** _TODO: add link_

## What it does

- **Any site:** famous landing sites (Apollo, Blue Ghost, Odysseus, Athena, Chandrayaan-3, SLIM, Artemis III candidate regions), a clickable Moon map, or custom latitude/longitude
- **Any date:** a date picker and a scrubber that plays a full lunar day
- **Sky from the surface:** where the Sun and Earth sit relative to the horizon, as a 3D view and a flat horizon strip
- **Countdowns:** time to sunset, time to Earthset, hours of sunlight, radio windows
- **Compare:** up to three site/date options side by side
- **Slip slider:** drag a launch delay and see what you gain or lose
- **Verdict:** Go, Marginal or No-go, with the reason in one plain sentence

## Three ways to use it

- **Planner** (for mission planners)
  - Numbers first
  - A landing-date calendar
  - CSV and one-page brief export
  - Shareable scenario links
- **Classroom** (for teachers and students)
  - A five-minute guided story
  - Three discussion questions
- **Explore** (for anyone curious)
  - Opens on the Moon right now at a famous site

## How we check it

- **Mission replays:** we compare our predictions with what really happened on Blue Ghost and SLIM
- **Reference data:** our Sun and Earth angles are compared against NASA JPL Horizons. _TODO: add P1 result_
- **User test:** adults who had never seen the tool were asked when the Sun sets at a given site and date. _TODO: add P2 result_

## Known limits

- Sunrise, sunset and eclipse timing are modeled for flat ground
- Terrain shadowing near the poles is not modeled unless the optional terrain layer is enabled. _TODO: confirm_
- Lander tilt effects are experimental and not validated

## Data and references

- JPL Horizons (NASA/JPL): Sun and Earth positions as seen from the Moon
- NASA LOLA lunar elevation data (if terrain is enabled)
- Partner data: ISRO (Chandrayaan-3), JAXA (SLIM)
- _TODO: add every outside resource with its license_


# Team Name: Red K 
# agastya singh, arnav singh, arsh johari, pratham tomar
