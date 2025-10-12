import { CuboidCollider, RigidBody } from '@react-three/rapier'
import type { RigidBodyProps } from '@react-three/rapier'

export function Ground(props: RigidBodyProps) {
  return (
    <RigidBody type="fixed" colliders={false} {...props}>
      <mesh receiveShadow rotation-x={-Math.PI / 2}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#2a2a2a" roughness={1} metalness={0} />
      </mesh>
      <CuboidCollider args={[40, 0.05, 40]} position={[0, -0.05, 0]} />
    </RigidBody>
  )
}
