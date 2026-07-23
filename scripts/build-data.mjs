// Build-time data pipeline for the Munro Camper Planner.
//
// Sources:
//   - DoBIH (hill-bagging.co.uk) hillcsv.zip, CC-BY 4.0 — munro positions/heights
//   - stevenfallon.co.uk/downloads/munrolist.csv — per-hill page filenames
//   - Overpass API (OSM, ODbL) — car parks near munro summits (--carparks)
//
// Usage:
//   node scripts/build-data.mjs             # munros.json only
//   node scripts/build-data.mjs --verify    # also HEAD-check walkhighlands URLs
//   node scripts/build-data.mjs --carparks  # also rebuild carparks.json (slow, hits Overpass)

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { parse } from 'csv-parse/sync'

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const DOBIH_ZIP_URL = 'https://www.hill-bagging.co.uk/dobih-downloads/hillcsv.zip'
const FALLON_CSV_URL = 'https://www.stevenfallon.co.uk/downloads/munrolist.csv'
// Walkhighlands route start points, scraped by github.com/dzfranklin/munro-access
// (Apache-2.0 repo; underlying start data © walkhighlands — personal use only).
const WH_ROUTES_URL =
  'https://raw.githubusercontent.com/dzfranklin/munro-access/main/data_sources/walkhighlands/munro_routes.jsonl'
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
]
// Search for parking around each walkhighlands route START (not the summit) —
// far lighter Overpass queries and far more relevant results.
const CARPARK_RADIUS_M = 1500

const args = new Set(process.argv.slice(2))

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'munro-camper-planner data build (personal project)' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

function pick(row, ...names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== '') return row[n]
  }
  return undefined
}

