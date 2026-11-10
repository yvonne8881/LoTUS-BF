import React, { useEffect, useRef, useState } from 'react'
import { Niivue } from '@niivue/niivue'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4

export function Brain3DViewer ({ query, studyId = null }) {
  const canvasRef = useRef(null)
  const nvRef = useRef(null)
  const zoomRef = useRef(1)
  const [opacity, setOpacity] = useState(0.4)
  const [loading, setLoading] = useState(false)
  const [viewerReady, setViewerReady] = useState(false)
  const [viewerError, setViewerError] = useState('')
  const [pointCount, setPointCount] = useState(0)
  const [selectedPoint, setSelectedPoint] = useState(null)

  useEffect(() => {
    let cancelled = false
    const nv = new Niivue({
      show3Dcrosshair: false,
      backColor: [0.05, 0.08, 0.12, 1],
      isOrientCube: true
    })
    nvRef.current = nv

    // Niivue draws connectome nodes as spheres, but its built-in click target
    // is the legend label. Keep the last 3D projection and use it to map a
    // click on a sphere back to that node, without drawing labels or leader
    // lines in the brain view.
    const drawLabels = nv.draw3DLabels.bind(nv)
    nv.draw3DLabels = (mvpMatrix, bounds, ...args) => {
      nv._mniProjection = { mvpMatrix, bounds }
      return drawLabels(mvpMatrix, bounds, ...args)
    }
    const getLabelAtPoint = nv.getLabelAtPoint.bind(nv)
    nv.getLabelAtPoint = (screenPoint) => {
      const projection = nv._mniProjection
      const nodes = nv._mniNodes || []
      if (projection && nodes.length && typeof nv.calculateScreenPoint === 'function') {
        const hitRadius = 14 * (nv.uiData?.dpr || 1)
        let closest = null
        let closestDistance = hitRadius
        for (const node of nodes) {
          const point = nv.calculateScreenPoint(
            [node.x, node.y, node.z],
            projection.mvpMatrix,
            projection.bounds
          )
          if (point[2] < 0 || point[2] > 1) continue
          const distance = Math.hypot(point[0] - screenPoint[0], point[1] - screenPoint[1])
          if (distance < closestDistance) {
            closest = node
            closestDistance = distance
          }
        }
        if (closest?.label) return closest.label
      }
      return getLabelAtPoint(screenPoint)
    }

    const initialize = async () => {
      try {
        await nv.attachToCanvas(canvasRef.current)
        if (cancelled) return

        // Use Niivue's public high-DPI method; `isHighResolution` is not a
        // supported constructor option in the project's Niivue version.
        nv.setHighResolutionCapable(true)
        nv.setSliceType(nv.sliceTypeRender)
        // Keep the volume translucent enough for the MNI coordinate spheres
        // to remain visible inside the brain instead of being hidden by it.
        await nv.loadVolumes([{ url: '/static/mni_2mm.nii.gz', opacity: 0.4 }])
        if (cancelled) return

        await nv.setVolumeRenderIllumination(0.7)
        if (cancelled) return
        nv.setScale(zoomRef.current)
        setViewerReady(true)
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to initialize 3D brain viewer:', error)
          setViewerError('腦影像載入失敗，請稍後重試。')
        }
      }
    }

    initialize()
    return () => {
      cancelled = true
      if (nvRef.current === nv) nvRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!query || !viewerReady || !nvRef.current) {
      setPointCount(0)
      setSelectedPoint(null)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    const locationsUrl = new URL(`/query/${encodeURIComponent(query)}/locations`, window.location.origin)
    if (studyId != null && studyId !== '') locationsUrl.searchParams.set('study_id', String(studyId))

    fetch(locationsUrl.pathname + locationsUrl.search, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`)
        return data
      })
      .then((data) => {
        if (!Array.isArray(data.results) || !nvRef.current) return
        setPointCount(data.results.length)
        setSelectedPoint(null)
        const nodes = data.results.map((pt, index) => ({
          // Empty names leave only the small coordinate sphere visible.
          name: '',
          x: pt.x,
          y: pt.y,
          z: pt.z,
          colorValue: 1,
          sizeValue: 1
        }))
        const nv = nvRef.current
        nv.loadConnectome({
          name: 'MNI activation coordinates',
          nodeColormap: 'red',
          nodeColormapNegative: 'red',
          nodeMinColor: 0,
          nodeMaxColor: 1,
          nodeScale: 5,
          edgeColormap: 'red',
          edgeColormapNegative: 'red',
          edgeMin: 0,
          edgeMax: 1,
          edgeScale: 0,
          showLegend: false,
          legendLineThickness: 0,
          nodes,
          edges: []
        })
        const connectome = nv.meshes?.find((mesh) => Array.isArray(mesh.nodes))
        const connectomeNodes = connectome?.nodes || nodes
        nv._mniNodes = connectomeNodes
        connectomeNodes.forEach((node) => {
          if (node.label) {
            node.label.onClick = () => {
              setSelectedPoint({ x: node.x, y: node.y, z: node.z })
            }
          }
        })
      })
      .catch((error) => {
        if (error.name !== 'AbortError') console.error('Failed to load MNI points:', error)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [query, studyId, viewerReady])

  const handleOpacityChange = (event) => {
    const value = Number.parseFloat(event.target.value)
    setOpacity(value)
    if (nvRef.current?.volumes?.length) nvRef.current.setOpacity(0, value)
  }

  const handleZoom = (event, factor) => {
    event.preventDefault()
    event.stopPropagation()
    if (!nvRef.current || !viewerReady) return
    zoomRef.current = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current * factor))
    nvRef.current.setScale(zoomRef.current)
  }

  const handleResetZoom = (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!nvRef.current || !viewerReady) return
    zoomRef.current = 1
    nvRef.current.setScale(zoomRef.current)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', height: '320px', background: '#0d141f', padding: '12px', borderRadius: '12px', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '13px' }}>3D 腦影像</h3>
        {loading && <span style={{ fontSize: '11px', color: '#8da4b5' }}>載入座標中...</span>}
        {!loading && <span style={{ fontSize: '11px', color: '#8da4b5' }}>{studyId ? `Study ${studyId} · ${pointCount} 個 MNI 點位` : `共標記 ${pointCount} 個 MNI 點位`}</span>}
      </div>

      <div style={{ flex: '1', position: 'relative', width: '100%', height: '200px', borderRadius: '8px', overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        {viewerError && <div role="status" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: '16px', background: '#0d141f', color: '#ffb4a9', fontSize: '12px', textAlign: 'center' }}>{viewerError}</div>}

        <div
          style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px', zIndex: 30 }}
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={(event) => handleZoom(event, 1.25)} title="放大" aria-label="放大" disabled={!viewerReady} style={{ width: '28px', height: '28px', border: '1px solid #2e4357', borderRadius: '6px', background: 'rgba(13, 20, 31, 0.9)', color: '#fff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>+</button>
          <button type="button" onClick={(event) => handleZoom(event, 0.8)} title="縮小" aria-label="縮小" disabled={!viewerReady} style={{ width: '28px', height: '28px', border: '1px solid #2e4357', borderRadius: '6px', background: 'rgba(13, 20, 31, 0.9)', color: '#fff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'grid', placeItems: 'center' }}>-</button>
          <button type="button" onClick={handleResetZoom} title="重置" disabled={!viewerReady} style={{ padding: '0 8px', height: '28px', border: '1px solid #2e4357', borderRadius: '6px', background: 'rgba(13, 20, 31, 0.9)', color: '#fff', fontSize: '11px', cursor: 'pointer' }}>重置</button>
        </div>
      </div>

      <div aria-live="polite" style={{ minHeight: '16px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: '11px', color: '#9bb0c0' }}>
        {selectedPoint
          ? <span>選取座標：[{selectedPoint.x}, {selectedPoint.y}, {selectedPoint.z}]</span>
          : <span>點選腦部紅點查看 [x, y, z]</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px' }}>
        <span>大腦透明度</span>
        <input type="range" min="0.1" max="0.8" step="0.05" value={opacity} onChange={handleOpacityChange} style={{ flex: 1, accentColor: '#007bff' }} />
      </div>
    </div>
  )
}
