import { Suspense, useRef } from 'react'
import { Environment, Grid, Stats } from '@react-three/drei'
import { Physics, RapierRigidBody } from '@react-three/rapier'
import { Ground } from './world/Ground'
import { Props } from './world/Props'
import { Character } from './actor/Character'
import { FollowCamera } from './camera/FollowCamera'

export type YawPitch = { yaw: number; pitch: number }

export function Scene() {
  // NOTE: React refs are nullable
  const characterRef = useRef<RapierRigidBody | null>(null)
  const yawPitchRef = useRef<YawPitch>({ yaw: 0, pitch: -0.1 })

  return (
    <>
      {/* FPS counter */}
      <Stats showPanel={0} className="fps-stats" />

      {/* Lighting */}
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[8, 12, 3]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      {/* Env + grid */}
      <Environment preset="forest" background />
      <Grid
        cellSize={1}
        sectionSize={4}
        sectionColor="#ffffff22"
        cellColor="#ffffff08"
        infiniteGrid
        fadeDistance={40}
        fadeStrength={2}
        position={[0, 0.01, 0]}
      />

      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]}>
          <Ground />
          <Props />
          <Character ref={characterRef} yawPitchRef={yawPitchRef} />
          <FollowCamera target={characterRef} yawPitchRef={yawPitchRef} />
        </Physics>
      </Suspense>
    </>
  )
}
