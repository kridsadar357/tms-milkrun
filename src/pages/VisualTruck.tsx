import { useEffect, useState, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, Navigation, Play, Check, Trash2, Layers, Info, RotateCcw,
  RotateCw, Pause, Search
} from 'lucide-react'
import { useTms } from '../store'
import { PageHeader, Badge, Button, Modal } from '../components/ui'
import type { TruckType, Product } from '../types'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// Truck Dimensions (meters)
interface Dimensions {
  width: number
  length: number
  height: number
}

const TRUCK_DIMENSIONS: Record<TruckType, Dimensions> = {
  '4W': { width: 1.7, length: 3.0, height: 1.8 },
  '4WJ': { width: 1.8, length: 4.2, height: 2.0 },
  '6W': { width: 2.2, length: 5.5, height: 2.2 },
  '10W': { width: 2.4, length: 7.2, height: 2.5 },
  Trailer: { width: 2.4, length: 12.0, height: 2.5 },
}

interface AxleInfo {
  emptyWeight: number
  wheelbase: number
  axleFrontEmpty: number
  axleRearEmpty: number
  frontAxleLimit: number
  rearAxleLimit: number
  frontAxlePos: number       // relative to cabin z=0 (typically forward, so negative)
  rearAxlePosPct: number     // relative position along cargo bed length L (e.g. 0.7)
}

const AXLE_PRESETS: Record<TruckType, AxleInfo> = {
  '4W': {
    emptyWeight: 1800,
    wheelbase: 2.5,
    axleFrontEmpty: 1000,
    axleRearEmpty: 800,
    frontAxleLimit: 2500,
    rearAxleLimit: 3000,
    frontAxlePos: -0.8,
    rearAxlePosPct: 0.75
  },
  '4WJ': {
    emptyWeight: 2200,
    wheelbase: 3.0,
    axleFrontEmpty: 1200,
    axleRearEmpty: 1000,
    frontAxleLimit: 3000,
    rearAxleLimit: 4000,
    frontAxlePos: -0.9,
    rearAxlePosPct: 0.72
  },
  '6W': {
    emptyWeight: 4000,
    wheelbase: 4.2,
    axleFrontEmpty: 2400,
    axleRearEmpty: 1600,
    frontAxleLimit: 5000,
    rearAxleLimit: 8000,
    frontAxlePos: -1.0,
    rearAxlePosPct: 0.7
  },
  '10W': {
    emptyWeight: 8000,
    wheelbase: 5.5,
    axleFrontEmpty: 4500,
    axleRearEmpty: 3500,
    frontAxleLimit: 6500,
    rearAxleLimit: 18000,
    frontAxlePos: -1.2,
    rearAxlePosPct: 0.68
  },
  'Trailer': {
    emptyWeight: 14000,
    wheelbase: 9.0,
    axleFrontEmpty: 6000,
    axleRearEmpty: 8000,
    frontAxleLimit: 7000,
    rearAxleLimit: 24000,
    frontAxlePos: -1.5,
    rearAxlePosPct: 0.72
  }
}

interface Package {
  id: string
  supplierId: string
  supplierCode: string
  supplierName: string
  supplierNameTh: string
  stopSeq: number
  color: string
  w: number // width (x)
  l: number // length (z)
  h: number // height (y)
  volume: number
  weight: number
  isLoaded: boolean
  x: number // pos in truck container (0 to W)
  y: number // pos in truck container (0 to H - floor to ceiling)
  z: number // pos in truck container (0 to L - cabin to door)
  palletType?: 'wooden' | 'plastic' | 'none'
  unitsPerPallet?: number
  isPalletized?: boolean
}

// Compute exact dims and weights based on whether the product is palletized
const getPalletizedDimensions = (prod: Product, truckHeight: number) => {
  if (!prod.palletType || prod.palletType === 'none') {
    return {
      w: prod.width,
      l: prod.length,
      h: prod.height,
      weight: prod.weight,
      isPalletized: false,
      palletType: 'none' as const,
      unitsPerPallet: 1,
      numLayers: 0,
      boxesPerLayer: 0,
      nx: 0,
      nz: 0,
      boxW: prod.width,
      boxL: prod.length,
      boxH: prod.height,
      boxWeight: prod.weight
    }
  }

  const palletW = 1.0
  const palletL = 1.2
  const palletH = 0.15
  const palletWeight = prod.palletType === 'wooden' ? 20 : 15

  const boxW = prod.width
  const boxL = prod.length
  const boxH = prod.height
  const boxWeight = prod.weight
  const units = prod.unitsPerPallet || 1

  // Choose orientation
  const nx1 = Math.max(1, Math.floor(palletW / boxW))
  const nz1 = Math.max(1, Math.floor(palletL / boxL))
  const capacity1 = nx1 * nz1

  const nx2 = Math.max(1, Math.floor(palletW / boxL))
  const nz2 = Math.max(1, Math.floor(palletL / boxW))
  const capacity2 = nx2 * nz2

  let nx = nx1
  let nz = nz1
  let finalBoxW = boxW
  let finalBoxL = boxL
  
  if (capacity2 > capacity1) {
    nx = nx2
    nz = nz2
    finalBoxW = boxL
    finalBoxL = boxW
  }

  const boxesPerLayer = nx * nz
  const numLayers = Math.ceil(units / boxesPerLayer)
  
  // Cap layers so total height <= truckHeight - 0.05 safety margin
  const maxHAllowed = truckHeight - 0.05
  const maxLayers = Math.max(1, Math.floor((maxHAllowed - palletH) / boxH))
  const finalLayers = Math.min(numLayers, maxLayers)
  const finalUnits = Math.min(units, finalLayers * boxesPerLayer)

  const finalH = palletH + (finalLayers * boxH)
  const finalWeight = palletWeight + (boxWeight * finalUnits)

  return {
    w: palletW,
    l: palletL,
    h: finalH,
    weight: finalWeight,
    isPalletized: true,
    palletType: prod.palletType,
    unitsPerPallet: finalUnits,
    numLayers: finalLayers,
    boxesPerLayer,
    nx,
    nz,
    boxW: finalBoxW,
    boxL: finalBoxL,
    boxH,
    boxWeight
  }
}

interface LifoViolation {
  earlyPkg: Package
  latePkg: Package
}

// Generate standard mock packages for manual mode
const generateManualPackages = (truckType: TruckType, products: Product[]): Package[] => {
  const dim = TRUCK_DIMENSIONS[truckType]
  const pkgs: Package[] = []
  
  const colors = [
    '#10b981', // Emerald
    '#3b82f6', // Blue
    '#6366f1', // Indigo
    '#f59e0b', // Amber
    '#ec4899', // Pink
    '#14b8a6', // Teal
  ]

  const activeProds = products.filter(p => p.active)
  
  if (activeProds.length > 0) {
    // Generate cargo using actual active products from the master data
    activeProds.forEach((prod, i) => {
      const color = colors[i % colors.length]
      const stopSeq = Math.floor(i / 2) + 1
      
      const maxCount = truckType === '4W' || truckType === '4WJ' ? 1 : 2
      for (let k = 0; k < maxCount; k++) {
        const palletInfo = getPalletizedDimensions(prod, dim.height)
        let w = palletInfo.w
        let l = palletInfo.l
        let h = palletInfo.h
        
        if (dim.width < w) w = dim.width - 0.1
        if (dim.length < l) l = dim.length - 0.1
        if (dim.height < h) h = dim.height - 0.1
        
        pkgs.push({
          id: `pkg-manual-${prod.id}-${k}`,
          supplierId: prod.supplierId,
          supplierCode: prod.code,
          supplierName: prod.name,
          supplierNameTh: prod.nameTh,
          stopSeq,
          color,
          w: Math.round(w * 100) / 100,
          l: Math.round(l * 100) / 100,
          h: Math.round(h * 100) / 100,
          volume: Math.round(w * l * h * 100) / 100,
          weight: palletInfo.weight,
          isLoaded: false,
          x: 0,
          y: 0,
          z: 0,
          palletType: prod.palletType,
          unitsPerPallet: palletInfo.unitsPerPallet,
          isPalletized: palletInfo.isPalletized
        })
      }
    })
    return pkgs
  }

  // Fallback if no products exist
  const counts: Record<TruckType, number> = {
    '4W': 6,
    '4WJ': 8,
    '6W': 12,
    '10W': 16,
    'Trailer': 24,
  }
  
  const count = counts[truckType]
  for (let i = 0; i < count; i++) {
    const stopSeq = Math.floor(i / 2) + 1
    const color = colors[(stopSeq - 1) % colors.length]
    
    let w = 0.8, l = 1.0, h = 1.0 // standard pallet
    if (i % 3 === 1) {
      w = 0.6; l = 0.6; h = 0.6 // small box
    } else if (i % 3 === 2) {
      w = 1.0; l = 1.2; h = 1.2 // large pallet
    }

    if (dim.width < w) w = dim.width - 0.2
    if (dim.length < l) l = 1.0
    
    const vol = w * l * h
    const weight = Math.round(vol * 200 + (Math.random() * 50)) // ~200kg per m3
    
    pkgs.push({
      id: `pkg-manual-${i + 1}`,
      supplierId: `SUP-M0${stopSeq}`,
      supplierCode: `SUP-0${stopSeq}`,
      supplierName: `Supplier Stop ${stopSeq}`,
      supplierNameTh: `ซัพพลายเออร์ จุดที่ ${stopSeq}`,
      stopSeq,
      color,
      w,
      l,
      h,
      volume: Math.round(vol * 100) / 100,
      weight,
      isLoaded: false,
      x: 0,
      y: 0,
      z: 0
    })
  }
  return pkgs
}

