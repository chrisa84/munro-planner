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

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { parse } from 'csv-parse/sync'

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data')
const DOBIH_ZIP_URL = 'https://www.hill-bagging.co.uk/dobih-downloads/hillcsv.zip'
const FALLON_CSV_URL = 'https://www.stevenfallon.co.uk/downloads/munrolist.csv'
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const CARPARK_RADIUS_M = 6000

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

// DoBIH hill number -> walkhighlands slug, for names that don't slugify cleanly
// (duplicates disambiguated by area, spelling differences). Populated from --verify failures.
const WH_EXCEPTIONS = {}

function normGridref(g) {
  return String(g || '').toUpperCase().replace(/\s+/g, '')
}

async function loadDobihMunros() {
  console.log('Downloading DoBIH hillcsv.zip ...')
  const zip = new AdmZip(await fetchBuffer(DOBIH_ZIP_URL))
  const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith('.csv'))
  if (!entry) throw new Error('No CSV inside hillcsv.zip')
  const rows = parse(entry.getData().toString('utf8'), { columns: true, skip_empty_lines: true, relax_column_count: true })
  console.log(`DoBIH rows: ${rows.length}`)

  const sample = rows[0]
  const classificationOf = (r) => String(pick(r, 'Classification') || '').split(',').map((s) => s.trim())
  const munros = rows.filter((r) => classificationOf(r).includes('M'))
  if (munros.length === 0) {
    console.error('No Munros found — header names may have changed. Headers were:')
    console.error(Object.keys(sample).join(' | '))
    process.exit(1)
  }
  console.log(`Munros (classification M): ${munros.length}`)

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

async function loadFallonPages() {
  console.log('Downloading Steve Fallon munrolist.csv ...')
  const rows = parse((await fetchBuffer(FALLON_CSV_URL)).toString('utf8'), {
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
  for (let attempt = 0; attempt < 4; attempt++) {
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
  const CHUNK = 35
  const found = new Map()
  for (let i = 0; i < munros.length; i += CHUNK) {
    const chunk = munros.slice(i, i + CHUNK)
    const arounds = chunk
      .map((m) => `nwr["amenity"="parking"](around:${CARPARK_RADIUS_M},${m.lat},${m.lon});`)
      .join('\n')
    const query = `[out:json][timeout:240];(\n${arounds}\n);out center tags;`
    console.log(`Overpass chunk ${i / CHUNK + 1}/${Math.ceil(munros.length / CHUNK)} ...`)
    const json = await overpassQuery(query)
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
    cp.munros = munros
      .filter((m) => haversineKm(cp.lat, cp.lon, m.lat, m.lon) <= CARPARK_RADIUS_M / 1000)
      .map((m) => m.id)
  }
  console.log(`Car parks: ${carparks.length}`)
  return carparks
}

const dobih = await loadDobihMunros()
const fallon = await loadFallonPages()

const munros = dobih
  .map((m) => ({
    ...m,
    walkhighlands: `https://www.walkhighlands.co.uk/munros/${WH_EXCEPTIONS[m.id] || slugify(m.name)}`,
    stevenfallon: fallon(m.x, m.y),
    hillbagging: `https://www.hill-bagging.co.uk/mountaindetails.php?qu=S&rf=${m.id}`,
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

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

if (args.has('--verify')) await verifyWalkhighlands(munros)

if (args.has('--carparks')) {
  const carparks = await buildCarparks(munros)
  writeFileSync(
    path.join(OUT_DIR, 'carparks.json'),
    JSON.stringify({ generated: new Date().toISOString().slice(0, 10), count: carparks.length, carparks }, null, 1),
  )
  console.log('Wrote carparks.json')
}
