# Unexplored

Every street you have walked and every park you have been to, drawn from your Google Timeline,
and the ones you have not.

Load your Timeline export and the map turns into a fog-of-war view of your life:

- **Fog** covers ground your tracks never touched; a clear corridor follows everywhere you went.
- **Streets** in view are drawn amber where you walked them and blue where you never have, with
  a walked-kilometres tally for the area on screen.
- **Parks** are shaded visited or not visited.
- **Places to try**: drop a pin, pick a radius and categories, and named places from
  OpenStreetMap are ranked by how unfamiliar they are to you.
- An optional **heatmap** of time spent, for the big picture.

Only travel on foot counts by default. Track points are tagged with a travel mode from Google's
activity segments (walking, cycling, in a vehicle) and, where those are missing, from the speed
between fixes, so a drive across town does not light up the streets you drove down.

Everything runs in your browser. Your location history is parsed in memory and never uploaded
anywhere. The only network calls are for map tiles and the Overpass query for nearby places
(which sends the pin position and radius, nothing about your history).

## Run it

It is a static site, but the code uses ES modules, so it needs to be served over HTTP rather
than opened from `file://`:

```sh
npm start          # http://localhost:8080
```

or any static server (`python3 -m http.server 8080`).

Pushes to the default branch also deploy the site to GitHub Pages through
`.github/workflows/pages.yml` (tests run first). The workflow enables Pages on first run; if that
step is refused, enable it once under **Settings → Pages → Source: GitHub Actions**.

## Get your Timeline export

Google moved Timeline on-device in 2024, so the export comes from the Maps app on your phone:

1. Google Maps app → your avatar → **Your timeline**
2. **⋯** → **Location & privacy settings** → **Export Timeline data**
3. Save the resulting `Timeline.json` (Android) or `location-history.json` (iOS) somewhere you
   can reach from the browser, then drop it on the page.

Older Google Takeout exports also work: `Records.json` and the monthly
`Semantic Location History/<year>/<year>_<MONTH>.json` files. Unzip the archive and select
several files at once. If you backed up your history before the 2024 migration, feed both
the old Takeout files and the new on-device export together.

## How coverage works

The points that count (see "Count as walked") mark a 20 m grid of "been here" cells within the
reveal radius. Each street in view is sampled every 10 m and split into runs of covered and
uncovered samples; a park is visited when any covered cell lies inside it. Streets and parks come
from the Overpass API for the area on screen, once it is smaller than about 12 km², and are cached
as you pan.

## How places are scored

Every point in your history gets a weight:

| Source | Weight |
|---|---|
| Visit (a stay somewhere) | hours spent, floored at 0.25 and capped at 8 |
| Route breadcrumb (`timelinePath`, activity start/end) | 0.05 |
| Raw position signal (`rawSignals`, `Records.json`) | 0.02 |

The **familiarity** of a spot is the weighted sum of your points nearby with a Gaussian
falloff (σ = 120 m), so `1.0` is roughly "one hour spent right here". Places are labelled:

| Level | Familiarity |
|---|---|
| Unexplored | < 0.05 |
| Passed by | 0.05 – 1 |
| Familiar | ≥ 1 |

Thresholds and weights live in `js/parse.js` (`WEIGHTS`) and `js/score.js` (`LEVELS`).

## Project layout

```
index.html      page
css/style.css
js/parse.js     Timeline / Takeout parsers (all four formats) with travel-mode tagging
js/score.js     spatial grid index, familiarity, distance, heat aggregation
js/coverage.js  "been here" grid, street sampling, park point-in-polygon
js/places.js    Overpass queries (places, streets, parks) with endpoint fallback
js/canvas-layer.js  one-canvas Leaflet layer used for the fog and the coverage
js/demo.js      synthetic history + places for "Try with demo data"
js/app.js       UI and Leaflet wiring
vendor/leaflet  Leaflet 1.9.4 and leaflet.heat 0.2.0, vendored (no CDN, works offline)
test/           node --test unit tests
```

```sh
npm test
```

## Ideas for later

- Cache the parsed history in IndexedDB so you import once.
- Parse the export in a Web Worker so very large files do not freeze the page.
- Live tracking from the browser's geolocation to keep the map current after the import.
- Time filters: only weekends, only the last year, only evenings.
- Per-neighbourhood exploration scores, and a walking route that strings unwalked streets together.
- Prefetch streets for your whole home area so the coverage view works offline.

## Credits

Map tiles by [CARTO](https://carto.com/attributions), data ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, places via the
[Overpass API](https://overpass-api.de/). Built with [Leaflet](https://leafletjs.com/) and
[Leaflet.heat](https://github.com/Leaflet/Leaflet.heat).
