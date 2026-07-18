/**
 * Canonical seed dataset + insertion into Neon Postgres.
 *
 * This is the single source of truth for the sample dataset. The API server
 * calls seedIfEmpty() on startup, and it can be run directly to (re)seed:
 *
 *   node --env-file=.env server/seed.mjs          # seed only if empty
 *   node --env-file=.env server/seed.mjs --force  # wipe + reseed
 */
import pg from 'pg'

const ENTITY_TABLES = ['partners', 'trucks', 'drivers', 'locations', 'billings', 'pods', 'incidents', 'products']

/* --------------------- canonical data: AISIN milkrun demo --------------------- */
// Real Aisin inbound-milkrun network: 7 plants (kind:'plant') + 15 supplier lanes
// (deliveryPlantId + roundsPerDay), a Yusen 6W/10W fleet, and per-transporter
// rate cards (costProfile). Depot = the carrier's yard; Auto Route runs milkrun.

const partners = [{"id":"yusen","code":"YUSE","name":"Yusen Logistics","contactPerson":"","phone":"0-2000-0000","email":"ops@yusen.example","active":true,"ratePerKm":0,"ratePerTrip":0,"minCharge":0,"creditDays":30,"bankName":"Kasikornbank","bankAccountNo":"","bankAccountName":"Yusen Logistics","costProfile":{"6W":{"laborPerHr":100,"otPerHr":100,"dropCost":50,"allowancePerKm":0.71,"tripSafety":3,"fuelKmPerL":4.5,"fuelRatePerL":31.73,"otherPerDay":755.34,"adminPct":0.08},"10W":{"laborPerHr":100,"otPerHr":100,"dropCost":50,"allowancePerKm":0.71,"tripSafety":3,"fuelKmPerL":3.8,"fuelRatePerL":31.73,"otherPerDay":978.59,"adminPct":0.08}}},{"id":"ttk","code":"TTK","name":"TTK Logistics","contactPerson":"","phone":"0-2000-0001","email":"ops@ttk.example","active":true,"ratePerKm":0,"ratePerTrip":0,"minCharge":0,"creditDays":30,"bankName":"Kasikornbank","bankAccountNo":"","bankAccountName":"TTK Logistics","costProfile":{"6W":{"laborPerHr":165,"otPerHr":55,"dropCost":0,"allowancePerKm":0,"tripSafety":0,"fuelKmPerL":4.75,"fuelRatePerL":31.73,"otherPerDay":1119.07,"adminPct":0.1},"10W":{"laborPerHr":165,"otPerHr":55,"dropCost":0,"allowancePerKm":0,"tripSafety":0,"fuelKmPerL":4,"fuelRatePerL":31.73,"otherPerDay":1429.18,"adminPct":0.1}}},{"id":"karitsu","code":"KARI","name":"Karitsu Logistics","contactPerson":"","phone":"0-2000-0002","email":"ops@karitsu.example","active":true,"ratePerKm":0,"ratePerTrip":0,"minCharge":0,"creditDays":30,"bankName":"Kasikornbank","bankAccountNo":"","bankAccountName":"Karitsu Logistics","costProfile":{"6W":{"laborPerHr":105,"otPerHr":85,"dropCost":0,"allowancePerKm":4.73,"tripSafety":0,"fuelKmPerL":5.6,"fuelRatePerL":31.73,"otherPerDay":1091.49,"adminPct":0.1367},"10W":{"laborPerHr":105,"otPerHr":85,"dropCost":0,"allowancePerKm":0,"tripSafety":0,"fuelKmPerL":4.5,"fuelRatePerL":31.73,"otherPerDay":0,"adminPct":0.1367}}},{"id":"sankyu","code":"SANK","name":"Sankyu Logistics","contactPerson":"","phone":"0-2000-0003","email":"ops@sankyu.example","active":true,"ratePerKm":0,"ratePerTrip":0,"minCharge":0,"creditDays":30,"bankName":"Kasikornbank","bankAccountNo":"","bankAccountName":"Sankyu Logistics","costProfile":{"6W":{"laborPerHr":80,"otPerHr":145,"dropCost":125,"allowancePerKm":1.8,"tripSafety":4,"fuelKmPerL":4.8,"fuelRatePerL":31.73,"otherPerDay":1007.18,"adminPct":0.08},"10W":{"laborPerHr":80,"otPerHr":145,"dropCost":125,"allowancePerKm":1.8,"tripSafety":4,"fuelKmPerL":3.8,"fuelRatePerL":31.73,"otherPerDay":1304.8,"adminPct":0.08}}},{"id":"yok","code":"YOK","name":"YOK Logistics","contactPerson":"","phone":"0-2000-0004","email":"ops@yok.example","active":true,"ratePerKm":0,"ratePerTrip":0,"minCharge":0,"creditDays":30,"bankName":"Kasikornbank","bankAccountNo":"","bankAccountName":"YOK Logistics","costProfile":{"6W":{"laborPerHr":70,"otPerHr":70,"dropCost":50,"allowancePerKm":0,"tripSafety":0,"fuelKmPerL":4.2,"fuelRatePerL":31.73,"otherPerDay":1017,"adminPct":0.08},"10W":{"laborPerHr":70,"otPerHr":70,"dropCost":50,"allowancePerKm":0,"tripSafety":0,"fuelKmPerL":4.2,"fuelRatePerL":31.73,"otherPerDay":1309.69,"adminPct":0.08}}}]

