
// 顯示設定：讓 x>0 出現在畫面右側（右腦在右）
const X_RIGHT_ON_SCREEN_RIGHT = true;

import { useEffect, useMemo, useRef, useState } from 'react'
import * as nifti from 'nifti-reader-js'

const MNI_BG_URL = 'static/mni_2mm.nii.gz'

// Detect MNI152 2mm template dims & spacing (91x109x91, 2mm iso)
function isStandardMNI2mm(dims, voxelMM) {
  const okDims = Array.isArray(dims) && dims[0]===91 && dims[1]===109 && dims[2]===91;
  const okSp   = voxelMM && Math.abs(voxelMM[0]-2)<1e-3 && Math.abs(voxelMM[1]-2)<1e-3 && Math.abs(voxelMM[2]-2)<1e-3;
  return okDims && okSp;
}
// Standard MNI152 2mm affine (voxel i,j,k -> MNI mm):
// x = -2*i + 90;  y = 2*j - 126;  z = 2*k - 72
const MNI2MM = { x0: 90, y0: -126, z0: -72, vx: 2, vy: 2, vz: 2 };

export function NiiViewer({ query, studyId = null }) {
  const [loadingBG, setLoadingBG] = useState(false)
  const [loadingMap, setLoadingMap] = useState(false)
  const [errBG, setErrBG] = useState('')
  const [errMap, setErrMap] = useState('')
  const [studyPoints, setStudyPoints] = useState([])

  // backend params (map generation)
  const [voxel] = useState(2.0)
  const [fwhm, setFwhm] = useState(10.0)
  const [kernel] = useState('gauss')
  const [r] = useState(6.0)

  // overlay controls
  const [overlayAlpha, setOverlayAlpha] = useState(0.5)
  const [posOnly] = useState(true)
  const [useAbs] = useState(false)
  const [thrMode, setThrMode] = useState('pctl') // default: Percentile (per request)
  const [pctl, setPctl] = useState(95)
  const [thrValue, setThrValue] = useState(0)     // used when mode === 'value'

  // volumes
  const bgRef  = useRef(null)   // { data, dims:[nx,ny,nz], voxelMM:[vx,vy,vz], min, max }
  const mapRef = useRef(null)   // { data, dims:[nx,ny,nz], voxelMM:[vx,vy,vz], min, max }
  const getVoxelMM = () => {
    const vm = bgRef.current?.voxelMM ?? mapRef.current?.voxelMM ?? [1,1,1]
    return { x: vm[0], y: vm[1], z: vm[2] }
  }
  const [dims, setDims] = useState([0,0,0]) // canvas dims (prefer BG; overlay only if same dims)

  // slice indices (voxel coordinates in [0..N-1])
  const [ix, setIx] = useState(0) // sagittal (X)
  const [iy, setIy] = useState(0) // coronal  (Y)
  const [iz, setIz] = useState(0) // axial    (Z)

  // Neurosynth-style displayed coords: signed, centered at middle voxel
  const [cx, setCx] = useState('0')
  const [cy, setCy] = useState('0')
  const [cz, setCz] = useState('0')

  const canvases = [useRef(null), useRef(null), useRef(null)]

  const mapUrl = useMemo(() => {
    if (!query) return ''
    const u = new URL(`/query/${encodeURIComponent(query)}/nii`, window.location.origin)
    u.searchParams.set('voxel', String(voxel))
    u.searchParams.set('fwhm', String(fwhm))
    u.searchParams.set('kernel', String(kernel))
    u.searchParams.set('r', String(r))
    if (studyId != null && studyId !== '') u.searchParams.set('study_id', String(studyId))
    return u.pathname + u.search
  }, [query, studyId, voxel, fwhm, kernel, r])

  // ---------- utils ----------
  function asTypedArray (header, buffer) {
    switch (header.datatypeCode) {
      case nifti.NIFTI1.TYPE_INT8:    return new Int8Array(buffer)
      case nifti.NIFTI1.TYPE_UINT8:   return new Uint8Array(buffer)
      case nifti.NIFTI1.TYPE_INT16:   return new Int16Array(buffer)
      case nifti.NIFTI1.TYPE_UINT16:  return new Uint16Array(buffer)
      case nifti.NIFTI1.TYPE_INT32:   return new Int32Array(buffer)
      case nifti.NIFTI1.TYPE_UINT32:  return new Uint32Array(buffer)
      case nifti.NIFTI1.TYPE_FLOAT32: return new Float32Array(buffer)
      case nifti.NIFTI1.TYPE_FLOAT64: return new Float64Array(buffer)
      default: return new Float32Array(buffer)
    }
  }
  function minmax (arr) {
    let mn =  Infinity, mx = -Infinity
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    return [mn, mx]
  }
  function percentile(arr, p, step=Math.ceil(arr.length/200000)) {
    if (!arr.length) return 0
    const samp = []
    // Ignore empty voxels. Including the large zero background made the 95th
    // percentile equal zero, turning every nonzero voxel into a hard-edged box.
    for (let i=0; i<arr.length; i+=step) if (arr[i] > 0) samp.push(arr[i])
    if (!samp.length) return 0
    samp.sort((a,b)=>a-b)
    const k = Math.floor((p/100) * (samp.length - 1))
    return samp[Math.max(0, Math.min(samp.length-1, k))]
  }
  async function loadNifti(url) {
    const res = await fetch(url)
    if (!res.ok) {
      const t = await res.text().catch(()=> '')
      throw new Error(`GET ${url} → ${res.status} ${t}`)
    }
    let ab = await res.arrayBuffer()
    if (nifti.isCompressed(ab)) ab = nifti.decompress(ab)
    if (!nifti.isNIFTI(ab)) throw new Error('not a NIfTI file')
    const header = nifti.readHeader(ab)
    const image  = nifti.readImage(header, ab)
    const ta     = asTypedArray(header, image)
    let f32
    if (ta instanceof Float32Array) f32 = ta
    else if (ta instanceof Float64Array) f32 = Float32Array.from(ta)
    else {
      const [mn, mx] = minmax(ta)
      const range = (mx - mn) || 1
      f32 = new Float32Array(ta.length)
      for (let i=0;i<ta.length;i++) f32[i] = (ta[i] - mn) / range
    }
    const nx = header.dims[1] | 0
    const ny = header.dims[2] | 0
    const nz = header.dims[3] | 0
    if (!nx || !ny || !nz) throw new Error('invalid dims')
    const [mn, mx] = minmax(f32)
    const vx = Math.abs(header.pixDims?.[1] ?? 1)
    const vy = Math.abs(header.pixDims?.[2] ?? 1)
    const vz = Math.abs(header.pixDims?.[3] ?? 1)
    return { data: f32, dims:[nx,ny,nz], voxelMM:[vx,vy,vz], min: mn, max: mx }
  }

  // helpers: convert between index [0..N-1] and neurosynth-style signed coord centered at mid voxel
  // Display conventions to match Neurosynth-like UI:
  //  - X: right-positive
  //  - Y: anterior-positive (but screen vertical is flipped), so invert sign
  //  - Z: superior-positive (also vertical), invert sign
  const AXIS_SIGN = { x: -1, y: 1, z: 1 } // X is neg for index<->coord mapping only when not using standard MNI affine
  const idx2coord = (i, n, axis) => {
    const [nx, ny, nz] = dims;
    const { x: vx, y: vy, z: vz } = getVoxelMM();
    const isStd = isStandardMNI2mm([nx, ny, nz], [vx, vy, vz]);
    if (isStd) {
      if (axis === 'x') return (-MNI2MM.vx * i + MNI2MM.x0);
      if (axis === 'y') return ( MNI2MM.vy * i + MNI2MM.y0);
      if (axis === 'z') return ( MNI2MM.vz * i + MNI2MM.z0);
    }
    const mmPerVoxel = axis === 'x' ? vx : axis === 'y' ? vy : vz;
    return AXIS_SIGN[axis] * (i - Math.floor(n/2)) * mmPerVoxel;
  }
const coord2idx = (c_mm, n, axis) => {
    const [nx, ny, nz] = dims;
    const { x: vx, y: vy, z: vz } = getVoxelMM();
    const isStd = isStandardMNI2mm([nx, ny, nz], [vx, vy, vz]);
    if (isStd) {
      let v;
      if (axis === 'x') v = ( (MNI2MM.x0 - c_mm) / MNI2MM.vx );
      else if (axis === 'y') v = ( (c_mm - MNI2MM.y0) / MNI2MM.vy );
      else v = ( (c_mm - MNI2MM.z0) / MNI2MM.vz );
      const idx = Math.round(v);
      return Math.max(0, Math.min(n-1, idx));
    }
    const mmPerVoxel = axis === 'x' ? vx : axis === 'y' ? vy : vz;
    const sign = AXIS_SIGN[axis];
    const v = (sign * (c_mm / mmPerVoxel)) + Math.floor(n/2);
    const idx = Math.round(v);
    return Math.max(0, Math.min(n-1, idx));
  }

  // load background on mount
  useEffect(() => {
    let alive = true
    setLoadingBG(true); setErrBG('')
    ;(async () => {
      try {
        const bg = await loadNifti(MNI_BG_URL)
        if (!alive) return
        bgRef.current = bg
        // Always prefer BG dims for the canvas
        setDims(bg.dims)
        const [nx,ny,nz] = bg.dims
        const mx = Math.floor(nx/2), my = Math.floor(ny/2), mz = Math.floor(nz/2)
        setIx(mx); setIy(my); setIz(mz)
        setCx('0'); setCy('0'); setCz('0')
      } catch (e) {
        if (!alive) return
        setErrBG(e?.message || String(e))
        bgRef.current = null
      } finally {
        if (alive) setLoadingBG(false)
      }
    })()
    return () => { alive = false }
  }, [])

  
  // keep thrValue within current map range when map changes
  useEffect(() => {
    const mn = mapRef.current?.min ?? 0
    const mx = mapRef.current?.max ?? 1
    if (thrValue < mn || thrValue > mx) {
      setThrValue(Math.min(mx, Math.max(mn, thrValue)))
    }
  }, [mapRef.current, dims])

// load meta-analytic map when query/params change
  useEffect(() => {
    if (!mapUrl) { mapRef.current = null; return }
    let alive = true
    setLoadingMap(true); setErrMap('')
    ;(async () => {
      try {
        const mv = await loadNifti(mapUrl)
        if (!alive) return
        mapRef.current = mv
        if (!bgRef.current) {
          setDims(mv.dims)
          const [nx,ny,nz] = mv.dims
          const mx = Math.floor(nx/2), my = Math.floor(ny/2), mz = Math.floor(nz/2)
          setIx(mx); setIy(my); setIz(mz)
          setCx('0'); setCy('0'); setCz('0')
        }
      } catch (e) {
        if (!alive) return
        setErrMap(e?.message || String(e))
        mapRef.current = null
      } finally {
        if (alive) setLoadingMap(false)
      }
    })()
    return () => { alive = false }
  }, [mapUrl])

  // Fetch the exact coordinates for the selected study so the slice views can
  // show point markers in addition to the smoothed statistical overlay.
  useEffect(() => {
    if (!query || studyId == null || studyId === '') {
      setStudyPoints([])
      return undefined
    }
    const controller = new AbortController()
    const url = new URL(`/query/${encodeURIComponent(query)}/locations`, window.location.origin)
    url.searchParams.set('study_id', String(studyId))
    fetch(url.pathname + url.search, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`)
        return Array.isArray(data.results) ? data.results : []
      })
      .then((points) => { if (!controller.signal.aborted) setStudyPoints(points) })
      .catch((error) => { if (error.name !== 'AbortError') console.error('Failed to load study coordinates:', error) })
    return () => controller.abort()
  }, [query, studyId])

  // Center all three orthogonal slices on the first reported focus so the
  // exact coordinate marker is immediately visible after selecting a study.
  useEffect(() => {
    if (studyId == null || studyId === '' || !studyPoints.length || !dims[0]) return
    const point = studyPoints.find((item) => [item.x, item.y, item.z].every((value) => Number.isFinite(Number(value))))
    if (!point) return
    const [nx, ny, nz] = dims
    const nextX = coord2idx(Number(point.x), nx, 'x')
    const nextY = coord2idx(Number(point.y), ny, 'y')
    const nextZ = coord2idx(Number(point.z), nz, 'z')
    setIx(nextX); setIy(nextY); setIz(nextZ)
    setCx(String(idx2coord(nextX, nx, 'x')))
    setCy(String(idx2coord(nextY, ny, 'y')))
    setCz(String(idx2coord(nextZ, nz, 'z')))
  }, [studyId, studyPoints, dims])

  const mapThreshold = useMemo(() => {
    const mv = mapRef.current
    if (!mv) return null
    if (thrMode === 'value') return Number(thrValue) || 0
    return percentile(mv.data, Math.max(0, Math.min(100, Number(pctl) || 95)))
  }, [thrMode, thrValue, pctl, mapRef.current])

  // draw one slice (upright orientation via vertical flip)
  function drawSlice (canvas, axis /* 'z' | 'y' | 'x' */, index) {
    const [nx, ny, nz] = dims
    
    // 若要讓 x>0 出現在畫面右側，就在取樣時把 X 軸做水平翻轉
    const sx = (x) => (X_RIGHT_ON_SCREEN_RIGHT ? (nx - 1 - x) : x);
    const bg  = bgRef.current
    const map = mapRef.current

    const dimsStr = dims.join('x')
    const bgOK  = !!(bg  && bg.dims.join('x')  === dimsStr)
    const mapOK = !!(map && map.dims.join('x') === dimsStr)

    let w=0, h=0, getBG=null, getMap=null
    if (axis === 'z') { w = nx; h = ny; if (bgOK)  getBG  = (x,y)=> bg.data[sx(x) + y*nx + index*nx*ny]; if (mapOK) getMap = (x,y)=> map.data[sx(x) + y*nx + index*nx*ny] }
    if (axis === 'y') { w = nx; h = nz; if (bgOK)  getBG  = (x,y)=> bg.data[sx(x) + index*nx + y*nx*ny]; if (mapOK) getMap = (x,y)=> map.data[sx(x) + index*nx + y*nx*ny] }
    if (axis === 'x') { w = ny; h = nz; if (bgOK)  getBG  = (x,y)=> bg.data[index + x*nx + y*nx*ny]; if (mapOK) getMap = (x,y)=> map.data[index + x*nx + y*nx*ny] }

    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: false })
    const img = ctx.createImageData(w, h)

    const alpha = Math.max(0, Math.min(1, overlayAlpha))
    const R = 255, G = 0, B = 0
    const thr = mapThreshold

    // background normalization based on its own min/max
    const bgMin = bg?.min ?? 0
    const bgMax = bg?.max ?? 1
    const bgRange = (bgMax - bgMin) || 1

    let p = 0
    for (let yy=0; yy<h; yy++) {
      const srcY = h - 1 - yy // flip vertically
      for (let xx=0; xx<w; xx++) {
        // draw background
        let gray = 0
        if (getBG) {
          const vbg = getBG(xx, srcY)
          let g = (vbg - bgMin) / bgRange
          if (g < 0) g = 0
          if (g > 1) g = 1
          gray = (g * 255) | 0
        }
        img.data[p    ] = gray
        img.data[p + 1] = gray
        img.data[p + 2] = gray
        img.data[p + 3] = 255

        // overlay map
        if (getMap) {
          let mv = getMap(xx, srcY)
          const raw = mv
          if (useAbs) mv = Math.abs(mv)
          let pass = (thr == null) ? (mv > 0) : (mv >= thr)
          if (posOnly && raw <= 0) pass = false
          if (pass) {
            const max = map?.max ?? 1
            const intensity = max > thr ? Math.max(0, Math.min(1, (mv - (thr ?? 0)) / (max - (thr ?? 0)))) : 1
            const voxelAlpha = alpha * (0.2 + 0.8 * intensity)
            img.data[p    ] = ((1 - voxelAlpha) * img.data[p]     + voxelAlpha * R) | 0
            img.data[p + 1] = ((1 - voxelAlpha) * img.data[p + 1] + voxelAlpha * G) | 0
            img.data[p + 2] = ((1 - voxelAlpha) * img.data[p + 2] + voxelAlpha * B) | 0
          }
        }
        p += 4
      }
    }
    ctx.putImageData(img, 0, 0)

    // draw green crosshairs
    ctx.save()
    ctx.strokeStyle = '#00ff00'
    ctx.lineWidth = 1
    let cx = 0, cy = 0
    if (axis === 'z') { // plane: X by Y
      cx = Math.max(0, Math.min(w-1, (X_RIGHT_ON_SCREEN_RIGHT ? (w - 1 - ix) : ix)))
      cy = Math.max(0, Math.min(h-1, iy))
    } else if (axis === 'y') { // plane: X by Z
      cx = Math.max(0, Math.min(w-1, (X_RIGHT_ON_SCREEN_RIGHT ? (w - 1 - ix) : ix)))
      cy = Math.max(0, Math.min(h-1, iz))
    } else { // axis === 'x' (plane: Y by Z)
      cx = Math.max(0, Math.min(w-1, iy))
      cy = Math.max(0, Math.min(h-1, iz))
    }
    const screenY = h - 1 - cy // account for vertical flip used when drawing
    // vertical line
    ctx.beginPath(); ctx.moveTo(cx + 0.5, 0); ctx.lineTo(cx + 0.5, h); ctx.stroke()
    // horizontal line
    ctx.beginPath(); ctx.moveTo(0, screenY + 0.5); ctx.lineTo(w, screenY + 0.5); ctx.stroke()
    ctx.restore()

    // Draw exact MNI foci above the crosshair for clear, unambiguous locations.
    if (studyPoints.length) {
      const spacing = getVoxelMM()
      const current = axis === 'x'
        ? idx2coord(index, nx, 'x')
        : axis === 'y'
          ? idx2coord(index, ny, 'y')
          : idx2coord(index, nz, 'z')
      studyPoints.forEach((point) => {
        const px = Number(point.x), py = Number(point.y), pz = Number(point.z)
        if (![px, py, pz].every(Number.isFinite)) return
        const planeCoord = axis === 'x' ? px : axis === 'y' ? py : pz
        const tolerance = (axis === 'x' ? spacing.x : axis === 'y' ? spacing.y : spacing.z) / 2 + 0.01
        if (Math.abs(planeCoord - current) > tolerance) return

        let markerX, markerY
        if (axis === 'z') {
          const pointX = coord2idx(px, nx, 'x')
          const pointY = coord2idx(py, ny, 'y')
          markerX = X_RIGHT_ON_SCREEN_RIGHT ? nx - 1 - pointX : pointX
          markerY = h - 1 - pointY
        } else if (axis === 'y') {
          const pointX = coord2idx(px, nx, 'x')
          const pointZ = coord2idx(pz, nz, 'z')
          markerX = X_RIGHT_ON_SCREEN_RIGHT ? nx - 1 - pointX : pointX
          markerY = h - 1 - pointZ
        } else {
          markerX = coord2idx(py, ny, 'y')
          markerY = h - 1 - coord2idx(pz, nz, 'z')
        }
        const x = markerX + 0.5, y = markerY + 0.5
        ctx.beginPath(); ctx.arc(x, y, 4.2, 0, Math.PI * 2)
        ctx.lineWidth = 1.6; ctx.strokeStyle = '#101820'; ctx.stroke()
        ctx.beginPath(); ctx.arc(x, y, 3.1, 0, Math.PI * 2)
        ctx.lineWidth = 1.4; ctx.strokeStyle = '#ffffff'; ctx.stroke()
        ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2)
        ctx.fillStyle = '#ffe600'; ctx.fill()
      })
    }
  }

  // click-to-move crosshairs
  function onCanvasClick (e, axis) {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) * canvas.width / rect.width)
    const y = Math.floor((e.clientY - rect.top) * canvas.height / rect.height)
    const srcY = canvas.height - 1 - y // invert because we draw with vertical flip
    const [nx,ny,nz] = dims
    
    const toIdxX = (screenX) => (X_RIGHT_ON_SCREEN_RIGHT ? (nx - 1 - screenX) : screenX);
    if (axis === 'z') { const xi = toIdxX(x); setIx(xi); setIy(srcY); setCx(String(idx2coord(xi, nx, 'x'))); setCy(String(idx2coord(srcY, ny, 'y'))) }
    else if (axis === 'y') { const xi = toIdxX(x); setIx(xi); setIz(srcY); setCx(String(idx2coord(xi, nx, 'x'))); setCz(String(idx2coord(srcY, nz, 'z'))) }
    else { setIy(x); setIz(srcY); setCy(String(idx2coord(x, ny, 'y'))); setCz(String(idx2coord(srcY, nz, 'z'))) }
  }

  // keep display coords in sync when ix/iy/iz/dims change (e.g., after loads)
  useEffect(() => {
    const [nx,ny,nz] = dims
    if (!nx) return
    setCx(String(idx2coord(ix, nx, 'x')))
    setCy(String(idx2coord(iy, ny, 'y')))
    setCz(String(idx2coord(iz, nz, 'z')))
  }, [ix,iy,iz,dims])

  // commit handlers: parse signed integer, map to index, clamp to volume
  const commitCoord = (axis) => {
    const [nx,ny,nz] = dims
    let vStr = axis==='x' ? cx : axis==='y' ? cy : cz
    // allow empty / '-' temporary states
    if (vStr === '' || vStr === '-' ) return
    const parsed = parseFloat(vStr)
    if (Number.isNaN(parsed)) return
    if (axis==='x') setIx(coord2idx(parsed, nx, 'x'))
    if (axis==='y') setIy(coord2idx(parsed, ny, 'y'))
    if (axis==='z') setIz(coord2idx(parsed, nz, 'z'))
  }

  // redraw on state changes
  useEffect(() => {
    const [nx, ny, nz] = dims
    if (!nx) return
    const c0 = canvases[0].current, c1 = canvases[1].current, c2 = canvases[2].current
    if (c0 && iz >=0 && iz < nz) drawSlice(c0, 'z', iz)
    if (c1 && iy >=0 && iy < ny) drawSlice(c1, 'y', iy)
    if (c2 && ix >=0 && ix < nx) drawSlice(c2, 'x', ix)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dims, ix, iy, iz,
    overlayAlpha, posOnly, useAbs, thrMode, pctl, thrValue,
    loadingBG, loadingMap, errBG, errMap, query, studyPoints
  ])

  const hasVolume = dims[0] > 0

  // slice configs (labels only; numbers removed)
  const sliceConfigs = [
    { key: 'y', name: 'Coronal',  axisLabel: 'Y', canvasRef: canvases[1] },
    { key: 'x', name: 'Sagittal', axisLabel: 'X', canvasRef: canvases[2] },
    { key: 'z', name: 'Axial',    axisLabel: 'Z', canvasRef: canvases[0] },
  ]

  // shared small input styles to mimic Neurosynth (compact bordered boxes)
  const nsInputCls = 'w-16 rounded border border-gray-400 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400'
  const nsLabelCls = 'mr-1 text-sm'

  return (
    <div className='nii-viewer'>
      {/* --- Threshold mode & value --- */}
      <div className='nii-viewer__controls'>
        <label className='flex items-center gap-2'>
          <span>Threshold mode</span>
          <select value={thrMode} onChange={e=>setThrMode(e.target.value)} className='rounded-lg border px-2 py-1'>
            <option value='value'>Value</option>
            <option value='pctl'>Percentile</option>
          </select>
        </label>
        {thrMode === 'value' ? (
          <>
            <label className='flex items-center gap-2'>
              <span>Threshold</span>
              <input type='number' step='0.01' value={thrValue} onChange={e=>setThrValue(Number(e.target.value))} className='w-28 rounded-lg border px-2 py-1' />
            </label>
          </>
        ) : (
          <>
            <label className='flex items-center gap-2'>
              <span>Percentile</span>
              <input type='number' min={50} max={99.9} step={0.5} value={pctl} onChange={e=>setPctl(Number(e.target.value)||95)} className='w-24 rounded-lg border px-2 py-1' />
            </label>
          </>
        )}

        {/* Neurosynth-style coordinate inputs (signed, centered at 0) */}
        <div className='nii-viewer__coords'>
          <label className='flex items-center'>
            <span className={nsLabelCls}>X (mm):</span>
            <input
              type='text' inputMode='decimal' pattern='-?[0-9]*([.][0-9]+)?'
              className={nsInputCls}
              value={cx}
              onChange={e=>setCx(e.target.value)}
              onBlur={()=>commitCoord('x')}
              onKeyDown={e=>{ if(e.key==='Enter'){ commitCoord('x') } }}
              aria-label='X coordinate (centered)'
            />
          </label>
          <label className='flex items-center'>
            <span className={nsLabelCls}>Y (mm):</span>
            <input
              type='text' inputMode='decimal' pattern='-?[0-9]*([.][0-9]+)?'
              className={nsInputCls}
              value={cy}
              onChange={e=>setCy(e.target.value)}
              onBlur={()=>commitCoord('y')}
              onKeyDown={e=>{ if(e.key==='Enter'){ commitCoord('y') } }}
              aria-label='Y coordinate (centered)'
            />
          </label>
          <label className='flex items-center'>
            <span className={nsLabelCls}>Z (mm):</span>
            <input
              type='text' inputMode='decimal' pattern='-?[0-9]*([.][0-9]+)?'
              className={nsInputCls}
              value={cz}
              onChange={e=>setCz(e.target.value)}
              onBlur={()=>commitCoord('z')}
              onKeyDown={e=>{ if(e.key==='Enter'){ commitCoord('z') } }}
              aria-label='Z coordinate (centered)'
            />
          </label>
        </div>
      </div>

      {/* --- Brain views --- */}
      {(loadingBG || loadingMap) && (
        <div className='grid gap-3 lg:grid-cols-3'>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className='h-64 animate-pulse rounded-xl border bg-gray-100' />
          ))}
        </div>
      )}
      {(errBG || errMap) && (
        <div className='rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800'>
          {errBG && <div>Background: {errBG}</div>}
          {errMap && <div>Map: {errMap}</div>}
        </div>
      )}

      {hasVolume && (
        <div className='nii-viewer__slices'>
          {sliceConfigs.map(({ key, name, axisLabel, canvasRef }) => (
            <div key={key} className='nii-viewer__slice'>
              <div className='nii-viewer__slice-title'>{name} ({axisLabel})</div>
              <div>
                <canvas ref={canvasRef} className='h-64 w-full rounded-xl border' onClick={(e)=>onCanvasClick(e, key)} style={{ cursor: 'crosshair' }} />
              </div>
            </div>
          ))}
        </div>
      )}
      {(query || (studyId && studyPoints.length > 0)) && (
        <div className='nii-viewer__slice-footer'>
          {studyId && studyPoints.length > 0 ? (
            <div className='nii-viewer__legend' aria-label='Brain map legend'>
              <span><i className='nii-viewer__legend-point' />Reported MNI coordinate</span>
              <span><i className='nii-viewer__legend-map' />Smoothed activation map</span>
            </div>
          ) : <span />}
          {query && <a href={mapUrl} className='nii-viewer__download'>Download map</a>}
        </div>
      )}

      {/* map generation params */}
      <div className='nii-viewer__range'>
        <label className='flex flex-col'>Gaussian FWHM:
          <input type='number' step='0.5' value={fwhm} onChange={e=>setFwhm(Number(e.target.value)||0)} className='w-28 rounded-lg border px-2 py-1'/>
        </label>
      </div>

      {/* overlay controls */}
      <div className='nii-viewer__range'>
        <label className='flex items-center gap-2'>
          <span>Overlay alpha</span>
          <input type='range' min={0} max={1} step={0.05} value={overlayAlpha} onChange={e=>setOverlayAlpha(Number(e.target.value))} className='w-40' />
        </label>
      </div>
    </div>
  )
}