// Helper to verify if a package bottom is sufficiently supported (at least 50% area)
const checkSupportArea = (
  x: number,
  z: number,
  w: number,
  l: number,
  y: number,
  otherBoxes: Package[],
  verticalTolerance = 0.08
): boolean => {
  if (y <= 0.05) return true // on the floor

  let supportedPoints = 0
  const totalPoints = 25

  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const px = x + (w * col) / 4
      const pz = z + (l * row) / 4

      let pointSupported = false
      for (const other of otherBoxes) {
        if (!other.isLoaded) continue
        const isUnder = Math.abs((other.y + other.h) - y) < verticalTolerance
        if (isUnder) {
          const insideX = px >= other.x - 0.01 && px <= other.x + other.w + 0.01
          const insideZ = pz >= other.z - 0.01 && pz <= other.z + other.l + 0.01
          if (insideX && insideZ) {
            pointSupported = true
            break
          }
        }
      }
      if (pointSupported) supportedPoints++
    }
  }

  return supportedPoints / totalPoints >= 0.5
}

// Stacking & placement check helper
const checkPlacementStatus = (pkg: Package, allPkgs: Package[], W: number, H: number, L: number) => {
  if (!pkg.isLoaded) return { valid: true, reason: '' as 'out-of-bounds' | 'floating' | 'collision' | '' }
  
  // 1. Out of bounds check
  if (pkg.x < -0.01 || pkg.x + pkg.w > W + 0.01 || 
      pkg.y < -0.01 || pkg.y + pkg.h > H + 0.01 || 
      pkg.z < -0.01 || pkg.z + pkg.l > L + 0.01) {
    return { valid: false, reason: 'out-of-bounds' as const }
  }
  
  // 2. Stacking support validation (needs floor or a box underneath)
  if (pkg.y > 0.05) {
    const otherLoaded = allPkgs.filter(p => p.isLoaded && p.id !== pkg.id)
    const isSupported = checkSupportArea(pkg.x, pkg.z, pkg.w, pkg.l, pkg.y, otherLoaded, 0.08)
    if (!isSupported) {
      return { valid: false, reason: 'floating' as const }
    }
  }
  
  // 3. Collision / overlap check
  const otherLoaded = allPkgs.filter(p => p.isLoaded && p.id !== pkg.id)
  for (const other of otherLoaded) {
    const overlapX = (pkg.x < other.x + other.w - 0.02) && (pkg.x + pkg.w > other.x + 0.02)
    const overlapY = (pkg.y < other.y + other.h - 0.02) && (pkg.y + pkg.h > other.y + 0.02)
    const overlapZ = (pkg.z < other.z + other.l - 0.02) && (pkg.z + pkg.l > other.z + 0.02)
    if (overlapX && overlapY && overlapZ) {
      return { valid: false, reason: 'collision' as const }
    }
  }
  
  return { valid: true, reason: '' as const }
}

