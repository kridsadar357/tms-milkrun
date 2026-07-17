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

/* --------------------------- canonical data --------------------------- */

const partners = [
  { id: 'p1', code: 'SLG', name: 'Siam Logistics Co., Ltd.', contactPerson: 'Somchai P.', phone: '081-234-5678', email: 'ops@siamlogistics.example', active: true, ratePerKm: 11, ratePerTrip: 0, minCharge: 2000, creditDays: 30, bankName: 'Kasikornbank', bankAccountNo: '012-3-45678-9', bankAccountName: 'Siam Logistics Co., Ltd.' },
  { id: 'p2', code: 'ETC', name: 'Eastern Transport Co., Ltd.', contactPerson: 'Kanokwan S.', phone: '089-876-5432', email: 'dispatch@easterntrans.example', active: true, ratePerKm: 0, ratePerTrip: 0, minCharge: 0, creditDays: 45, bankName: 'Bangkok Bank', bankAccountNo: '234-5-67890-1', bankAccountName: 'Eastern Transport Co., Ltd.' },
  { id: 'p3', code: 'TME', name: 'Thai Milkrun Express', contactPerson: 'Anan W.', phone: '086-555-1122', email: 'contact@thaimilkrun.example', active: true, ratePerKm: 0, ratePerTrip: 900, minCharge: 0, creditDays: 15, bankName: 'SCB', bankAccountNo: '345-6-78901-2', bankAccountName: 'Thai Milkrun Express Ltd.' },
]

const drivers = [
  { id: 'd1', code: 'DRV-01', name: 'Somsak Jaidee', nameTh: 'สมศักดิ์ ใจดี', licenseNo: '1-2345-67890', licenseType: 'ท.2', phone: '081-111-2233', truckId: 't1', active: true },
  { id: 'd2', code: 'DRV-02', name: 'Prasit Rungruang', nameTh: 'ประสิทธิ์ รุ่งเรือง', licenseNo: '1-3456-78901', licenseType: 'ท.2', phone: '082-222-3344', truckId: 't2', active: true },
  { id: 'd3', code: 'DRV-03', name: 'Wichai Thongdee', nameTh: 'วิชัย ทองดี', licenseNo: '1-4567-89012', licenseType: 'บ.2', phone: '083-333-4455', truckId: 't3', active: true },
  { id: 'd4', code: 'DRV-04', name: 'Narong Sukjai', nameTh: 'ณรงค์ สุขใจ', licenseNo: '1-5678-90123', licenseType: 'ท.2', phone: '084-444-5566', truckId: 't4', active: true },
]

const trucks = [
  { id: 't1', plateNumber: '70-1234 ชบ', type: '6W', partnerId: 'p1', capacityM3: 22, capacityKg: 5500, roundsPerDay: 2, fixedCostPerRound: 1200, costPerKm: 10, active: true },
  { id: 't2', plateNumber: '70-5678 ชบ', type: '6W', partnerId: 'p1', capacityM3: 22, capacityKg: 5500, roundsPerDay: 2, fixedCostPerRound: 1200, costPerKm: 10, active: true },
  { id: 't3', plateNumber: '83-4455 รย', type: '10W', partnerId: 'p2', capacityM3: 38, capacityKg: 12000, roundsPerDay: 1, fixedCostPerRound: 1800, costPerKm: 14, active: true },
  { id: 't4', plateNumber: '1ฒค-9012 กท', type: '4W', partnerId: 'p3', capacityM3: 8, capacityKg: 2000, roundsPerDay: 3, fixedCostPerRound: 800, costPerKm: 7, active: true },
]

