import { Canvas } from '@react-three/fiber'
import { Scene } from './components/Scene'

export default function App() {
  return (
    <Canvas
      shadows
      camera={{ fov: 50, near: 0.1, far: 500, position: [0, 2, 6] }}
    >
      <Scene />
    </Canvas>
  )
}