const drivers = [{"id":"d1","code":"DRV-01","name":"Driver 1","nameTh":"พขร 1","licenseNo":"1-0000-00000","licenseType":"ท.2","phone":"08x-xxx-xx00","truckId":"6W-1","active":true},{"id":"d2","code":"DRV-02","name":"Driver 2","nameTh":"พขร 2","licenseNo":"1-0000-00001","licenseType":"ท.2","phone":"08x-xxx-xx01","truckId":"6W-2","active":true},{"id":"d3","code":"DRV-03","name":"Driver 3","nameTh":"พขร 3","licenseNo":"1-0000-00002","licenseType":"ท.2","phone":"08x-xxx-xx02","truckId":"6W-3","active":true},{"id":"d4","code":"DRV-04","name":"Driver 4","nameTh":"พขร 4","licenseNo":"1-0000-00003","licenseType":"ท.2","phone":"08x-xxx-xx03","truckId":"6W-4","active":true},{"id":"d5","code":"DRV-05","name":"Driver 5","nameTh":"พขร 5","licenseNo":"1-0000-00004","licenseType":"ท.2","phone":"08x-xxx-xx04","truckId":"6W-5","active":true},{"id":"d6","code":"DRV-06","name":"Driver 6","nameTh":"พขร 6","licenseNo":"1-0000-00005","licenseType":"ท.2","phone":"08x-xxx-xx05","truckId":"6W-6","active":true}]