const locations = [
  { id: 'l1', code: 'SUP-01', name: 'Amata City Chonburi — Stamping Parts', nameTh: 'อมตะซิตี้ ชลบุรี — ชิ้นส่วนปั๊มขึ้นรูป', kind: 'supplier', zone: 'Chonburi', lat: 13.1802, lng: 100.9436, demandM3: 6, demandKg: 1500, serviceMinutes: 20, windowStart: '', windowEnd: '', deliveryDays: [], active: true },
  { id: 'l2', code: 'SUP-02', name: 'Amata City Chonburi — Plastic Injection', nameTh: 'อมตะซิตี้ ชลบุรี — ชิ้นส่วนพลาสติก', kind: 'supplier', zone: 'Chonburi', lat: 13.1650, lng: 100.9605, demandM3: 4.5, demandKg: 600, serviceMinutes: 15, windowStart: '', windowEnd: '', deliveryDays: [], active: true },
  { id: 'l3', code: 'SUP-03', name: 'Pinthong 1 — Rubber Parts', nameTh: 'ปิ่นทอง 1 — ชิ้นส่วนยาง', kind: 'supplier', zone: 'Chonburi', lat: 13.0736, lng: 100.9797, demandM3: 3, demandKg: 800, serviceMinutes: 15, windowStart: '', windowEnd: '', deliveryDays: [], active: true },
  { id: 'l4', code: 'SUP-04', name: 'Pinthong 3 — Fasteners', nameTh: 'ปิ่นทอง 3 — สลักภัณฑ์', kind: 'supplier', zone: 'Chonburi', lat: 13.0508, lng: 101.0102, demandM3: 2, demandKg: 1800, serviceMinutes: 15, windowStart: '', windowEnd: '', deliveryDays: [], active: true },
  { id: 'l5', code: 'SUP-05', name: 'Laem Chabang IE — Electronics', nameTh: 'แหลมฉบัง — ชิ้นส่วนอิเล็กทรอนิกส์', kind: 'supplier', zone: 'Laem Chabang', lat: 13.0827, lng: 100.9145, demandM3: 5, demandKg: 700, serviceMinutes: 20, windowStart: '', windowEnd: '', deliveryDays: [], active: true },
  { id: 'l6', code: 'SUP-06', name: 'Eastern Seaboard IE — Machined Parts', nameTh: 'อีสเทิร์นซีบอร์ด — ชิ้นส่วนแมชชีน', kind: 'supplier', zone: 'Rayong', lat: 12.9846, lng: 101.1136, demandM3: 7, demandKg: 2500, serviceMinutes: 25, windowStart: '', windowEnd: '', deliveryDays: [1, 3, 5], active: true },
  { id: 'l7', code: 'SUP-07', name: 'WHA ESIE 1 — Die Casting', nameTh: 'ดับบลิวเอชเอ อีสเทิร์นซีบอร์ด 1 — ไดคาสติ้ง', kind: 'supplier', zone: 'Rayong', lat: 12.9558, lng: 101.1290, demandM3: 4, demandKg: 3200, serviceMinutes: 20, windowStart: '', windowEnd: '', deliveryDays: [2, 4], active: true },
  { id: 'l8', code: 'SUP-08', name: 'Amata City Rayong — Wire Harness', nameTh: 'อมตะซิตี้ ระยอง — ชุดสายไฟ', kind: 'supplier', zone: 'Rayong', lat: 12.9970, lng: 101.0730, demandM3: 5.5, demandKg: 900, serviceMinutes: 20, windowStart: '', windowEnd: '', deliveryDays: [], active: true },
  { id: 'l9', code: 'SUP-09', name: 'Bowin — Sintered Parts', nameTh: 'บ่อวิน — ชิ้นส่วนซินเตอร์', kind: 'supplier', zone: 'Bowin', lat: 13.0530, lng: 101.0850, demandM3: 2.5, demandKg: 2100, serviceMinutes: 15, windowStart: '', windowEnd: '', deliveryDays: [1, 3, 5], active: true },
  { id: 'l10', code: 'SUP-10', name: 'Sriracha — Springs & Dampers', nameTh: 'ศรีราชา — สปริงและโช้ค', kind: 'supplier', zone: 'Sriracha', lat: 13.1590, lng: 100.9210, demandM3: 3.5, demandKg: 1200, serviceMinutes: 15, windowStart: '', windowEnd: '', deliveryDays: [], active: true },
  { id: 'l11', code: 'WH-01', name: 'Laem Chabang Port — Export CY', nameTh: 'ท่าเรือแหลมฉบัง — ลานตู้ส่งออก', kind: 'warehouse', zone: 'Laem Chabang', lat: 13.0700, lng: 100.8890, demandM3: 8, demandKg: 4000, serviceMinutes: 30, windowStart: '08:00', windowEnd: '16:00', deliveryDays: [], active: true },
  { id: 'l12', code: 'CUS-01', name: 'Toyota Ban Pho Plant', nameTh: 'โรงงานโตโยต้า บ้านโพธิ์', kind: 'customer', zone: 'Chachoengsao', lat: 13.5960, lng: 101.0680, demandM3: 6, demandKg: 2000, serviceMinutes: 30, windowStart: '09:00', windowEnd: '15:00', deliveryDays: [1, 2, 3, 4, 5], active: true },
]