export default function VisualTruck() {
  const { t, i18n } = useTranslation()
  const { plan, trucks, locations, products } = useTms()
  
  // Selection States
  const [selectedRouteId, setSelectedRouteId] = useState<string>('')
  const [manualTruckType, setManualTruckType] = useState<TruckType>('6W')
  
  // Loaded Packages State
  const [packages, setPackages] = useState<Package[]>([])
  
  // Selected Package in UI
  const [selectedPkgId, setSelectedPkgId] = useState<string | null>(null)
  const [activePreviewImage, setActivePreviewImage] = useState<string | null>(null)
  
  // ThreeJS Canvas Container Reference
  const containerRef = useRef<HTMLDivElement>(null)
  
  // ThreeJS objects in Ref to communicate between React state and animation loop
  const sceneRef = useRef<THREE.Scene | null>(null)
  const meshesRef = useRef<Map<string, THREE.Object3D>>(new Map())
  const draggedMeshRef = useRef<THREE.Object3D | null>(null)
  const isDraggingRef = useRef<boolean>(false)
  const controlsRef = useRef<OrbitControls | null>(null)
  
  // Helper plane for raycast calculations
  const dragPlaneRef = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0))
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const intersectionRef = useRef<THREE.Vector3>(new THREE.Vector3())

  // Unload Animation States
  const [unloadState, setUnloadState] = useState<'idle' | 'running'>('idle')
  const [animQueue, setAnimQueue] = useState<string[]>([])
  const [animIndex, setAnimIndex] = useState<number>(-1)
  const [animOffsetZ, setAnimOffsetZ] = useState<number>(0)

  const [cargoSearch, setCargoSearch] = useState('')
  const [cargoStatusFilter, setCargoStatusFilter] = useState<'all' | 'loaded' | 'unloaded'>('all')
  const [cargoPage, setCargoPage] = useState(1)
  const itemsPerPage = 50

  const filteredPackages = useMemo(() => {
    return packages.filter(p => {
      const q = cargoSearch.toLowerCase().trim()
      const matchesSearch = q === '' ||
        p.supplierCode.toLowerCase().includes(q) ||
        p.supplierName.toLowerCase().includes(q) ||
        p.supplierNameTh.toLowerCase().includes(q)

      const matchesStatus = 
        cargoStatusFilter === 'all' ||
        (cargoStatusFilter === 'loaded' && p.isLoaded) ||
        (cargoStatusFilter === 'unloaded' && !p.isLoaded)

      return matchesSearch && matchesStatus
    })
  }, [packages, cargoSearch, cargoStatusFilter])

  const totalPages = Math.max(1, Math.ceil(filteredPackages.length / itemsPerPage))

  useEffect(() => {
    if (cargoPage > totalPages) {
      setCargoPage(1)
    }
  }, [filteredPackages.length, totalPages, cargoPage])

  const paginatedPackages = useMemo(() => {
    const start = (cargoPage - 1) * itemsPerPage
    return filteredPackages.slice(start, start + itemsPerPage)
  }, [filteredPackages, cargoPage])

  // State to toggle Help Panel
  const [showControlsHelp, setShowControlsHelp] = useState(false)

  // Find routes to populate dropdown
  const activeRoutes = useMemo(() => {
    return plan?.routes || []
  }, [plan])

  const currentRoute = useMemo(() => {
    return activeRoutes.find(r => r.id === selectedRouteId) || null
  }, [activeRoutes, selectedRouteId])

  // Get truck dimensions currently active
  const currentTruckInfo = useMemo(() => {
    if (currentRoute) {
      const truck = trucks.find(tr => tr.id === currentRoute.truckId)
      const type = truck?.type || '6W'
      const maxM3 = truck?.capacityM3 || TRUCK_DIMENSIONS[type].width * TRUCK_DIMENSIONS[type].length * TRUCK_DIMENSIONS[type].height
      const maxKg = truck?.capacityKg || 5500
      return {
        type,
        maxM3,
        maxKg,
        plateNumber: truck?.plateNumber || 'T-MILKRUN',
        ...TRUCK_DIMENSIONS[type]
      }
    } else {
      const dim = TRUCK_DIMENSIONS[manualTruckType]
      const capacities: Record<TruckType, { m3: number, kg: number }> = {
        '4W': { m3: 8, kg: 2000 },
        '4WJ': { m3: 12, kg: 2800 },
        '6W': { m3: 22, kg: 5500 },
        '10W': { m3: 38, kg: 12000 },
        'Trailer': { m3: 60, kg: 25000 },
      }
      return {
        type: manualTruckType,
        maxM3: capacities[manualTruckType].m3,
        maxKg: capacities[manualTruckType].kg,
        plateNumber: `M-${manualTruckType}`,
        ...dim
      }
    }
  }, [currentRoute, manualTruckType, trucks])

  // Restore/Initialize packages list when route or truck selection changes
  useEffect(() => {
    if (currentRoute) {
      const pkgs: Package[] = []
      let stopSeqCounter = 0
      const sortedStops = [...currentRoute.stops].sort((a, b) => a.sequence - b.sequence)
      
      const colors = [
        '#10b981', // Emerald
        '#3b82f6', // Blue
        '#6366f1', // Indigo
        '#f59e0b', // Amber
        '#ec4899', // Pink
        '#14b8a6', // Teal
        '#f43f5e', // Rose
        '#8b5cf6', // Purple
      ]
      
      for (const stop of sortedStops) {
        const loc = locations.find(l => l.id === stop.locationId)
        if (!loc || loc.demandM3 <= 0) continue
        
        stopSeqCounter++
        const color = colors[(stopSeqCounter - 1) % colors.length]
        
        const stopProducts = products.filter(p => p.supplierId === loc.id && p.active)
        
        if (stopProducts.length > 0) {
          let remainingM3 = loc.demandM3
          let remainingKg = loc.demandKg
          let packageIndex = 0
          const stopPkgs: Package[] = []
          
          // Sort products by volume descending
          const sortedProds = [...stopProducts].sort((a, b) => {
            const aInfo = getPalletizedDimensions(a, currentTruckInfo.height)
            const bInfo = getPalletizedDimensions(b, currentTruckInfo.height)
            return (bInfo.w * bInfo.l * bInfo.h) - (aInfo.w * aInfo.l * aInfo.h)
          })
          
          let loopProtect = 0
          while ((remainingM3 > 0.05 || remainingKg > 5) && stopPkgs.length < 15 && loopProtect < 50) {
            loopProtect++
            // Greedily find product that fits
            const fit = sortedProds.find(p => {
              const pInfo = getPalletizedDimensions(p, currentTruckInfo.height)
              return (pInfo.w * pInfo.l * pInfo.h) <= remainingM3 + 0.05 && pInfo.weight <= remainingKg + 10
            }) || sortedProds[0]
            
            if (!fit) break
            
            const palletInfo = getPalletizedDimensions(fit, currentTruckInfo.height)
            const v = palletInfo.w * palletInfo.l * palletInfo.h
            stopPkgs.push({
              id: `pkg-${loc.code}-${stopSeqCounter}-${packageIndex++}`,
              supplierId: loc.id,
              supplierCode: fit.code,
              supplierName: fit.name,
              supplierNameTh: fit.nameTh,
              stopSeq: stopSeqCounter,
              color,
              w: palletInfo.w,
              l: palletInfo.l,
              h: palletInfo.h,
              volume: Math.round(v * 100) / 100,
              isLoaded: false,
              x: 0, y: 0, z: 0,
              palletType: fit.palletType,
              unitsPerPallet: palletInfo.unitsPerPallet,
              isPalletized: palletInfo.isPalletized,
              weight: palletInfo.weight
            })
            
            remainingM3 -= v
            remainingKg -= palletInfo.weight
          }
          pkgs.push(...stopPkgs)
        } else {
          // Fallback: standard dynamic splitting
          let remainingM3 = loc.demandM3
          let packageIndex = 0
          const stopPkgs: Omit<Package, 'weight'>[] = []
          
          while (remainingM3 > 0.05 && stopPkgs.length < 12) {
            let w = 1.0, l = 1.2, h = 1.4 // standard heavy pallet
            if (remainingM3 < 0.5) {
              w = 0.5; l = 0.5; h = 0.5 // small package
            } else if (remainingM3 < 1.2) {
              w = 0.8; l = 0.8; h = 0.8 // medium box
            }
            
            if (w > currentTruckInfo.width - 0.1) w = currentTruckInfo.width - 0.2
            if (l > currentTruckInfo.length - 0.1) l = 1.0
            if (h > currentTruckInfo.height - 0.1) h = currentTruckInfo.height - 0.2
            
            const vol = w * l * h
            stopPkgs.push({
              id: `pkg-${loc.code}-${stopSeqCounter}-${packageIndex++}`,
              supplierId: loc.id,
              supplierCode: loc.code,
              supplierName: loc.name,
              supplierNameTh: loc.nameTh,
              stopSeq: stopSeqCounter,
              color,
              w,
              l,
              h,
              volume: Math.round(vol * 100) / 100,
              isLoaded: false,
              x: 0, y: 0, z: 0
            })
            remainingM3 -= vol
          }
          
          const totalVol = stopPkgs.reduce((sum, p) => sum + p.volume, 0)
          stopPkgs.forEach(p => {
            const wt = Math.round((p.volume / (totalVol || 1)) * loc.demandKg)
            pkgs.push({
              ...p,
              weight: Math.max(1, wt)
            } as Package)
          })
        }
      }
      
      // RESTORE SAVED LAYOUT Plan if it exists!
      const savedPlan = currentRoute.loadPlan || []
      if (savedPlan.length > 0) {
        const restored = pkgs.map(p => {
          const saved = savedPlan.find(sp => sp.id === p.id)
          if (saved) {
            return {
              ...p,
              x: saved.x,
              y: saved.y,
              z: saved.z,
              w: saved.w,
              h: saved.h,
              l: saved.l,
              volume: Math.round(saved.w * saved.h * saved.l * 100) / 100,
              isLoaded: saved.isLoaded
            }
          }
          return p
        })
        setPackages(restored)
      } else {
        setPackages(pkgs)
      }
      setSelectedPkgId(null)
    } else {
      // Manual Mode
      setPackages(generateManualPackages(manualTruckType, products))
      setSelectedPkgId(null)
    }
    setUnloadState('idle')
    setAnimIndex(-1)
    // Depend on the route *id* (not the object): patching loadPlan below must not
    // re-run this rebuild, or it fights the save effect in an infinite loop.
  }, [currentRoute?.id, manualTruckType, locations, products, currentTruckInfo.width, currentTruckInfo.length, currentTruckInfo.height])

  // PERSIST CURRENT LOAD PATTERN TO STORE
  useEffect(() => {
    if (!currentRoute) return
    
    const planToSave = packages.map(p => ({
      id: p.id,
      x: p.x,
      y: p.y,
      z: p.z,
      w: p.w,
      h: p.h,
      l: p.l,
      isLoaded: p.isLoaded
    }))

    // Read the route's saved plan fresh from the store (not the possibly-stale
    // closure) so persisting never triggers a rebuild → save → rebuild loop.
    const live = useTms.getState().plan?.routes.find(r => r.id === currentRoute.id)
    const savedPlan = live?.loadPlan || []

    // Compare states to avoid infinite loops
    const isDifferent = savedPlan.length !== planToSave.length ||
      planToSave.some((p, i) => {
        const s = savedPlan[i]
        return !s || 
               s.id !== p.id || 
               s.x !== p.x || 
               s.y !== p.y || 
               s.z !== p.z || 
               s.w !== p.w || 
               s.h !== p.h || 
               s.l !== p.l || 
               s.isLoaded !== p.isLoaded
      })

    if (isDifferent) {
      useTms.getState().patchRoute(currentRoute.id, { loadPlan: planToSave })
    }
  }, [packages, currentRoute?.id])

  // Computed Values
  const totals = useMemo(() => {
    const loaded = packages.filter(p => p.isLoaded)
    const m3 = loaded.reduce((sum, p) => sum + p.volume, 0)
    const kg = loaded.reduce((sum, p) => sum + p.weight, 0)
    
    return {
      volume: Math.round(m3 * 10) / 10,
      weight: kg,
      volumePct: Math.min(100, Math.round((m3 / currentTruckInfo.maxM3) * 100)),
      weightPct: Math.min(100, Math.round((kg / currentTruckInfo.maxKg) * 100))
    }
  }, [packages, currentTruckInfo])

  // Center of Gravity Math
  const centerOfGravity = useMemo(() => {
    const loaded = packages.filter(p => p.isLoaded)
    if (loaded.length === 0) {
      return { x: 0.5, z: 0.5, status: 'balanced' as const }
    }
    
    let sumWeightZ = 0
    let sumWeightX = 0
    let totalWeight = 0
    
    loaded.forEach(p => {
      const cx = p.x + p.w / 2
      const cz = p.z + p.l / 2
      sumWeightX += p.weight * cx
      sumWeightZ += p.weight * cz
      totalWeight += p.weight
    })
    
    const cgX = sumWeightX / totalWeight
    const cgZ = sumWeightZ / totalWeight
    
    const relX = cgX / currentTruckInfo.width
    const relZ = cgZ / currentTruckInfo.length
    
    const devX = Math.abs(relX - 0.5)
    let status: 'balanced' | 'front-heavy' | 'rear-heavy' | 'unbalanced' = 'balanced'
    
    if (devX > 0.15) {
      status = 'unbalanced'
    } else if (relZ < 0.25) {
      status = 'front-heavy'
    } else if (relZ > 0.65) {
      status = 'rear-heavy'
    }
    
    return { x: relX, z: relZ, status }
  }, [packages, currentTruckInfo])

  // Axle Load Moments Math
  const axleLoads = useMemo(() => {
    const preset = AXLE_PRESETS[currentTruckInfo.type]
    const loaded = packages.filter(p => p.isLoaded)
    const L = currentTruckInfo.length
    
    const z_fa = preset.frontAxlePos
    const z_ra = preset.rearAxlePosPct * L
    const WB = z_ra - z_fa
    
    let cargoOnFrontAxle = 0
    let cargoOnRearAxle = 0
    
    loaded.forEach(p => {
      const z_center = p.z + p.l / 2
      const d_fa = z_center - z_fa
      const d_ra = z_ra - z_center
      
      const f_rear = p.weight * (d_fa / WB)
      const f_front = p.weight * (d_ra / WB)
      
      cargoOnFrontAxle += f_front
      cargoOnRearAxle += f_rear
    })
    
    const frontTotal = Math.round(preset.axleFrontEmpty + cargoOnFrontAxle)
    const rearTotal = Math.round(preset.axleRearEmpty + cargoOnRearAxle)
    
    return {
      frontWeight: frontTotal,
      rearWeight: rearTotal,
      frontLimit: preset.frontAxleLimit,
      rearLimit: preset.rearAxleLimit,
      frontOverloaded: frontTotal > preset.frontAxleLimit,
      rearOverloaded: rearTotal > preset.rearAxleLimit,
      frontPct: Math.min(100, Math.round((frontTotal / preset.frontAxleLimit) * 100)),
      rearPct: Math.min(100, Math.round((rearTotal / preset.rearAxleLimit) * 100)),
    }
  }, [packages, currentTruckInfo])

  // Detect LIFO (Last In First Out) Violations
  const lifoViolations = useMemo((): LifoViolation[] => {
    if (!currentRoute) return []
    
    const loaded = packages.filter(p => p.isLoaded)
    const violations: LifoViolation[] = []
    
    for (let i = 0; i < loaded.length; i++) {
      const a = loaded[i]
      for (let j = 0; j < loaded.length; j++) {
        if (i === j) continue
        const b = loaded[j]
        
        const aCenterZ = a.z + a.l / 2
        const bCenterZ = b.z + b.l / 2
        
        if (a.stopSeq < b.stopSeq && bCenterZ > aCenterZ) {
          const overlapX = (b.x < a.x + a.w - 0.05) && (b.x + b.w > a.x + 0.05)
          if (overlapX) {
            const exists = violations.some(v => 
              v.earlyPkg.id === a.id && v.latePkg.id === b.id
            )
            if (!exists) {
              violations.push({ earlyPkg: a, latePkg: b })
            }
          }
        }
      }
    }
    
    return violations
  }, [packages, currentRoute])

  const isLifoBlocked = (pkgId: string) => {
    return lifoViolations.some(v => v.earlyPkg.id === pkgId)
  }

  // 3D Bin Packing Auto-Load Algorithm (front-to-back, LIFO-aware)
  const handleAutoArrange = () => {
    const W = currentTruckInfo.width
    const H = currentTruckInfo.height
    const L = currentTruckInfo.length
    
    const sorted = [...packages].sort((a, b) => {
      if (b.stopSeq !== a.stopSeq) {
        return b.stopSeq - a.stopSeq
      }
      return b.volume - a.volume
    })
    
    const packed: Package[] = []
    const step = 0.1
    
    for (const pkg of sorted) {
      let placed = false
      
      for (let z = 0; z <= L - pkg.l + 0.001 && !placed; z = Math.round((z + step) * 10) / 10) {
        for (let y = 0; y <= H - pkg.h + 0.001 && !placed; y = Math.round((y + step) * 10) / 10) {
          for (let x = 0; x <= W - pkg.w + 0.001 && !placed; x = Math.round((x + step) * 10) / 10) {
            
            let hasOverlap = false
            for (const other of packed) {
              const noX = (x + pkg.w <= other.x + 0.01) || (x >= other.x + other.w - 0.01)
              const noY = (y + pkg.h <= other.y + 0.01) || (y >= other.y + other.h - 0.01)
              const noZ = (z + pkg.l <= other.z + 0.01) || (z >= other.z + other.l - 0.01)
              
              if (!noX && !noY && !noZ) {
                hasOverlap = true
                break
              }
            }
            
            if (hasOverlap) continue
            
            if (y > 0) {
              const isSupported = checkSupportArea(x, z, pkg.w, pkg.l, y, packed, 0.02)
              if (!isSupported) continue
            }
            
            packed.push({
              ...pkg,
              x,
              y,
              z,
              isLoaded: true
            })
            placed = true
          }
        }
      }
      
      if (!placed) {
        packed.push({
          ...pkg,
          isLoaded: false,
          x: 0, y: 0, z: 0
        })
      }
    }
    
    const merged = packages.map(original => {
      const found = packed.find(p => p.id === original.id)
      return found ? found : original
    })
    
    setPackages(merged)
  }

  // Unload all cargo
  const handleReset = () => {
    stopUnloadAnimation()
    setPackages(prev => prev.map(p => ({ ...p, isLoaded: false, x: 0, y: 0, z: 0 })))
    setSelectedPkgId(null)
  }

  // Load a single item into a default valid position
  const handleLoadSingle = (pkgId: string) => {
    const W = currentTruckInfo.width
    const H = currentTruckInfo.height
    const L = currentTruckInfo.length
    
    setPackages(prev => {
      const itemIndex = prev.findIndex(p => p.id === pkgId)
      if (itemIndex === -1) return prev
      
      const pkg = prev[itemIndex]
      const otherLoaded = prev.filter(p => p.isLoaded && p.id !== pkgId)
      
      const step = 0.1
      let placed = false
      let foundX = 0, foundY = 0, foundZ = 0
      
      for (let z = 0; z <= L - pkg.l + 0.001 && !placed; z = Math.round((z + step) * 10) / 10) {
        for (let y = 0; y <= H - pkg.h + 0.001 && !placed; y = Math.round((y + step) * 10) / 10) {
          for (let x = 0; x <= W - pkg.w + 0.001 && !placed; x = Math.round((x + step) * 10) / 10) {
            
            let overlap = false
            for (const other of otherLoaded) {
              const noX = (x + pkg.w <= other.x + 0.01) || (x >= other.x + other.w - 0.01)
              const noY = (y + pkg.h <= other.y + 0.01) || (y >= other.y + other.h - 0.01)
              const noZ = (z + pkg.l <= other.z + 0.01) || (z >= other.z + other.l - 0.01)
              
              if (!noX && !noY && !noZ) {
                overlap = true
                break
              }
            }
            if (overlap) continue
            
            if (y > 0) {
              const supported = checkSupportArea(x, z, pkg.w, pkg.l, y, otherLoaded, 0.02)
              if (!supported) continue
            }
            
            foundX = x; foundY = y; foundZ = z
            placed = true
          }
        }
      }
      
      if (!placed) {
        foundX = 0; foundY = 0; foundZ = 0
      }
      
      const updated = [...prev]
      updated[itemIndex] = {
        ...pkg,
        isLoaded: true,
        x: foundX,
        y: foundY,
        z: foundZ
      }
      return updated
    })
    
    setSelectedPkgId(pkgId)
  }

  // Unload a single package
  const handleUnloadSingle = (pkgId: string) => {
    setPackages(prev => prev.map(p => 
      p.id === pkgId ? { ...p, isLoaded: false, x: 0, y: 0, z: 0 } : p
    ))
    if (selectedPkgId === pkgId) setSelectedPkgId(null)
  }

  // Adjust package position manually from panels
  const adjustPackagePos = (axis: 'x' | 'y' | 'z', delta: number) => {
    if (!selectedPkgId) return
    
    setPackages(prev => {
      const idx = prev.findIndex(p => p.id === selectedPkgId)
      if (idx === -1 || !prev[idx].isLoaded) return prev
      
      const pkg = { ...prev[idx] }
      const limits = {
        x: currentTruckInfo.width - pkg.w,
        y: currentTruckInfo.height - pkg.h,
        z: currentTruckInfo.length - pkg.l,
      }
      
      pkg[axis] = Math.round(Math.max(0, Math.min(limits[axis], pkg[axis] + delta)) * 10) / 10
      
      const updated = [...prev]
      updated[idx] = pkg
      return updated
    })
  }

  // 90 Degree Rotation Function
  const handleRotateSelected = () => {
    if (!selectedPkgId) return
    setPackages(prev => {
      const idx = prev.findIndex(p => p.id === selectedPkgId)
      if (idx === -1) return prev

      const pkg = { ...prev[idx] }
      const W = currentTruckInfo.width
      const L = currentTruckInfo.length

      // Swap dimensions
      const temp = pkg.w
      const nextW = pkg.l
      const nextL = temp

      // Clamp package to fit container bounds
      let nextX = Math.max(0, Math.min(W - nextW, pkg.x))
      let nextZ = Math.max(0, Math.min(L - nextL, pkg.z))

      // Snap to grid
      nextX = Math.round(nextX * 10) / 10
      nextZ = Math.round(nextZ * 10) / 10

      const updated = [...prev]
      updated[idx] = {
        ...pkg,
        w: nextW,
        l: nextL,
        x: nextX,
        z: nextZ
      }
      return updated
    })
  }

  // Key press R / r triggers rotation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'r' || e.key === 'R') && selectedPkgId) {
        handleRotateSelected()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPkgId, currentTruckInfo])

  // Step-by-Step Unload Animation controls
  const startUnloadAnimation = () => {
    // Sort packages: Z descending (tailgate first) then Y descending (top first) to prevent intersection
    const queue = [...packages]
      .filter(p => p.isLoaded)
      .sort((a, b) => {
        // Primary: Z descending (back to front)
        if (Math.abs(b.z - a.z) > 0.05) return b.z - a.z
        // Secondary: Y descending (top to bottom)
        if (Math.abs(b.y - a.y) > 0.05) return b.y - a.y
        // Tertiary: X descending
        return b.x - a.x
      })
      .map(p => p.id)
    
    if (queue.length === 0) return
    setAnimQueue(queue)
    setAnimIndex(0)
    setAnimOffsetZ(0)
    setUnloadState('running')
  }

  const stopUnloadAnimation = () => {
    setUnloadState('idle')
    setAnimIndex(-1)
    setAnimOffsetZ(0)
    setAnimQueue([])
  }

  // Animation Interval Driver
  useEffect(() => {
    if (unloadState !== 'running' || animIndex < 0 || animIndex >= animQueue.length) return
    
    const currentPkgId = animQueue[animIndex]
    
    let timer: number
    const tick = () => {
      setAnimOffsetZ(prev => {
        if (prev >= 4.0) {
          // Finished animating unloading of this box
          setPackages(pkgs => pkgs.map(p => 
            p.id === currentPkgId ? { ...p, isLoaded: false, x: 0, y: 0, z: 0 } : p
          ))
          
          setAnimIndex(idx => {
            if (idx + 1 >= animQueue.length) {
              setUnloadState('idle')
              return -1
            }
            return idx + 1
          })
          return 0
        }
        return prev + 0.15 // unloading slide speed
      })
      timer = requestAnimationFrame(tick)
    }
    
    timer = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(timer)
  }, [unloadState, animIndex, animQueue])

  // Three.js Canvas Engine Initialization and Scene Management
  useEffect(() => {
    if (!containerRef.current) return

    const container = containerRef.current
    const width = container.clientWidth
    const height = container.clientHeight || 500

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#f8fafc')
    sceneRef.current = scene

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 50)
    camera.position.set(currentTruckInfo.width * 1.5, currentTruckInfo.height * 2.0, currentTruckInfo.length * 1.5)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(renderer.domElement)

    const ambientLight = new THREE.AmbientLight('#ffffff', 0.6)
    scene.add(ambientLight)

    const dirLight = new THREE.DirectionalLight('#ffffff', 0.8)
    dirLight.position.set(10, 15, 8)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 1024
    dirLight.shadow.mapSize.height = 1024
    dirLight.shadow.bias = -0.0005
    scene.add(dirLight)

    const fillLight = new THREE.DirectionalLight('#94a3b8', 0.3)
    fillLight.position.set(-10, 5, -8)
    scene.add(fillLight)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.maxPolarAngle = Math.PI / 2 - 0.05
    controls.minDistance = 2
    controls.maxDistance = 30
    controlsRef.current = controls

    const gridHelper = new THREE.GridHelper(30, 30, '#cbd5e1', '#f1f5f9')
    gridHelper.position.y = -0.01
    scene.add(gridHelper)

    // -------------------------------------------------------------
    // Procedural Truck Construction
    // -------------------------------------------------------------
    const truckGroup = new THREE.Group()
    scene.add(truckGroup)

    const W = currentTruckInfo.width
    const H = currentTruckInfo.height
    const L = currentTruckInfo.length
    const floorHeight = 0.5

    const cabinMaterial = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      metalness: 0.8,
      roughness: 0.2,
    })
    const bumperMaterial = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.7,
    })
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: '#0891b2',
      transparent: true,
      opacity: 0.4,
      roughness: 0.1,
    })
    const chromeMaterial = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      metalness: 0.9,
      roughness: 0.05,
    })
    const containerFloorMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.4,
      metalness: 0.5,
    })
    const tireMaterial = new THREE.MeshStandardMaterial({
      color: '#090d16',
      roughness: 0.9,
    })

    const bedGeo = new THREE.BoxGeometry(W, 0.08, L)
    const bedMesh = new THREE.Mesh(bedGeo, containerFloorMat)
    bedMesh.position.set(0, floorHeight, 0)
    bedMesh.receiveShadow = true
    truckGroup.add(bedMesh)

    const innerGrid = new THREE.GridHelper(Math.max(W, L), 20, '#64748b', '#e2e8f0')
    innerGrid.position.set(0, floorHeight + 0.041, 0)
    innerGrid.scale.set(W / Math.max(W, L), 1, L / Math.max(W, L))
    truckGroup.add(innerGrid)

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: '#0284c7',
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide
    })
    
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMaterial)
    leftWall.position.set(-W / 2, floorHeight + H / 2, 0)
    leftWall.rotation.y = Math.PI / 2
    truckGroup.add(leftWall)

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMaterial)
    rightWall.position.set(W / 2, floorHeight + H / 2, 0)
    rightWall.rotation.y = -Math.PI / 2
    truckGroup.add(rightWall)

    const frontWall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMaterial)
    frontWall.position.set(0, floorHeight + H / 2, -L / 2)
    truckGroup.add(frontWall)

    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, L), wallMaterial)
    ceiling.position.set(0, floorHeight + H, 0)
    ceiling.rotation.x = Math.PI / 2
    truckGroup.add(ceiling)

    const outlineGeo = new THREE.BoxGeometry(W, H, L)
    const edges = new THREE.EdgesGeometry(outlineGeo)
    const lineMat = new THREE.LineBasicMaterial({ color: '#0284c7', linewidth: 2 })
    const wireframe = new THREE.LineSegments(edges, lineMat)
    wireframe.position.set(0, floorHeight + H / 2, 0)
    truckGroup.add(wireframe)

    const cabL = Math.max(0.8, W * 0.5)
    const cabH = H * 0.95
    const cabW = W * 0.98
    
    const cabGeo = new THREE.BoxGeometry(cabW, cabH, cabL)
    const cabin = new THREE.Mesh(cabGeo, cabinMaterial)
    cabin.position.set(0, floorHeight + cabH / 2, -L / 2 - cabL / 2)
    cabin.castShadow = true
    truckGroup.add(cabin)

    const windGeo = new THREE.PlaneGeometry(cabW * 0.9, cabH * 0.4)
    const windshield = new THREE.Mesh(windGeo, glassMaterial)
    windshield.position.set(0, floorHeight + cabH * 0.7, -L / 2 - cabL - 0.01)
    windshield.rotation.y = Math.PI
    truckGroup.add(windshield)

    const bumperGeo = new THREE.BoxGeometry(W * 1.02, floorHeight * 0.7, 0.1)
    const bumper = new THREE.Mesh(bumperGeo, bumperMaterial)
    bumper.position.set(0, floorHeight * 0.4, -L / 2 - cabL - 0.05)
    truckGroup.add(bumper)

    const lightGeo = new THREE.SphereGeometry(0.1, 16, 16)
    const lightMat = new THREE.MeshBasicMaterial({ color: '#fef08a' })
    const leftLight = new THREE.Mesh(lightGeo, lightMat)
    leftLight.position.set(-W * 0.38, floorHeight * 0.5, -L / 2 - cabL - 0.07)
    leftLight.scale.set(1.5, 1, 0.3)
    truckGroup.add(leftLight)

    const rightLight = leftLight.clone()
    rightLight.position.x = W * 0.38
    truckGroup.add(rightLight)

    const plateGeo = new THREE.BoxGeometry(W * 0.2, 0.08, 0.02)
    const plate = new THREE.Mesh(plateGeo, chromeMaterial)
    plate.position.set(0, floorHeight * 0.45, -L / 2 - cabL - 0.06)
    truckGroup.add(plate)

    const wheelRadius = 0.35
    const wheelThickness = 0.22
    const wheelGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelThickness, 32)
    wheelGeo.rotateZ(Math.PI / 2)

    const wheelHubGeo = new THREE.CylinderGeometry(wheelRadius * 0.4, wheelRadius * 0.4, wheelThickness + 0.02, 16)
    wheelHubGeo.rotateZ(Math.PI / 2)

    const addWheel = (xPos: number, zPos: number) => {
      const tire = new THREE.Mesh(wheelGeo, tireMaterial)
      tire.castShadow = true
      const hub = new THREE.Mesh(wheelHubGeo, chromeMaterial)
      tire.add(hub)
      tire.position.set(xPos, wheelRadius, zPos)
      truckGroup.add(tire)
    }

    // Front steer wheels
    addWheel(-W / 2 - 0.05, -L / 2 - cabL * 0.5)
    addWheel(W / 2 + 0.05, -L / 2 - cabL * 0.5)

    const rearAxles = L > 6 ? 2 : 1
    if (rearAxles === 1) {
      addWheel(-W / 2 - 0.05, L * 0.25)
      addWheel(W / 2 + 0.05, L * 0.25)
    } else {
      addWheel(-W / 2 - 0.05, L * 0.15)
      addWheel(W / 2 + 0.05, L * 0.15)
      addWheel(-W / 2 - 0.05, L * 0.32)
      addWheel(W / 2 + 0.05, L * 0.32)
    }

    controls.target.set(0, floorHeight + H / 2, 0)
    controls.update()

    // Helper plane layout
    dragPlaneRef.current.constant = -floorHeight

    let animationFrameId: number
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    const handleResize = () => {
      if (!containerRef.current) return
      const w = containerRef.current.clientWidth
      const h = containerRef.current.clientHeight || 500
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationFrameId)
      renderer.dispose()
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [currentTruckInfo.width, currentTruckInfo.height, currentTruckInfo.length])

  // Synchronize packages mesh states with React packages list
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    let cargoGroup = scene.getObjectByName('cargo-packages') as THREE.Group
    if (!cargoGroup) {
      cargoGroup = new THREE.Group()
      cargoGroup.name = 'cargo-packages'
      scene.add(cargoGroup)
    }

    const W = currentTruckInfo.width
    const L = currentTruckInfo.length
    const H = currentTruckInfo.height
    const floorHeight = 0.5

    const newMeshesMap = new Map<string, THREE.Object3D>()
    const textureMap = new Map<string, THREE.CanvasTexture>()

    const getTextureForPackage = (color: string, label: string, subLabel: string) => {
      const key = `${color}-${label}-${subLabel}`
      if (textureMap.has(key)) return textureMap.get(key)!

      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 256, 256)

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'
        ctx.lineWidth = 12
        ctx.strokeRect(16, 16, 224, 224)

        ctx.fillStyle = 'rgba(0,0,0,0.1)'
        ctx.fillRect(115, 16, 26, 224)
        ctx.fillRect(16, 115, 224, 26)

        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 38px sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)'
        ctx.shadowBlur = 4
        ctx.shadowOffsetX = 2
        ctx.shadowOffsetY = 2
        ctx.fillText(label, 128, 90)

        ctx.font = 'bold 26px sans-serif'
        ctx.fillText(subLabel, 128, 165)
      }

      const tex = new THREE.CanvasTexture(canvas)
      textureMap.set(key, tex)
      return tex
    }

    const disposeObject = (obj: THREE.Object3D) => {
      cargoGroup.remove(obj)
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose()
        if (Array.isArray(obj.material)) {
          obj.material.forEach(m => m.dispose())
        } else {
          obj.material.dispose()
        }
      } else {
        // Dispose all Mesh children recursively
        obj.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose())
            } else {
              child.material.dispose()
            }
          }
        })
      }
    }

    const createPackageObject = (pkg: Package, isSelected: boolean, isValid: boolean) => {
      const isPallet = pkg.isPalletized && pkg.palletType && pkg.palletType !== 'none'
      
      const texture = getTextureForPackage(
        pkg.color,
        pkg.supplierCode,
        `${pkg.weight} kg`
      )

      const material = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        metalness: 0.1,
      })

      if (!isValid) {
        material.color.set('#f87171') // Light red warning tint
      } else {
        material.color.set('#ffffff')
      }

      if (!isPallet) {
        const geo = new THREE.BoxGeometry(pkg.w, pkg.h, pkg.l)
        const mesh = new THREE.Mesh(geo, material)
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.userData = { id: pkg.id, isPalletized: false }
        if (isSelected) {
          mesh.scale.set(1.02, 1.02, 1.02)
        }
        return mesh
      }

      // Render pallet!
      const group = new THREE.Group()
      group.userData = { id: pkg.id, isPalletized: true, w: pkg.w, h: pkg.h, l: pkg.l }

      // 1. Pallet base (brown wood or dark plastic)
      const palletH = 0.15
      const baseGeo = new THREE.BoxGeometry(pkg.w, palletH, pkg.l)
      
      let baseColor = '#b45309' // Brown wooden pallet
      let baseRough = 0.95
      if (pkg.palletType === 'plastic') {
        baseColor = '#334155' // Dark slate plastic pallet
        baseRough = 0.6
      }

      const baseMat = new THREE.MeshStandardMaterial({
        color: baseColor,
        roughness: baseRough,
        metalness: 0.1
      })

      if (!isValid) {
        baseMat.color.set('#f87171')
      }

      const baseMesh = new THREE.Mesh(baseGeo, baseMat)
      baseMesh.position.y = -pkg.h / 2 + palletH / 2
      baseMesh.castShadow = true
      baseMesh.receiveShadow = true
      group.add(baseMesh)

      // 2. Stacked Boxes
      const prod = products.find(p => p.code === pkg.supplierCode)
      const units = pkg.unitsPerPallet || 1
      const boxW = prod?.width || 0.4
      const boxL = prod?.length || 0.4
      const boxH = prod?.height || 0.4

      // Calculate grid size on the pallet base (using pkg.w and pkg.l which respect rotation)
      const nx = Math.max(1, Math.floor(pkg.w / boxW))
      const nz = Math.max(1, Math.floor(pkg.l / boxL))
      const boxesPerLayer = nx * nz

      let placed = 0
      let layer = 0

      while (placed < units) {
        const layerCount = Math.min(boxesPerLayer, units - placed)
        for (let idx = 0; idx < layerCount; idx++) {
          const row = Math.floor(idx / nx)
          const col = idx % nx

          // Offset from group center
          const ox = -pkg.w / 2 + (col * boxW) + boxW / 2
          const oz = -pkg.l / 2 + (row * boxL) + boxL / 2
          const oy = -pkg.h / 2 + palletH + (layer * boxH) + boxH / 2

          // Check roof height limit safety check
          if (oy + boxH / 2 > pkg.h / 2 + 0.01) {
            break // safety cutoff
          }

          const boxGeo = new THREE.BoxGeometry(boxW * 0.96, boxH * 0.96, boxL * 0.96)
          const boxMesh = new THREE.Mesh(boxGeo, material)
          boxMesh.position.set(ox, oy, oz)
          boxMesh.castShadow = true
          boxMesh.receiveShadow = true
          group.add(boxMesh)
        }
        placed += layerCount
        layer++
      }

      if (isSelected) {
        group.scale.set(1.02, 1.02, 1.02)
      }

      return group
    }

    packages.forEach(pkg => {
      if (!pkg.isLoaded) return

      // Determine offset if animating unloading
      const isAnimating = unloadState === 'running' && animQueue[animIndex] === pkg.id
      const currentOffsetZ = isAnimating ? animOffsetZ : 0

      const meshX = pkg.x - W / 2 + pkg.w / 2
      const meshY = pkg.y + pkg.h / 2 + floorHeight
      const meshZ = pkg.z - L / 2 + pkg.l / 2 + currentOffsetZ

      let mesh = meshesRef.current.get(pkg.id)
      const placementVal = checkPlacementStatus(pkg, packages, W, H, L)
      const isValid = placementVal.valid && !isLifoBlocked(pkg.id)
      const isSelected = selectedPkgId === pkg.id

      // Check if we need to recreate the mesh (if dimensions changed, or palletized status changed, or isSelected state changed scaling)
      let needsRecreate = !mesh
      if (mesh) {
        if (mesh instanceof THREE.Mesh) {
          // If it was a mesh but is now palletized, recreate
          if (pkg.isPalletized) {
            needsRecreate = true
          } else {
            // Check if bounds match
            const boxGeom = mesh.geometry as THREE.BoxGeometry
            if (
              boxGeom.parameters.width !== pkg.w ||
              boxGeom.parameters.height !== pkg.h ||
              boxGeom.parameters.depth !== pkg.l
            ) {
              needsRecreate = true
            }
          }
        } else {
          // If it was a group but is now not palletized, recreate
          if (!pkg.isPalletized) {
            needsRecreate = true
          } else {
            // Check if stored bounds match
            const stored = mesh.userData
            if (stored.w !== pkg.w || stored.h !== pkg.h || stored.l !== pkg.l) {
              needsRecreate = true
            }
          }
        }
      }

      if (needsRecreate) {
        if (mesh) {
          disposeObject(mesh)
        }
        mesh = createPackageObject(pkg, isSelected, isValid)
      } else if (mesh) {
        // Just update material colors and scaling dynamically without rebuilding
        const isGroup = mesh instanceof THREE.Group
        if (!isGroup) {
          const m = mesh as THREE.Mesh
          const mat = m.material as THREE.MeshStandardMaterial
          if (!isValid) {
            mat.color.set('#f87171')
          } else {
            mat.color.set('#ffffff')
          }
          if (isSelected) {
            m.scale.set(1.02, 1.02, 1.02)
          } else {
            m.scale.set(1, 1, 1)
          }
        } else {
          const g = mesh as THREE.Group
          // Update children materials
          g.children.forEach(child => {
            if (child instanceof THREE.Mesh) {
              const mat = child.material as THREE.MeshStandardMaterial
              if (!isValid) {
                mat.color.set('#f87171')
              } else {
                // If it is the pallet base, restore wood/plastic color
                if (child.geometry.parameters.height === 0.15) {
                  let baseColor = '#b45309'
                  if (pkg.palletType === 'plastic') baseColor = '#334155'
                  mat.color.set(baseColor)
                } else {
                  mat.color.set('#ffffff')
                }
              }
            }
          })
          if (isSelected) {
            g.scale.set(1.02, 1.02, 1.02)
          } else {
            g.scale.set(1, 1, 1)
          }
        }
      }

      if (mesh) {
        mesh.position.set(meshX, meshY, meshZ)
        cargoGroup.add(mesh)
        newMeshesMap.set(pkg.id, mesh)
      }
    })

    // Clean up mesh objects
    meshesRef.current.forEach((mesh, id) => {
      if (!newMeshesMap.has(id)) {
        disposeObject(mesh)
      }
    })

    meshesRef.current = newMeshesMap

    return () => {
      textureMap.forEach(tex => tex.dispose())
    }
  }, [packages, currentTruckInfo, selectedPkgId, lifoViolations, unloadState, animIndex, animOffsetZ, animQueue])

  // Mouse drag-and-drop listener installation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()
    const scene = sceneRef.current
    const controls = controlsRef.current
    
    if (!scene || !controls) return

    const W = currentTruckInfo.width
    const H = currentTruckInfo.height
    const L = currentTruckInfo.length
    const floorHeight = 0.5

    const onMouseDown = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(mouse, controls.object)

      const cargoGroup = scene.getObjectByName('cargo-packages')
      if (!cargoGroup) return

      const intersects = raycaster.intersectObjects(cargoGroup.children, true)
      if (intersects.length > 0) {
        let hitObj: THREE.Object3D | null = intersects[0].object
        while (hitObj && hitObj !== cargoGroup && !hitObj.userData.id) {
          hitObj = hitObj.parent
        }

        if (hitObj && hitObj.userData.id) {
          const pkgId = hitObj.userData.id
          setSelectedPkgId(pkgId)
          
          draggedMeshRef.current = hitObj
          isDraggingRef.current = true
          controls.enabled = false

          const currentPkg = packages.find(p => p.id === pkgId)
          if (currentPkg) {
            dragPlaneRef.current.setFromNormalAndCoplanarPoint(
              new THREE.Vector3(0, 1, 0),
              new THREE.Vector3(0, hitObj.position.y, 0)
            )
            
            if (raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionRef.current)) {
              dragOffsetRef.current.copy(hitObj.position).sub(intersectionRef.current)
            }
          }
        }
      } else {
        setSelectedPkgId(null)
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !draggedMeshRef.current) return

      const rect = container.getBoundingClientRect()
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(mouse, controls.object)

      if (raycaster.ray.intersectPlane(dragPlaneRef.current, intersectionRef.current)) {
        const targetPos = intersectionRef.current.clone().add(dragOffsetRef.current)

        const pkgId = draggedMeshRef.current.userData.id
        const pkg = packages.find(p => p.id === pkgId)
        if (!pkg) return

        let containerX = targetPos.x + W / 2 - pkg.w / 2
        let containerZ = targetPos.z + L / 2 - pkg.l / 2

        const step = 0.1
        containerX = Math.round(containerX / step) * step
        containerZ = Math.round(containerZ / step) * step

        containerX = Math.max(0, Math.min(W - pkg.w, containerX))
        containerZ = Math.max(0, Math.min(L - pkg.l, containerZ))

        let containerY = 0
        const otherPkgs = packages.filter(p => p.isLoaded && p.id !== pkgId)
        
        otherPkgs.forEach(other => {
          const intersectX = (containerX < other.x + other.w - 0.05) && (containerX + pkg.w > other.x + 0.05)
          const intersectZ = (containerZ < other.z + other.l - 0.05) && (containerZ + pkg.l > other.z + 0.05)
          
          if (intersectX && intersectZ) {
            containerY = Math.max(containerY, other.y + other.h)
          }
        })

        containerY = Math.round(containerY / step) * step

        if (containerY + pkg.h > H) {
          return
        }

        const finalMeshX = containerX - W / 2 + pkg.w / 2
        const finalMeshY = containerY + pkg.h / 2 + floorHeight
        const finalMeshZ = containerZ - L / 2 + pkg.l / 2
        draggedMeshRef.current.position.set(finalMeshX, finalMeshY, finalMeshZ)

        setPackages(prev => {
          return prev.map(p => {
            if (p.id === pkgId) {
              return {
                ...p,
                x: Math.round(containerX * 10) / 10,
                y: Math.round(containerY * 10) / 10,
                z: Math.round(containerZ * 10) / 10,
              }
            }
            return p
          })
        })
      }
    }

    const onMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        draggedMeshRef.current = null
        controls.enabled = true
      }
    }

    container.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      container.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [packages, currentTruckInfo])

  const selectedPkg = useMemo(() => {
    return packages.find(p => p.id === selectedPkgId) || null
  }, [packages, selectedPkgId])

  const selectedProduct = useMemo(() => {
    if (!selectedPkg) return null
    return products.find(p => p.code === selectedPkg.supplierCode) || null
  }, [selectedPkg, products])

  const selectedPkgValidation = useMemo(() => {
    if (!selectedPkg) return { valid: true, reason: '' as const }
    return checkPlacementStatus(selectedPkg, packages, currentTruckInfo.width, currentTruckInfo.height, currentTruckInfo.length)
  }, [selectedPkg, packages, currentTruckInfo])

  return (
    <div className="flex flex-col h-[calc(100vh-100px)]">
      <PageHeader
        title={t('visualTruck.title')}
        actions={
          <div className="flex items-center gap-3">
            {/* Mode selection dropdown */}
            <select
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white font-medium focus:outline-none"
              value={selectedRouteId}
              onChange={(e) => {
                setSelectedRouteId(e.target.value)
              }}
            >
              <option value="">{t('visualTruck.manualTruck')}</option>
              {activeRoutes.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {t('dashboard.route')} #{i + 1} ({trucks.find(t => t.id === r.truckId)?.plateNumber || '—'})
                </option>
              ))}
            </select>

            {/* Manual truck type select */}
            {!selectedRouteId && (
              <select
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white font-medium focus:outline-none"
                value={manualTruckType}
                onChange={(e) => setManualTruckType(e.target.value as TruckType)}
              >
                <option value="4W">4-Wheel (4W)</option>
                <option value="4WJ">4-Wheel Jumbo (4WJ)</option>
                <option value="6W">6-Wheel (6W)</option>
                <option value="10W">10-Wheel (10W)</option>
                <option value="Trailer">Trailer</option>
              </select>
            )}

            {/* Play Unload Animation Toggle */}
            {unloadState === 'running' ? (
              <Button variant="danger" onClick={stopUnloadAnimation} title={t('visualTruck.stopAnimation')}>
                <Pause size={16} />
                <span>{t('visualTruck.stopAnimation')}</span>
              </Button>
            ) : (
              <Button 
                variant="secondary" 
                onClick={startUnloadAnimation} 
                disabled={packages.filter(p => p.isLoaded).length === 0}
                title={t('visualTruck.unloadAnimation')}
              >
                <Play size={16} className="text-brand-600" />
                <span>{t('visualTruck.unloadAnimation')}</span>
              </Button>
            )}

            <Button variant="secondary" onClick={handleReset} title={t('visualTruck.reset')}>
              <RotateCcw size={16} />
              <span>{t('visualTruck.reset')}</span>
            </Button>
            
            <Button onClick={handleAutoArrange} title={t('visualTruck.autoArrange')} disabled={unloadState === 'running'}>
              <Layers size={16} />
              <span>{t('visualTruck.autoArrange')}</span>
            </Button>
          </div>
        }
      />

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-5 min-h-0">
        {/* SIDEBAR: Full-Height Cargo Deck / Inventory (4 Cols) */}
        <div className="lg:col-span-4 flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden h-full">
          {/* Sidebar Header */}
          <div className="p-4 border-b border-slate-100 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Layers size={16} className="text-brand-600" />
                {t('visualTruck.cargoDeck')}
              </h2>
              <Badge tone="blue">{filteredPackages.length} / {packages.length} items</Badge>
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={cargoSearch}
                onChange={(e) => {
                  setCargoSearch(e.target.value)
                  setCargoPage(1)
                }}
                placeholder={i18n.language === 'th' ? 'ค้นหารหัสสินค้า / ผู้ส่ง...' : 'Search SKU / supplier...'}
                className="w-full text-xs rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <span className="absolute left-2.5 top-2 text-slate-400">
                <Search size={14} />
              </span>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg text-xs font-semibold text-slate-600">
              <button
                onClick={() => { setCargoStatusFilter('all'); setCargoPage(1); }}
                className={`flex-1 py-1 rounded text-center transition-all cursor-pointer ${
                  cargoStatusFilter === 'all' ? 'bg-white text-slate-800 shadow-xs font-bold' : 'hover:text-slate-800'
                }`}
              >
                {i18n.language === 'th' ? 'ทั้งหมด' : 'All'}
              </button>
              <button
                onClick={() => { setCargoStatusFilter('loaded'); setCargoPage(1); }}
                className={`flex-1 py-1 rounded text-center transition-all cursor-pointer ${
                  cargoStatusFilter === 'loaded' ? 'bg-white text-emerald-600 shadow-xs font-bold' : 'hover:text-slate-800'
                }`}
              >
                {i18n.language === 'th' ? 'โหลดแล้ว' : 'Loaded'}
              </button>
              <button
                onClick={() => { setCargoStatusFilter('unloaded'); setCargoPage(1); }}
                className={`flex-1 py-1 rounded text-center transition-all cursor-pointer ${
                  cargoStatusFilter === 'unloaded' ? 'bg-white text-slate-700 shadow-xs font-bold' : 'hover:text-slate-800'
                }`}
              >
                {i18n.language === 'th' ? 'ยังไม่ได้โหลด' : 'Unloaded'}
              </button>
            </div>
          </div>

          {/* Sidebar List - Scrollable */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
            {paginatedPackages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-center text-xs p-5">
                {selectedRouteId ? t('planner.noLocations') : t('visualTruck.emptyRoute')}
              </div>
            ) : (
              paginatedPackages.map(p => {
                const isSelected = selectedPkgId === p.id
                const isBlocked = isLifoBlocked(p.id)
                const placementVal = checkPlacementStatus(p, packages, currentTruckInfo.width, currentTruckInfo.height, currentTruckInfo.length)
                
                return (
                  <div 
                    key={p.id}
                    onClick={() => setSelectedPkgId(isSelected ? null : p.id)}
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex items-center justify-between ${
                      isSelected 
                        ? 'border-brand-500 bg-brand-50/50 ring-2 ring-brand-500/20' 
                        : (!placementVal.valid || isBlocked)
                        ? 'border-red-300 bg-red-50/50 hover:bg-red-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div 
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-sm"
                        style={{ backgroundColor: p.color }}
                      >
                        #{p.stopSeq}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-800 text-xs truncate max-w-[120px]">{p.supplierCode}</span>
                          {p.isPalletized && <Badge tone="blue">Pallet</Badge>}
                          {isBlocked && <Badge tone="red">LIFO</Badge>}
                          {!placementVal.valid && (
                            <Badge tone="red">
                              {placementVal.reason === 'floating' ? 'Floating' : 'Collision'}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 truncate mt-0.5">
                          {p.w}x{p.l}x{p.h}m · {p.volume}m³ · {p.weight}kg
                        </p>
                        {p.isPalletized && p.palletType && (
                          <p className="text-[9px] text-brand-600 font-semibold mt-0.5">
                            {p.palletType === 'wooden' ? (i18n.language === 'th' ? 'พาเลทไม้' : 'Wooden Pallet') : (i18n.language === 'th' ? 'พาเลทพลาสติก' : 'Plastic Pallet')} ({p.unitsPerPallet} u/p)
                          </p>
                        )}
                      </div>
                    </div>
                    
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (p.isLoaded) {
                          handleUnloadSingle(p.id)
                        } else {
                          handleLoadSingle(p.id)
                        }
                      }}
                      className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                        p.isLoaded 
                          ? 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100' 
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                      disabled={unloadState === 'running'}
                    >
                      {p.isLoaded ? <Check size={14} /> : <Play className="rotate-90" size={14} />}
                    </button>
                  </div>
                )
              })
            )}
          </div>

          {/* Sidebar Footer: Pagination Controls */}
          {totalPages > 1 && (
            <div className="p-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs font-semibold text-slate-600">
              <button
                onClick={() => setCargoPage(p => Math.max(1, p - 1))}
                disabled={cargoPage === 1}
                className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                &larr; Prev
              </button>
              <span>
                Page {cargoPage} of {totalPages}
              </span>
              <button
                onClick={() => setCargoPage(p => Math.min(totalPages, p + 1))}
                disabled={cargoPage === totalPages}
                className="px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                Next &rarr;
              </button>
            </div>
          )}
        </div>

        {/* 3D CANVAS VIEWPORT (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col min-h-[500px] lg:min-h-0 bg-white rounded-xl border border-slate-200 overflow-hidden relative shadow-sm h-full">
          
          {/* --- FLOATING OVERLAYS --- */}

          {/* 1. TOP-RIGHT: CAPACITY METRICS (Volume & Weight Gauges) */}
          <div className="absolute top-3 right-3 z-10 flex flex-col gap-2.5 max-w-[220px] bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/50 dark:border-slate-800/50 shadow-lg rounded-2xl p-3 text-slate-800 pointer-events-auto">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Layers size={12} className="text-brand-600" />
              {t('visualTruck.utilization')}
            </h3>
            
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              <div className="flex flex-col items-center justify-center p-1.5 bg-slate-50/40 rounded-lg">
                <div className="relative w-12 h-12">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="24" cy="24" r="20" className="stroke-slate-200 fill-none" strokeWidth="4" />
                    <circle 
                      cx="24" cy="24" r="20" 
                      className={`fill-none transition-all duration-500 ${
                        totals.volumePct > 90 ? 'stroke-red-500' : totals.volumePct > 75 ? 'stroke-amber-500' : 'stroke-emerald-500'
                      }`} 
                      strokeWidth="4" 
                      strokeDasharray={`${2 * Math.PI * 20}`} 
                      strokeDashoffset={`${2 * Math.PI * 20 * (1 - totals.volumePct / 100)}`} 
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-slate-800">{totals.volumePct}%</span>
                  </div>
                </div>
                <span className="text-[8px] font-semibold text-slate-500 mt-1 text-center leading-tight">Vol %</span>
              </div>

              <div className="flex flex-col items-center justify-center p-1.5 bg-slate-50/40 rounded-lg">
                <div className="relative w-12 h-12">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="24" cy="24" r="20" className="stroke-slate-200 fill-none" strokeWidth="4" />
                    <circle 
                      cx="24" cy="24" r="20" 
                      className={`fill-none transition-all duration-500 ${
                        totals.weightPct > 95 ? 'stroke-red-500' : totals.weightPct > 80 ? 'stroke-amber-500' : 'stroke-emerald-500'
                      }`} 
                      strokeWidth="4" 
                      strokeDasharray={`${2 * Math.PI * 20}`} 
                      strokeDashoffset={`${2 * Math.PI * 20 * (1 - totals.weightPct / 100)}`} 
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-slate-800">{totals.weightPct}%</span>
                  </div>
                </div>
                <span className="text-[8px] font-semibold text-slate-500 mt-1 text-center leading-tight">Wt %</span>
              </div>
            </div>
            
            <div className="text-[9px] text-slate-500 flex justify-between bg-slate-100/50 p-1.5 rounded-lg mt-1">
              <span>Dim:</span>
              <span className="font-semibold text-slate-700">{currentTruckInfo.width}m×{currentTruckInfo.length}m×{currentTruckInfo.height}m</span>
            </div>
          </div>

          {/* 2. BOTTOM-LEFT: AXLE LOAD & SAFETY RATING */}
          <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-2.5 max-w-[280px] bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border border-slate-200/50 dark:border-slate-800/50 shadow-lg rounded-2xl p-3 text-slate-800 pointer-events-auto">
            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 border-b border-slate-100 pb-1">
              <Navigation size={12} className="rotate-45 text-brand-600" />
              {t('visualTruck.axleLoad')} &amp; Stability
            </h3>

            {/* Steer/Drive Axle Load bars */}
            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-[9px] mb-0.5 font-medium text-slate-600">
                  <span>Front (Steer)</span>
                  <span className={axleLoads.frontOverloaded ? 'text-red-600 font-bold' : 'text-slate-600'}>
                    {axleLoads.frontWeight.toLocaleString()} / {axleLoads.frontLimit.toLocaleString()} kg
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-200/50 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${
                      axleLoads.frontOverloaded ? 'bg-red-500' : axleLoads.frontPct > 80 ? 'bg-amber-500' : 'bg-brand-500'
                    }`}
                    style={{ width: `${axleLoads.frontPct}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[9px] mb-0.5 font-medium text-slate-600">
                  <span>Rear (Drive)</span>
                  <span className={axleLoads.rearOverloaded ? 'text-red-600 font-bold' : 'text-slate-600'}>
                    {axleLoads.rearWeight.toLocaleString()} / {axleLoads.rearLimit.toLocaleString()} kg
                  </span>
                </div>
                <div className="w-full h-1.5 bg-slate-200/50 rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${
                      axleLoads.rearOverloaded ? 'bg-red-500' : axleLoads.rearPct > 80 ? 'bg-amber-500' : 'bg-brand-500'
                    }`}
                    style={{ width: `${axleLoads.rearPct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* CoG Balance Graphic */}
            <div className="flex items-center gap-3 border-t border-slate-100 pt-2 mt-1">
              <div className="relative w-20 h-14 bg-slate-200/50 rounded border border-slate-300/40 overflow-hidden flex-shrink-0">
                <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-slate-400/30"></div>
                <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-slate-400/30"></div>
                <div className="absolute left-[35%] right-[35%] top-[25%] bottom-[25%] border border-dashed border-emerald-500/50 bg-emerald-500/5 rounded-sm"></div>
                <div 
                  className={`absolute w-2.5 h-2.5 -mt-1.25 -ml-1.25 rounded-full border border-white shadow shadow-emerald-500/40 ${
                    centerOfGravity.status === 'balanced' ? 'bg-emerald-500' : 'bg-red-500'
                  }`}
                  style={{
                    left: `${centerOfGravity.x * 100}%`,
                    top: `${centerOfGravity.z * 100}%`
                  }}
                />
              </div>

              <div className="flex-1 flex flex-col justify-center leading-tight">
                <span className="text-[9px] font-semibold text-slate-400">Balance:</span>
                <span className={`text-xs font-bold uppercase ${
                  centerOfGravity.status === 'balanced' ? 'text-emerald-600' : 'text-rose-600'
                }`}>
                  {centerOfGravity.status === 'balanced' ? t('visualTruck.stabilityPerfect') : 'Unbalanced'}
                </span>
              </div>
            </div>

            {/* Warn box if overloaded */}
            {(axleLoads.frontOverloaded || axleLoads.rearOverloaded) && (
              <div className="p-1.5 bg-red-50/80 border border-red-200/50 rounded-lg text-red-700 text-[8.5px] leading-tight flex items-start gap-1 font-medium">
                <AlertTriangle size={11} className="text-red-600 flex-shrink-0 mt-0.5" />
                <span>{t('visualTruck.axleOverloadWarning')}</span>
              </div>
            )}
          </div>

          {/* 3. FLOATING INFO TRIGGER */}
          <button 
            onClick={() => setShowControlsHelp(prev => !prev)}
            className="absolute top-3 left-3 z-10 w-9 h-9 flex items-center justify-center bg-white/70 hover:bg-white text-slate-700 border border-slate-200/50 rounded-full shadow-lg backdrop-blur-md transition-all cursor-pointer pointer-events-auto"
            title="Show Controls Guide"
          >
            <Info size={18} />
          </button>

          {showControlsHelp && (
            <div className="absolute top-14 left-3 z-10 bg-slate-900/90 text-white rounded-xl p-3 max-w-xs text-[11px] backdrop-blur-md shadow-2xl border border-white/10 pointer-events-auto flex gap-2 animate-fade-in">
              <Info size={16} className="text-sky-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold border-b border-white/20 pb-1 mb-1">{t('visualTruck.controls')}</p>
                <p className="text-slate-300 leading-relaxed">{t('visualTruck.controlsHelp')}</p>
              </div>
            </div>
          )}

          {/* 4. LIFO VIOLATION ALERTS FLOATING (Only if violations exist) */}
          {lifoViolations.length > 0 && (
            <div className="absolute top-3 left-14 z-10 p-2.5 max-w-xs bg-red-50/90 backdrop-blur-md border border-red-200 shadow-md rounded-xl pointer-events-auto">
              <h3 className="text-[10px] font-bold text-red-800 flex items-center gap-1 mb-1 uppercase">
                <AlertTriangle size={12} className="text-red-600" />
                LIFO Violations ({lifoViolations.length})
              </h3>
              <div className="max-h-20 overflow-y-auto flex flex-col gap-0.5 pr-1">
                {lifoViolations.slice(0, 2).map((v, i) => (
                  <div key={i} className="text-[9px] text-red-700 bg-red-100/30 p-1 rounded">
                    Stop #{v.earlyPkg.stopSeq} ({v.earlyPkg.supplierCode}) is blocked by Stop #{v.latePkg.stopSeq} ({v.latePkg.supplierCode})
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Canvas container */}
          <div ref={containerRef} className="flex-1 w-full h-full relative bg-slate-50"></div>

          {/* Bottom detail toolbar of the selected package */}
          {selectedPkg && (
            <div className="p-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-slide-up">
              <div className="flex items-center gap-3">
                <div 
                  className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                  style={{ backgroundColor: selectedPkg.color }}
                >
                  #{selectedPkg.stopSeq}
                </div>
                <div>
                  <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2">
                    {selectedPkg.supplierCode} — {i18n.language === 'th' ? selectedPkg.supplierNameTh : selectedPkg.supplierName}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                    <span>{t('visualTruck.volume')}: <strong>{selectedPkg.volume} m³</strong></span>
                    <span>•</span>
                    <span>{t('visualTruck.weight')}: <strong>{selectedPkg.weight} kg</strong></span>
                    <span>•</span>
                    <span>Status: 
                      <strong className={selectedPkg.isLoaded ? 'text-emerald-600' : 'text-slate-500'}>
                        {selectedPkg.isLoaded ? ` ${t('visualTruck.loadedStatus')} (x: ${selectedPkg.x}, y: ${selectedPkg.y}, z: ${selectedPkg.z})` : ` ${t('visualTruck.notLoaded')}`}
                      </strong>
                    </span>
                  </div>

                  {selectedProduct?.images && selectedProduct.images.length > 0 && (
                    <div className="flex gap-1.5 mt-2">
                      {selectedProduct.images.map((img, idx) => (
                        <img 
                          key={idx} 
                          src={img} 
                          alt="product thumb" 
                          className="w-10 h-10 rounded border border-slate-200 object-cover cursor-zoom-in hover:scale-110 hover:shadow-md transition-all"
                          onClick={() => setActivePreviewImage(img)}
                        />
                      ))}
                    </div>
                  )}
                  
                  {/* Validation Alerts */}
                  {!selectedPkgValidation.valid && (
                    <div className="text-[10px] text-red-500 font-semibold mt-1 flex items-center gap-1 animate-pulse">
                      <AlertTriangle size={12} />
                      <span>
                        {selectedPkgValidation.reason === 'floating' 
                          ? t('visualTruck.unsupportedWarning')
                          : 'Package overlaps or collides with another package!'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              
              {/* Position tweaking & rotation controls */}
              <div className="flex flex-wrap items-center gap-2">
                {selectedPkg.isLoaded && (
                  <>
                    <div className="flex bg-slate-100 rounded-lg p-1 text-xs">
                      <span className="px-2 py-1 font-bold text-slate-500">X: {selectedPkg.x}m</span>
                      <button onClick={() => adjustPackagePos('x', -0.1)} className="px-2 py-1 bg-white hover:bg-slate-200 border border-slate-200 rounded font-semibold cursor-pointer mr-1">-</button>
                      <button onClick={() => adjustPackagePos('x', 0.1)} className="px-2 py-1 bg-white hover:bg-slate-200 border border-slate-200 rounded font-semibold cursor-pointer">+</button>
                    </div>
                    <div className="flex bg-slate-100 rounded-lg p-1 text-xs">
                      <span className="px-2 py-1 font-bold text-slate-500">Z: {selectedPkg.z}m</span>
                      <button onClick={() => adjustPackagePos('z', -0.1)} className="px-2 py-1 bg-white hover:bg-slate-200 border border-slate-200 rounded font-semibold cursor-pointer mr-1">-</button>
                      <button onClick={() => adjustPackagePos('z', 0.1)} className="px-2 py-1 bg-white hover:bg-slate-200 border border-slate-200 rounded font-semibold cursor-pointer">+</button>
                    </div>
                  </>
                )}
                
                {/* 90 degree rotate button */}
                <Button 
                  variant="secondary" 
                  onClick={handleRotateSelected} 
                  title={t('visualTruck.rotateHint')}
                  className="!px-2.5 !py-1 text-xs"
                >
                  <RotateCw size={14} />
                  <span>{t('visualTruck.rotate')}</span>
                </Button>

                {selectedPkg.isLoaded && (
                  <Button 
                    variant="ghost" 
                    className="p-2 border border-red-200 text-red-600 hover:bg-red-50 cursor-pointer"
                    onClick={() => handleUnloadSingle(selectedPkg.id)}
                  >
                    <Trash2 size={15} />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {activePreviewImage && (
        <Modal title={selectedPkg?.supplierName || 'Product Image'} onClose={() => setActivePreviewImage(null)}>
          <div className="flex items-center justify-center p-2 bg-slate-50 rounded-lg">
            <img src={activePreviewImage} alt="Enlarged product" className="max-w-full max-h-[70vh] rounded-lg object-contain shadow-lg" />
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={() => setActivePreviewImage(null)}>{t('common.close') || 'Close'}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