// Walkhighlands slugs: lowercase, accents stripped, apostrophes dropped, spaces -> hyphens.
function slugify(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// DoBIH hill number -> walkhighlands slug, for names that don't slugify cleanly:
// duplicate names get a place disambiguator, sub-peaks are "peak-massif", and
// bracketed alternative spellings go either way. Sourced from walkhighlands search.
const WH_EXCEPTIONS = {
  623: 'a-chailleach-monadhliath',
  1043: 'a-chailleach',
  862: 'a-chralaig',
  433: 'an-socach-braemar',
  845: 'an-socach-affric',
  931: 'an-socach-mullardoch',
  1003: 'bidein-a-ghlas-thuill-an-teallach',
  1004: 'sgurr-fiona-an-teallach',
  279: 'aonach-beag-nevis-range',
  347: 'aonach-beag-alder',
  179: 'meall-dearg-aonach-eagach',
  178: 'sgorr-nam-fiannaidh-aonach-eagach',
  195: 'sgorr-dhearg-beinn-a-bheithir',
  198: 'sgorr-dhonuill-beinn-a-bheithir',
  529: 'beinn-a-bhuird',
  559: 'beinn-a-chaorainn-cairngorms',
  663: 'beinn-a-chaorainn-glen-spean',
  422: 'braigh-coire-chruinn-bhalgain',
  429: 'carn-liath-beinn-a-ghlo',
  421: 'carn-nan-gabhar',
  957: 'sgurr-mor-beinn-alligin',
  968: 'tom-na-gruagaich-beinn-alligin',
  152: 'ben-challum',
  406: 'beinn-dearg-blair-atholl',
  1062: 'beinn-dearg-ullapool',
  955: 'ruadh-stac-mor-beinn-eighe',
  956: 'spidean-coire-nan-clach-beinn-eighe',
  201: 'beinn-fhionnlaidh',
  826: 'beinn-fhionnlaidh-carn-eige',
  145: 'beinn-heasgarnich',
  536: 'ben-avon',
  1165: 'ben-klibreck',
  65: 'ben-lui',
  518: 'ben-macdui',
  26: 'ben-more',
  1301: 'ben-more-mull',
  278: 'ben-nevis',
  17: 'ben-vorlich-loch-earn',
  71: 'ben-vorlich-loch-lomond',
  1088: 'ben-wyvis',
  1255: 'bla-bheinn',
  209: 'stob-coire-raineach-buachaille-etive-beag',
  202: 'stob-dubh-buachaille-etive-beag',
  196: 'stob-dearg-buachaille-etive-mor',
  203: 'stob-na-broige-buachaille-etive-mor',
  408: 'carn-an-fhidhleir-carn-ealar',
  352: 'carn-dearg-loch-pattack',
  363: 'carn-dearg-corrour',
  621: 'carn-dearg-monadhliath',
  895: 'carn-nan-gobhar-strathfarrar',
  936: 'carn-nan-gobhar-loch-mullardoch',
  350: 'geal-charn',
  624: 'geal-charn-monadhliath',
  346: 'geal-charn-alder',
  392: 'geal-charn-drumochter',
  773: 'gulvain',
  954: 'mullach-an-rathain-liathach',
  953: 'spidean-a-choire-leith-liathach',
  457: 'lochnagar',
  123: 'meall-buidhe-glen-lyon',
  737: 'meall-buidhe-knoydart',
  118: 'meall-garbh-carn-mairg',
  143: 'meall-garbh-ben-lawers',
  1240: 'inaccessible-pinnacle',
  733: 'sgurr-mor-loch-quoich',
  1040: 'sgurr-mor',
  1245: 'sgurr-na-banachdich',
  199: 'sgor-na-h-ulaidh',
  805: 'sgurr-nan-ceathreamhnan',
  736: 'sgurr-nan-coireachan-glen-dessary',
  776: 'sgurr-nan-coireachan-glenfinnan',
  309: 'stob-ban-mamores',
  314: 'stob-ban-grey-corries',
  244: 'stob-diamh',
  120: 'stuchd-an-lochain',
  810: 'tom-a-choinich',
}

function normGridref(g) {
  return String(g || '').toUpperCase().replace(/\s+/g, '')
}

async function loadDobihMunros(classification = 'M') {
  console.log('Downloading DoBIH hillcsv.zip ...')
  const zip = new AdmZip(await fetchBuffer(DOBIH_ZIP_URL))
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.csv'))
  if (!entry) throw new Error('No CSV inside hillcsv.zip')
  const rows = parse(entry.getData().toString('utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true })
  console.log(`DoBIH rows: ${rows.length}`)

  const sample = rows[0]
  const classificationOf = (r) => String(pick(r, 'Classification') || '').split(',').map((s) => s.trim())
  const munros = rows.filter((r) => classificationOf(r).includes(classification))
  if (munros.length === 0) {
    console.error(`No hills with classification ${classification} — header names may have changed. Headers were:`)
    console.error(Object.keys(sample).join(' | '))
    process.exit(1)
  }
  console.log(`Hills (classification ${classification}): ${munros.length}`)

  return munros.map((r) => ({
    id: Number(pick(r, 'Number')),
    name: pick(r, 'Name'),
    height: Number(pick(r, 'Metres')),
    gridref: normGridref(pick(r, 'Grid ref 6-figure', 'Grid ref', 'Gridref')),
    lat: Number(pick(r, 'Latitude')),
    lon: Number(pick(r, 'Longitude')),
    region: pick(r, 'Region') || '',
    area: pick(r, 'Area') || '',
    x: Number(pick(r, 'Xcoord', 'xcoord')),
    y: Number(pick(r, 'Ycoord', 'ycoord')),
  }))
}

async function loadFallonPages(url = FALLON_CSV_URL) {
  console.log(`Downloading Steve Fallon ${url.split('/').pop()} ...`)
  const rows = parse((await fetchBuffer(url)).toString('utf8'), {
    relax_column_count: true,
    skip_empty_lines: true,
  })
  // Columns (no header): 0 id, 1 name, 2 height, 3 gridref, 4 photo, 5 page html,
  // 6 type, 7 easting, 8 northing, ...
  const pages = []
  for (const row of rows) {
    const page = String(row[5] || '').trim()
    const x = Number(row[7])
    const y = Number(row[8])
    if (page.endsWith('.html') && Number.isFinite(x) && Number.isFinite(y)) {
      pages.push({ x, y, url: `https://www.stevenfallon.co.uk/${page}` })
    }
  }
  console.log(`Fallon pages: ${pages.length}`)
  // Match by OS easting/northing proximity — grid refs round differently between datasets.
  return (x, y) => {
    let best = null
    let bestD = Infinity
    for (const p of pages) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2
      if (d < bestD) {
        bestD = d
        best = p
      }
    }
    return best && bestD <= 300 ** 2 ? best.url : null
  }
}

async function loadWhRoutes() {
  console.log('Downloading walkhighlands route starts (munro-access) ...')
  const text = (await fetchBuffer(WH_ROUTES_URL)).toString('utf8')
  const byNumber = new Map()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const row = JSON.parse(line)
    byNumber.set(row.number, row)
  }
  console.log(`WH route entries: ${byNumber.size}`)
  return byNumber
}

async function verifyWalkhighlands(munros) {
  console.log('Verifying walkhighlands URLs (HEAD requests, ~1/sec) ...')
  const failures = []
  for (const m of munros) {
    try {
      const res = await fetch(m.walkhighlands, { method: 'HEAD', redirect: 'follow' })
      if (!res.ok) failures.push(m)
    } catch {
      failures.push(m)
    }
    await new Promise((r) => setTimeout(r, 700))
  }
  if (failures.length) {
    console.log(`\n${failures.length} walkhighlands URLs FAILED — add to WH_EXCEPTIONS:`)
    for (const m of failures) console.log(`  ${m.id}: '${slugify(m.name)}',  // ${m.name}`)
  } else {
    console.log('All walkhighlands URLs OK')
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

async function overpassQuery(query) {
  let lastErr
  for (let attempt = 0; attempt < 9; attempt++) {
    const url = OVERPASS_URLS[attempt % OVERPASS_URLS.length]
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'munro-camper-planner data build (personal project)',
        },
        body: 'data=' + encodeURIComponent(query),
      })
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      console.log(`  ${url} failed (${e.message}), retrying in 20s ...`)
      await new Promise((r) => setTimeout(r, 20000))
    }
  }
  throw lastErr
}

