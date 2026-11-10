import React, { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, useGLTF } from '@react-three/drei';

// 半透明的腦殼模型
function BrainMesh() {
  // 請確保 public/brain.glb 存在
  const { scene } = useGLTF('/brain.glb'); 
  return (
    <primitive object={scene} opacity={0.3} transparent={true} />
  );
}

// 標記點元件
function MNIPoints({ query }) {
  const [points, setPoints] = useState([]);

  useEffect(() => {
    if (!query) return;
    // 呼叫後端 API 取得所有符合該 query 的文獻 MNI 座標
    fetch(`/query/${encodeURIComponent(query)}/locations`)
      .then(res => res.json())
      .then(data => {
        if (data.results) {
          setPoints(data.results);
        }
      })
      .catch(err => console.error("Failed to fetch locations:", err));
  }, [query]);

  return (
    <group>
      {points.map((pt, i) => (
        <mesh key={`${pt.study_id}-${i}`} position={[pt.x, pt.y, pt.z]}>
          <sphereGeometry args={[1.5, 16, 16]} />
          <meshStandardMaterial color="#d78c51" emissive="#d78c51" emissiveIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

export function Brain3DViewer({ query }) {
  return (
    <div style={{ width: '100%', height: '100%', minHeight: '400px', background: '#f3f5f7', borderRadius: '9px' }}>
      <Canvas camera={{ position: [0, 0, 150], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} intensity={1} />
        
        <BrainMesh />
        <MNIPoints query={query} />
        
        {/* OrbitControls 提供滑鼠旋轉與縮放功能 */}
        <OrbitControls enablePan={true} enableZoom={true} enableRotate={true} />
      </Canvas>
    </div>
  );
}