const products = [
  { id: 'p_s1_1', code: 'SKU-STMP-101', name: 'Hood Panel Pallet', nameTh: 'พาเลทแผงฝากระโปรง', supplierId: 'l1', width: 1.0, length: 1.2, height: 1.0, weight: 150, active: true, palletType: 'wooden', unitsPerPallet: 4 },
  { id: 'p_s1_2', code: 'SKU-STMP-102', name: 'Door Outer Panel', nameTh: 'พาเลทแผงประตูนอก', supplierId: 'l1', width: 0.8, length: 1.2, height: 0.9, weight: 120, active: true, palletType: 'wooden', unitsPerPallet: 4 },
  { id: 'p_s2_1', code: 'SKU-PLAS-201', name: 'Front Bumper Cover Box', nameTh: 'กล่องกันชนหน้า', supplierId: 'l2', width: 0.6, length: 1.8, height: 0.6, weight: 22, active: true, palletType: 'plastic', unitsPerPallet: 6 },
  { id: 'p_s2_2', code: 'SKU-PLAS-202', name: 'Dashboard Core Module', nameTh: 'พาเลทโครงแดชบอร์ด', supplierId: 'l2', width: 0.8, length: 1.4, height: 1.0, weight: 45, active: true, palletType: 'wooden', unitsPerPallet: 2 },
  { id: 'p_s3_1', code: 'SKU-RUBB-301', name: 'Engine Mount Bushings Box', nameTh: 'กล่องยางแท่นเครื่อง', supplierId: 'l3', width: 0.6, length: 0.6, height: 0.6, weight: 35, active: true, palletType: 'none', unitsPerPallet: 1 },
  { id: 'p_s4_1', code: 'SKU-FAST-401', name: 'High-Tensile Bolts Heavy Box', nameTh: 'กล่องสลักเกลียวทนแรงดึงสูง', supplierId: 'l4', width: 0.4, length: 0.4, height: 0.4, weight: 180, active: true, palletType: 'none', unitsPerPallet: 1 },
  { id: 'p_s5_1', code: 'SKU-ELEC-501', name: 'Engine Control Unit (ECU) Box', nameTh: 'กล่องควบคุมเครื่องยนต์ (ECU)', supplierId: 'l5', width: 0.5, length: 0.5, height: 0.4, weight: 15, active: true, palletType: 'none', unitsPerPallet: 1 },
  { id: 'p_s5_2', code: 'SKU-ELEC-502', name: 'Wiring Harness Assembly', nameTh: 'พาเลทชุดสายไฟรถยนต์', supplierId: 'l5', width: 1.0, length: 1.0, height: 1.2, weight: 75, active: true, palletType: 'plastic', unitsPerPallet: 4 },
  { id: 'p_s6_1', code: 'SKU-MACH-601', name: 'Brake Rotor Pallet', nameTh: 'พาเลทจานเบรก', supplierId: 'l6', width: 0.8, length: 0.8, height: 0.8, weight: 240, active: true, palletType: 'wooden', unitsPerPallet: 8 },
  { id: 'p_s7_1', code: 'SKU-CAST-701', name: 'Aluminum Transmission Case', nameTh: 'พาเลทเสื้อเกียร์อลูมิเนียม', supplierId: 'l7', width: 1.0, length: 1.2, height: 0.9, weight: 160, active: true, palletType: 'wooden', unitsPerPallet: 4 },
  { id: 'p_s8_1', code: 'SKU-WIRE-801', name: 'Battery Cable Harness Box', nameTh: 'กล่องสายไฟแบตเตอรี่', supplierId: 'l8', width: 0.6, length: 0.6, height: 0.6, weight: 28, active: true, palletType: 'none', unitsPerPallet: 1 },
  { id: 'p_s9_1', code: 'SKU-SINT-901', name: 'Sintered Gear Sprocket Heavy Box', nameTh: 'กล่องเฟืองขับเหล็กซินเตอร์', supplierId: 'l9', width: 0.4, length: 0.4, height: 0.4, weight: 110, active: true, palletType: 'none', unitsPerPallet: 1 },
  { id: 'p_s10_1', code: 'SKU-SPRG-001', name: 'Coil Spring Rack', nameTh: 'ชั้นวางคอยล์สปริง', supplierId: 'l10', width: 0.8, length: 1.2, height: 1.1, weight: 195, active: true, palletType: 'wooden', unitsPerPallet: 6 },
]

const settings = {
  language: 'en',
  theme: 'light',
  mapboxToken: '', // client falls back to VITE_MAPBOX_TOKEN
  depotName: 'AISIN Plant — Amata City Chonburi',
  depotLat: 13.1544,
  depotLng: 100.9319,
  avgSpeedKmh: 45,
  useRoadGeometry: true,
  dieselPricePerLiter: 32,
  fuelConsumptionKmPerL: 4,
  co2KgPerLiter: 2.68,
  companyName: 'AISIN (Thailand) Co., Ltd.',
  companyTaxId: '0-1055-00000-00-0',
  companyAddress: '700/1 Amata City Chonburi Industrial Estate, Chonburi 20000, Thailand',
  role: 'admin',
}

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