async function buildCarparks(munros) {
  // Unique route start points (several munros share a start).
  const starts = []
  const seenStart = new Set()
  for (const m of munros) {
    for (const r of m.routes) {
      const key = `${r.startLat.toFixed(3)},${r.startLon.toFixed(3)}`
      if (seenStart.has(key)) {
        starts.find((s) => s.key === key).munros.push(m.id)
      } else {
        seenStart.add(key)
        starts.push({ key, lat: r.startLat, lon: r.startLon, munros: [m.id] })
      }
    }
  }
  console.log(`Unique route starts: ${starts.length}`)

  const CHUNK = 40
  const found = new Map()
  // Overpass is flaky; cache each chunk's raw elements so reruns resume.
  const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '.overpass-cache')
  mkdirSync(cacheDir, { recursive: true })
  for (let i = 0; i < starts.length; i += CHUNK) {
    const chunk = starts.slice(i, i + CHUNK)
    const cacheFile = path.join(cacheDir, `chunk-${i}.json`)
    const arounds = chunk
      .map((m) => `nwr["amenity"="parking"](around:${CARPARK_RADIUS_M},${m.lat},${m.lon});`)
      .join('\n')
    const query = `[out:json][timeout:240];(\n${arounds}\n);out center tags;`
    console.log(`Overpass chunk ${i / CHUNK + 1}/${Math.ceil(starts.length / CHUNK)} ...`)
    let json
    if (existsSync(cacheFile)) {
      console.log('  (cached)')
      json = JSON.parse(readFileSync(cacheFile, 'utf8'))
    } else {
      json = await overpassQuery(query)
      writeFileSync(cacheFile, JSON.stringify(json))
    }
    for (const el of json.elements) {
      const lat = el.lat ?? el.center?.lat
      const lon = el.lon ?? el.center?.lon
      if (lat == null) continue
      const access = el.tags?.access
      if (access === 'private' || access === 'no') continue
      found.set(`${el.type}/${el.id}`, {
        id: `${el.type}/${el.id}`,
        lat,
        lon,
        name: el.tags?.name || null,
        fee: el.tags?.fee || null,
      })
    }
    await new Promise((r) => setTimeout(r, 5000))
  }

  const carparks = [...found.values()]
  for (const cp of carparks) {
    cp.munros = [
      ...new Set(
        starts
          .filter((s) => haversineKm(cp.lat, cp.lon, s.lat, s.lon) <= CARPARK_RADIUS_M / 1000)
          .flatMap((s) => s.munros),
      ),
    ]
  }
  console.log(`Car parks: ${carparks.length}`)
  return carparks
}

