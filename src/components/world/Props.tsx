import { RigidBody } from '@react-three/rapier'
import { useMemo } from 'react'

export function Props() {
  const stairs = useMemo(
    () =>
      Array.from({ length: 6 }).map((_, i) => ({
        pos: [-4, 0.25 + i * 0.25, -2 - i * 0.6] as [number, number, number],
        size: [2, 0.5, 1] as [number, number, number],
      })),
    []
  )

  return (
    <>
      {/* Block */}
      <RigidBody type="fixed" colliders="cuboid" position={[0, 0.5, -4]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2, 1, 2]} />
          <meshStandardMaterial color="#7c9cce" />
        </mesh>
      </RigidBody>

      {/* Stairs */}
      {stairs.map((s, i) => (
        <RigidBody key={i} type="fixed" colliders="cuboid" position={s.pos}>
          <mesh castShadow receiveShadow>
            <boxGeometry args={s.size} />
            <meshStandardMaterial color="#8a7c6d" />
          </mesh>
        </RigidBody>
      ))}
    </>
  )
}