const trucks = [{"id":"6W-1","plateNumber":"70-1001 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-2","plateNumber":"70-1002 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-3","plateNumber":"70-1003 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-4","plateNumber":"70-1004 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-5","plateNumber":"70-1005 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-6","plateNumber":"70-1006 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-7","plateNumber":"70-1007 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-8","plateNumber":"70-1008 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-9","plateNumber":"70-1009 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"6W-10","plateNumber":"70-1010 ชบ","type":"6W","partnerId":"yusen","capacityM3":35.37,"capacityKg":5000,"roundsPerDay":1,"fixedCostPerRound":500,"costPerKm":7.76,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"10W-1","plateNumber":"83-2001 รย","type":"10W","partnerId":"yusen","capacityM3":35.37,"capacityKg":14000,"roundsPerDay":1,"fixedCostPerRound":700,"costPerKm":9.06,"active":true,"assignmentMode":"dynamic","fixedStops":[]},{"id":"10W-2","plateNumber":"83-2002 รย","type":"10W","partnerId":"yusen","capacityM3":35.37,"capacityKg":14000,"roundsPerDay":1,"fixedCostPerRound":700,"costPerKm":9.06,"active":true,"assignmentMode":"dynamic","fixedStops":[]}]

const locations = [{"id":"plant-ATFB","code":"ATFB","name":"Aisin Takaoka Foundry Bangpakong Company Limited","nameTh":"ATFB","kind":"plant","zone":"AISIN Plant","lat":13.450155,"lng":101.031081,"demandM3":0,"demandKg":0,"serviceMinutes":0,"windowStart":"","windowEnd":"","deliveryDays":[],"active":true,"roundsPerDay":1},{"id":"plant-ISUZU","code":"ISUZU","name":"ISUZU LOGISTICS (THAILAND) CO.,LTD.","nameTh":"ISUZU","kind":"plant","zone":"AISIN Plant","lat":13.019151,"lng":101.176221,"demandM3":0,"demandKg":0,"serviceMinutes":0,"windowStart":"","windowEnd":"","deliveryDays":[],"active":true,"roundsPerDay":1},{"id":"plant-ATAC","code":"ATAC","name":"AISIN Thai Automotive Casting Co., Ltd.","nameTh":"ATAC","kind":"plant","zone":"AISIN Plant","lat":14.057385,"lng":101.844344,"demandM3":0,"demandKg":0,"serviceMinutes":0,"windowStart":"","windowEnd":"","deliveryDays":[],"active":true,"roundsPerDay":1},{"id":"plant-SA","code":"SA","name":"Siam Aisin Co., Ltd.","nameTh":"SA","kind":"plant","zone":"AISIN Plant","lat":13.90244,"lng":101.564042,"demandM3":0,"demandKg":0,"serviceMinutes":0,"windowStart":"","windowEnd":"","deliveryDays":[],"active":true,"roundsPerDay":1},{"id":"plant-TYC","code":"TYC","name":"Thai Yoshimoto Coating Co.,Ltd.","nameTh":"TYC","kind":"plant","zone":"AISIN Plant","lat":13.091415,"lng":101.057311,"demandM3":0,"demandKg":0,"serviceMinutes":0,"windowStart":"","windowEnd":"","deliveryDays":[],"active":true,"roundsPerDay":1},{"id":"plant-ADV","code":"ADV","name":"ADVICS Manufacturing (Thailand) Co., Ltd.","nameTh":"ADV","kind":"plant","zone":"AISIN Plant","lat":13.100922,"lng":101.057057,"demandM3":0,"demandKg":0,"serviceMinutes":0,"windowStart":"","windowEnd":"","deliveryDays":[],"active":true,"roundsPerDay":1},{"id":"plant-ACT","code":"ACT","name":"AISIN Chemical (Thailand) Co., Ltd.","nameTh":"ACT","kind":"plant","zone":"AISIN Plant","lat":12.872461,"lng":101.339089,"demandM3":0,"demandKg":0,"serviceMinutes":0,"windowStart":"","windowEnd":"","deliveryDays":[],"active":true,"roundsPerDay":1},{"id":"ai1","code":"NAKAGAWA-1","name":"NAKAGAWA → ATFB","nameTh":"NAKAGAWA → ATFB","kind":"supplier","zone":"ATFB","lat":13.009738,"lng":101.190601,"demandM3":7.15,"demandKg":1662,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":3,"deliveryPlantId":"plant-ATFB"},{"id":"ai2","code":"KPTH-2","name":"KPTH → ATFB","nameTh":"KPTH → ATFB","kind":"supplier","zone":"ATFB","lat":13.113763,"lng":101.032798,"demandM3":9.96,"demandKg":1422,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":3,"deliveryPlantId":"plant-ATFB"},{"id":"ai3","code":"ATFB-3","name":"ATFB → ISUZU","nameTh":"ATFB → ISUZU","kind":"supplier","zone":"ISUZU","lat":13.450155,"lng":101.031081,"demandM3":3.16,"demandKg":1488,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-ISUZU"},{"id":"ai4","code":"ISUZU-4","name":"ISUZU → ATFB","nameTh":"ISUZU → ATFB","kind":"supplier","zone":"ATFB","lat":13.019151,"lng":101.176221,"demandM3":3.16,"demandKg":1488,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-ATFB"},{"id":"ai5","code":"SANKO-5","name":"SANKO → ATAC","nameTh":"SANKO → ATAC","kind":"supplier","zone":"ATAC","lat":14.328801,"lng":100.66413,"demandM3":24.96,"demandKg":4850,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":2,"deliveryPlantId":"plant-ATAC"},{"id":"ai6","code":"UYEMURA-6","name":"UYEMURA → SA","nameTh":"UYEMURA → SA","kind":"supplier","zone":"SA","lat":14.126118,"lng":100.590097,"demandM3":8.37,"demandKg":500,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-SA"},{"id":"ai7","code":"TAKEI-7","name":"TAKEI → SA","nameTh":"TAKEI → SA","kind":"supplier","zone":"SA","lat":14.198881,"lng":100.590277,"demandM3":4.66,"demandKg":1030,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-SA"},{"id":"ai8","code":"KOJIMA-8","name":"KOJIMA → SA","nameTh":"KOJIMA → SA","kind":"supplier","zone":"SA","lat":13.847601,"lng":101.518629,"demandM3":1.58,"demandKg":500,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-SA"},{"id":"ai9","code":"TTTC-9","name":"TTTC → SA","nameTh":"TTTC → SA","kind":"supplier","zone":"SA","lat":13.917594,"lng":101.648838,"demandM3":7.99,"demandKg":1200,"serviceMinutes":20,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-SA"},{"id":"ai10","code":"TTTC-10","name":"TTTC → ATAC","nameTh":"TTTC → ATAC","kind":"supplier","zone":"ATAC","lat":13.917594,"lng":101.648838,"demandM3":7.99,"demandKg":1310,"serviceMinutes":20,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-ATAC"},{"id":"ai11","code":"ADV-11","name":"ADV → TYC","nameTh":"ADV → TYC","kind":"supplier","zone":"TYC","lat":13.100922,"lng":101.057057,"demandM3":3.24,"demandKg":1840,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":2,"deliveryPlantId":"plant-TYC"},{"id":"ai12","code":"TYC-12","name":"TYC → ADV","nameTh":"TYC → ADV","kind":"supplier","zone":"ADV","lat":13.091415,"lng":101.057311,"demandM3":3.24,"demandKg":1840,"serviceMinutes":20,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":2,"deliveryPlantId":"plant-ADV"},{"id":"ai13","code":"NICHIAS-13","name":"NICHIAS → ADV","nameTh":"NICHIAS → ADV","kind":"supplier","zone":"ADV","lat":13.577687,"lng":100.922301,"demandM3":0.93,"demandKg":404.49,"serviceMinutes":20,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-ADV"},{"id":"ai14","code":"OHARA-14","name":"OHARA → ACT","nameTh":"OHARA → ACT","kind":"supplier","zone":"ACT","lat":13.571086,"lng":100.942536,"demandM3":2.66,"demandKg":3000,"serviceMinutes":20,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-ACT"},{"id":"ai15","code":"ITOCHU-15","name":"ITOCHU → ACT","nameTh":"ITOCHU → ACT","kind":"supplier","zone":"ACT","lat":13.568033,"lng":100.944226,"demandM3":5.32,"demandKg":1000,"serviceMinutes":30,"windowStart":"08:00","windowEnd":"17:00","deliveryDays":[],"active":true,"roundsPerDay":1,"deliveryPlantId":"plant-ACT"}]

const products = []

const settings = {"language":"en","theme":"light","mapboxToken":"","depotName":"Yusen Transport Yard (Bowin)","depotLat":13.010212,"depotLng":101.067651,"avgSpeedKmh":50,"planStartTime":"08:00","optimizeObjective":"cost","useRoadGeometry":true,"dieselPricePerLiter":31.73,"fuelConsumptionKmPerL":4.5,"co2KgPerLiter":2.68,"companyName":"AISIN (Thailand) Co., Ltd.","companyTaxId":"0-1055-00000-00-0","companyAddress":"Amata City / Eastern Seaboard Industrial Estate, Chonburi–Rayong, Thailand","role":"admin"}

export const SEED = { partners, trucks, drivers, locations, products, billings: [], pods: [], incidents: [], settings }

/* --------------------------- insertion --------------------------- */

async function insertSeed(pool) {
  const arrays = { partners, trucks, drivers, locations, billings: [], pods: [], incidents: [], products }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const table of ENTITY_TABLES) {
      await client.query(`DELETE FROM ${table}`)
      for (const item of arrays[table] ?? []) {
        await client.query(`INSERT INTO ${table} (id, doc) VALUES ($1, $2)`, [
          String(item.id),
          JSON.stringify(item),
        ])
      }
    }
    for (const [key, doc] of [['settings', settings], ['plan', null], ['audit', []]]) {
      await client.query(
        `INSERT INTO singletons (key, doc) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc`,
        [key, JSON.stringify(doc)],
      )
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Seed the database only if it is currently empty. Returns true if it seeded. */
export async function seedIfEmpty(pool) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM partners')
  if (rows[0].n > 0) return false
  await insertSeed(pool)
  return true
}

/** Force a full wipe + reseed (used by the /api/seed endpoint and CLI --force). */
export async function reseed(pool) {
  await insertSeed(pool)
}

/* --------------------------- CLI entry --------------------------- */

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const conn = (process.env.DATABASE_URL || '').replace(/&?channel_binding=require/, '')
  if (!conn) {
    console.error('DATABASE_URL is not set. Run: node --env-file=.env server/seed.mjs')
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString: conn, ssl: { rejectUnauthorized: false }, max: 3 })
  // Ensure tables exist before seeding.
  for (const table of ENTITY_TABLES) {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, doc jsonb NOT NULL)`)
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS singletons (key text PRIMARY KEY, doc jsonb)`)

  const force = process.argv.includes('--force')
  if (force) {
    await insertSeed(pool)
    console.log('Reseeded Neon (forced).')
  } else {
    const did = await seedIfEmpty(pool)
    console.log(did ? 'Seeded Neon (was empty).' : 'Neon already has data — no changes (use --force to reseed).')
  }
  const counts = {}
  for (const t of ENTITY_TABLES) counts[t] = (await pool.query(`SELECT COUNT(*)::int n FROM ${t}`)).rows[0].n
  console.log('Row counts:', counts)
  await pool.end()
}