function parkupCategory(t) {
  if (t.tourism === 'camp_site' || t.tourism === 'caravan_site') return 'site'
  if (
    t.motorhome === 'yes' ||
    t.motorhome === 'designated' ||
    t.overnight_stay === 'yes' ||
    t.overnight_stay === 'designated' ||
    t['motorhome:overnight'] === 'yes'
  )
    return 'overnight'
  return 'layby'
}

async function buildParkups() {
  // Overnight candidates for the camper across the Highlands & Islands:
  // formal sites, parking explicitly tagged motorhome/overnight-ok, and
  // laybys/rest areas. OSM "overnight tolerated" tagging is patchy — the app
  // links each spot to park4night for crowd wisdom.
  const query = `[out:json][timeout:240][bbox:55.2,-7.6,58.8,-1.7];
(
  nwr["tourism"="camp_site"];
  nwr["tourism"="caravan_site"];
  nwr["highway"="rest_area"];
  nwr["amenity"="parking"]["parking"="layby"];
  nwr["amenity"="parking"]["motorhome"~"yes|designated"];
  nwr["amenity"="parking"]["overnight_stay"~"yes|designated"];
  nwr["amenity"="parking"]["motorhome:overnight"="yes"];
);out center tags;`
  const json = await overpassQuery(query)
  const parkups = []
  const seen = new Set()
  for (const el of json.elements) {
    const key = `${el.type}/${el.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (lat == null) continue
    const t = el.tags ?? {}
    if (t.access === 'private' || t.access === 'no') continue
    parkups.push({
      id: key,
      lat,
      lon,
      name: t.name || null,
      kind: t.tourism || (t.highway === 'rest_area' ? 'rest_area' : 'layby'),
      category: parkupCategory(t),
      fee: t.fee || null,
      motorhome: t.motorhome || t.caravans || null,
      website: t.website || null,
    })
  }
  console.log(
    `Park-ups: ${parkups.length} (sites ${parkups.filter((p) => p.category === 'site').length}, overnight-tagged ${parkups.filter((p) => p.category === 'overnight').length}, laybys/rest ${parkups.filter((p) => p.category === 'layby').length})`,
  )
  return parkups
}

const munrosPath = path.join(OUT_DIR, 'munros.json')
// --carparks / --parkups reuse committed munros.json rather than re-hammering
// the upstream sources on every run.
const needMunrosBuild = !existsSync(munrosPath) || args.size === 0 || args.has('--munros') || args.has('--verify')

let munros
if (!needMunrosBuild) {
  munros = JSON.parse(readFileSync(munrosPath, 'utf8')).munros
  console.log(`Using existing munros.json (${munros.length} munros)`)
} else {
  await buildMunros()
}

async function buildMunros() {
const dobih = await loadDobihMunros()
const fallon = await loadFallonPages()
const whRoutes = await loadWhRoutes()

munros = dobih
  .map((m) => {
    const wh = whRoutes.get(m.id)
    const derivedSlug = WH_EXCEPTIONS[m.id] || slugify(m.name)
    const scrapedSlug = wh?.page?.match(/munros\/([a-z0-9\-]+)/)?.[1]
    if (scrapedSlug && scrapedSlug !== derivedSlug) {
      console.log(`WH slug mismatch for ${m.name} (${m.id}): derived '${derivedSlug}' vs scraped '${scrapedSlug}'`)
    }
    // Search-verified exceptions beat the munro-access scrape (which has occasional
    // shared-route artifacts, e.g. Ben Lui -> beinn-a-chleibh); the scrape beats
    // naive name slugification.
    const slug = WH_EXCEPTIONS[m.id] || scrapedSlug || slugify(m.name)
    return {
      ...m,
      walkhighlands: `https://www.walkhighlands.co.uk/munros/${slug}`,
      stevenfallon: fallon(m.x, m.y),
      hillbagging: `https://www.hill-bagging.co.uk/mountaindetails.php?qu=S&rf=${m.id}`,
      routes: (wh?.routes ?? [])
        .filter((r) => Array.isArray(r.startLngLat))
        .map((r) => ({
          name: r.name,
          url: r.page,
          startName: r.startName || null,
          startLat: r.startLngLat[1],
          startLon: r.startLngLat[0],
          startGridref: normGridref(r.stats?.['Start Grid Ref']) || null,
          distance: r.stats?.Distance || null,
          time: r.stats?.['Time (summer conditions)'] || null,
          ascent: r.stats?.Ascent || null,
        })),
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

const noRoutes = munros.filter((m) => m.routes.length === 0)
if (noRoutes.length) console.log(`No WH routes for ${noRoutes.length}: ${noRoutes.map((m) => m.name).join(', ')}`)

const missingFallon = munros.filter((m) => !m.stevenfallon)
if (missingFallon.length) {
  console.log(`No Fallon page matched for ${missingFallon.length}: ${missingFallon.map((m) => m.name).join(', ')}`)
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
  path.join(OUT_DIR, 'munros.json'),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: munros.length, munros }, null, 1),
)
console.log(`Wrote munros.json (${munros.length} munros)`)
}

