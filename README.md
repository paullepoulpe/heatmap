# Unexplored

A heatmap of everywhere you have been, and a list of the places nearby you have never been.

Load your Google Timeline export, and the map lights up where you spend your time. Drop a pin
anywhere, pick a radius and some categories, and the app asks OpenStreetMap for named places
around the pin and ranks them by how *unfamiliar* they are to you. The dark patches on the
map are your next weekend.

Everything runs in your browser. Your location history is parsed in memory and never uploaded
anywhere. The only network calls are for map tiles and the Overpass query for nearby places
(which sends the pin position and radius, nothing about your history).

## Run it

It is a static site, but the code uses ES modules, so it needs to be served over HTTP rather
than opened from `file://`:

```sh
npm start          # http://localhost:8080
```

or any static server (`python3 -m http.server 8080`), or enable GitHub Pages on this branch.

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
js/parse.js     Timeline / Takeout parsers (all four formats), pure functions
js/score.js     spatial grid index, familiarity, distance, heat aggregation
js/places.js    Overpass query builder + fetch with endpoint fallback
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
- An "exploration score" per neighbourhood, and a route that strings unexplored places together.

## Credits

Map tiles by [CARTO](https://carto.com/attributions), data ©
[OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, places via the
[Overpass API](https://overpass-api.de/). Built with [Leaflet](https://leafletjs.com/) and
[Leaflet.heat](https://github.com/Leaflet/Leaflet.heat).
