import React, { useEffect, useRef, useState } from 'react'
import { Niivue } from '@niivue/niivue'

export function Brain3DViewer ({ query }) {
  const canvasRef = useRef(null)
  const nvRef = useRef(null)
  const [opacity, setOpacity] = useState(0.75)
  const [loading, setLoading] = useState(false)
  const [pointCount, setPointCount] = useState(0)

  useEffect(() => {
    const nv = new Niivue({
      show3Dcrosshair: false,
      backColor: [0.05, 0.08, 0.12, 1],
      isOrientCube: true,
      isHighResolution: true
    })
    nvRef.current = nv
    nv.attachToCanvas(canvasRef.current)
    nv.setSliceType(nv.sliceTypeRender)

    nv.loadVolumes([{ url: '/static/mni_2mm.nii.gz', opacity: 0.75 }]).then(() => {
      nv.setVolumeRenderIllumination(0.7)
    })
  }, [])

  useEffect(() => {
    if (!query || !nvRef.current) return
    setLoading(true)

    fetch(`/query/${encodeURIComponent(query)}/locations`)
      .then((res) => res.json())
      .then((data) => {
        if (data.results && nvRef.current) {
          setPointCount(data.results.length)
          const nodes = data.results.map((pt, idx) => ({
            id: idx,
            x: pt.x,
            y: pt.y,
            z: pt.z,
            colorValue: 1,
            size: 3.5
          }))
          nvRef.current.loadNodes({
            nodeColormap: 'warm',
            nodeMinColor: 0,
            nodeMaxColor: 1,
            nodes: nodes
          })
        }
      })
      .catch((err) => console.error('Failed to load MNI points:', err))
      .finally(() => setLoading(false))
  }, [query])

  const handleOpacityChange = (e) => {
    const val = parseFloat(e.target.value)
    setOpacity(val)
    if (nvRef.current && nvRef.current.volumes.length > 0) {
      nvRef.current.setOpacity(0, val)
    }
  }

  // 縮放控制：使用 stopPropagation 避免事件被 3D 畫布吞掉
  const handleZoom = (e, factor) => {
    e.preventDefault()
    e.stopPropagation()
    if (!nvRef.current) return
    const nv = nvRef.current
    if (nv.scene) {
      if (!nv.scene.volScale || nv.scene.volScale.length < 3) {
        nv.scene.volScale = [1, 1, 1]
      }
      nv.scene.volScale = [
        nv.scene.volScale[0] * factor,
        nv.scene.volScale[1] * factor,
        nv.scene.volScale[2] * factor
      ]
      nv.drawScene()
    }
  }

  const handleResetZoom = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!nvRef.current) return
    const nv = nvRef.current
    if (nv.scene) {
      nv.scene.volScale = [1, 1, 1]
      nv.drawScene()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', height: '320px', background: '#0d141f', padding: '12px', borderRadius: '12px', color: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '13px' }}>3D 腦影像</h3>
        {loading && <span style={{ fontSize: '11px', color: '#8da4b5' }}>載入座標中...</span>}
        {!loading && <span style={{ fontSize: '11px', color: '#8da4b5' }}>共標記 {pointCount} 個 MNI 點位</span>}
      </div>

      <div style={{ flex: '1', position: 'relative', width: '100%', height: '200px', borderRadius: '8px', overflow: 'hidden' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />

        {/* 右上角浮動按鈕區 */}
        <div
          style={{ position: 'absolute', top: '8px', right: '8px', display: 'flex', gap: '4px', zIndex: 30 }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={(e) => handleZoom(e, 1.25)}
            title="放大"
            style={{ width: '28px', height: '28px', border: '1px solid #2e4357', borderRadius: '6px', background: 'rgba(13, 20, 31, 0.9)', color: '#fff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            +
          </button>
          <button
            type="button"
            onClick={(e) => handleZoom(e, 0.8)}
            title="縮小"
            style={{ width: '28px', height: '28px', border: '1px solid #2e4357', borderRadius: '6px', background: 'rgba(13, 20, 31, 0.9)', color: '#fff', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            -
          </button>
          <button
            type="button"
            onClick={(e) => handleResetZoom(e)}
            title="重置"
            style={{ padding: '0 8px', height: '28px', border: '1px solid #2e4357', borderRadius: '6px', background: 'rgba(13, 20, 31, 0.9)', color: '#fff', fontSize: '11px', cursor: 'pointer' }}
          >
            重置
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px' }}>
        <span>大腦透明度</span>
        <input
          type="range"
          min="0.1"
          max="1.0"
          step="0.05"
          value={opacity}
          onChange={handleOpacityChange}
          style={{ flex: 1, accentColor: '#007bff' }}
        />
      </div>
    </div>
  )
}