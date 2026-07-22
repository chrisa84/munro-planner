# Munro Camper Planner

A personal map + trip planner for bagging Munros by camper van. All 282 Munros on an
OS-style map with car parks, links to Walkhighlands / Steve Fallon / Hill Bagging pages,
done-tracking, and driving-time estimates between stops.

## Run it

```
npm install
npm run dev
```

### OS base map (optional but recommended)

Get a free API key from [OS DataHub](https://osdatahub.os.uk/) (OS Maps API, OpenData plan),
then create `.env.local`:

```
VITE_OS_MAPS_KEY=your-key-here
```

Without a key the app falls back to OpenTopoMap tiles.

## Usage

- **Munros tab** — search/filter, tick hills as bagged, click a name to fly to it.
  Progress is stored in localStorage; use Export/Import to back it up or move devices.
- **Map** — red = to do, green = bagged. Popups link to Walkhighlands, Steve Fallon and
  Hill Bagging, and list nearby car parks. Zoom in (≥ 11) to see car parks (blue P).
- **Trip tab** — create a trip, then add stops from car-park popups, munro popups, or
  right-click anywhere on the map for a custom stop (campsite, supermarket…).
  Legs show OSRM driving distance/time plus an adjusted time (single-track factor,
  default ×1.25) because OSRM is optimistic about Highland roads.

## Data

Static JSON in `public/data/`, rebuilt with:

```
npm run data              # munros.json (DoBIH + link matching)
npm run data -- --verify  # also HEAD-check all walkhighlands URLs
npm run data -- --carparks  # also rebuild carparks.json from Overpass (slow)
```

Sources & attribution:

- Hill data: [Database of British and Irish Hills](https://www.hill-bagging.co.uk/dobih) (CC-BY 4.0)
- Car parks: OpenStreetMap via Overpass API (ODbL)
- Routing: [OSRM demo server](https://project-osrm.org) (non-commercial, ~1 req/s)
- Per-hill page links: [Walkhighlands](https://www.walkhighlands.co.uk/munros/) and
  [stevenfallon.co.uk](https://www.stevenfallon.co.uk/)