if (args.has('--verify')) await verifyWalkhighlands(munros)

if (args.has('--corbetts')) {
  const dobihC = await loadDobihMunros('C')
  const fallonC = await loadFallonPages('https://www.stevenfallon.co.uk/downloads/corbettlist.csv')
  const nameCount = {}
  for (const c of dobihC) {
    const k = slugify(c.name)
    nameCount[k] = (nameCount[k] || 0) + 1
  }
  const corbetts = dobihC
    .map((c) => ({
      ...c,
      // Duplicate names get an unguessable place suffix on walkhighlands —
      // omit the link rather than guess wrong.
      walkhighlands: nameCount[slugify(c.name)] === 1 ? `https://www.walkhighlands.co.uk/corbetts/${slugify(c.name)}` : null,
      stevenfallon: fallonC(c.x, c.y),
      hillbagging: `https://www.hill-bagging.co.uk/mountaindetails.php?qu=S&rf=${c.id}`,
      routes: [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const dupes = corbetts.filter((c) => !c.walkhighlands).length
  const noFallon = corbetts.filter((c) => !c.stevenfallon).length
  console.log(`Corbetts: ${corbetts.length} (no WH link for ${dupes} duplicate names, no Fallon match for ${noFallon})`)
  writeFileSync(
    path.join(OUT_DIR, 'corbetts.json'),
    JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: corbetts.length, corbetts }, null, 1),
  )
  console.log('Wrote corbetts.json')
}

if (args.has('--parkups')) {
  const parkups = await buildParkups()
  writeFileSync(
    path.join(OUT_DIR, 'parkups.json'),
    JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: parkups.length, parkups }, null, 1),
  )
  console.log('Wrote parkups.json')
}

if (args.has('--carparks')) {
  const carparks = await buildCarparks(munros)
  writeFileSync(
    path.join(OUT_DIR, 'carparks.json'),
    JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: carparks.length, carparks }, null, 1),
  )
  console.log('Wrote carparks.json')
}
