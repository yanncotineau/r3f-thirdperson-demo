import React, { forwardRef, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CapsuleCollider, RapierRigidBody } from '@react-three/rapier'
import { useFBX } from '@react-three/drei'
import type { YawPitch } from '../Scene'

const HEIGHT = 1.8
const RADIUS = 0.35
const SPEED_WALK = 2.2
const SPEED_RUN  = 4.0

// Flip to Math.PI if your Mixamo mesh faces backward.
const MODEL_YAW_OFFSET = 0

type Props = { yawPitchRef: React.MutableRefObject<YawPitch> }

export const Character = forwardRef<RapierRigidBody, Props>(function Character(_props, ref) {
  const rbRef = useRef<RapierRigidBody | null>(null)

  // expose rigid body to parent
  useEffect(() => {
    if (!ref) return
    if (typeof ref === 'function') ref(rbRef.current!)
    else (ref as React.MutableRefObject<RapierRigidBody | null>).current = rbRef.current
  }, [ref])

  // Assets
  const idleFBX = useFBX('/Idle.fbx')
  const walkFBX = useFBX('/Walking.fbx')

  // Scale / shadow setup
  useEffect(() => {
    idleFBX.scale.setScalar(0.01)
    idleFBX.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
  }, [idleFBX])

  // Animation mixer & clips
  const mixer = useMemo(() => new THREE.AnimationMixer(idleFBX), [idleFBX])
  const idleClip = useMemo(() => {
    const c = THREE.AnimationClip
    return (
      c.findByName(idleFBX.animations, 'Idle') ??
      c.findByName(idleFBX.animations, 'idle') ??
      idleFBX.animations?.[0]
    )
  }, [idleFBX])
  const walkClip = useMemo(() => {
    const c = THREE.AnimationClip
    return (
      c.findByName(walkFBX.animations, 'Walking') ??
      c.findByName(walkFBX.animations, 'Walk') ??
      c.findByName(walkFBX.animations, 'walk') ??
      walkFBX.animations?.[0]
    )
  }, [walkFBX])

  const idleAction = useMemo(
    () => (idleClip ? mixer.clipAction(idleClip, idleFBX) : undefined),
    [mixer, idleClip, idleFBX]
  )
  const walkAction = useMemo(
    () => (walkClip ? mixer.clipAction(walkClip, idleFBX) : undefined),
    [mixer, walkClip, idleFBX]
  )

  const stateRef = useRef<'idle' | 'walk'>('idle')

  useEffect(() => {
    if (!idleAction || !walkAction) return

    idleAction
      .reset()
      .setLoop(THREE.LoopRepeat, Infinity)
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(1)
      .play()

    walkAction
      .reset()
      .setLoop(THREE.LoopRepeat, Infinity)
      .setEffectiveTimeScale(1)
      .setEffectiveWeight(0)
      .play()

    stateRef.current = 'idle'

    // IMPORTANT: cleanup must return void, not AnimationMixer
    return () => {
      mixer.stopAllAction()
    }
  }, [idleAction, walkAction, mixer])

  const keys = useRef({ f: false, b: false, l: false, r: false, run: false })
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.f = true
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.b = true
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.l = true
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.r = true
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.current.run = true
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.f = false
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.b = false
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.l = false
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.r = false
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') keys.current.run = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  // temp objects
  const desired = useMemo(() => new THREE.Vector3(), [])
  const forward = useMemo(() => new THREE.Vector3(), [])
  const right   = useMemo(() => new THREE.Vector3(), [])
  const up      = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const qCur    = useMemo(() => new THREE.Quaternion(), [])
  const qDst    = useMemo(() => new THREE.Quaternion(), [])
  const euler   = useMemo(() => new THREE.Euler(), [])

  const turnLerp = (dt: number) => 1 - Math.pow(0.001, dt)

  useFrame((state, dt) => {
    const rb = rbRef.current
    if (!rb || !idleAction || !walkAction) return

    const run = keys.current.run
    const speed = run ? SPEED_RUN : SPEED_WALK

    // Camera-relative basis
    state.camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
    forward.normalize()
    right.crossVectors(forward, up).normalize()

    let x = 0, z = 0
    if (keys.current.f) z += 1
    if (keys.current.b) z -= 1
    if (keys.current.l) x -= 1
    if (keys.current.r) x += 1
    const m = Math.hypot(x, z) || 1
    x /= m; z /= m

    desired.set(0, 0, 0)
      .addScaledVector(forward, z)
      .addScaledVector(right,   x)
      .multiplyScalar(speed)

    const cur = rb.linvel()
    rb.setLinvel({ x: desired.x, y: cur.y, z: desired.z }, true)

    // Kill residual spin from collisions
    const ang = rb.angvel()
    if (Math.abs(ang.x) > 1e-4 || Math.abs(ang.y) > 1e-4 || Math.abs(ang.z) > 1e-4) {
      rb.setAngvel({ x: 0, y: 0, z: 0 }, false)
    }

    // Face movement direction by rotating the rigidbody
    const horizSpeed = Math.hypot(desired.x, desired.z)
    if (horizSpeed > 0.05) {
      const targetYaw = Math.atan2(desired.x, desired.z) + MODEL_YAW_OFFSET
      const r = rb.rotation()
      qCur.set(r.x, r.y, r.z, r.w)
      euler.set(0, targetYaw, 0)
      qDst.setFromEuler(euler)
      qCur.slerp(qDst, turnLerp(dt))
      rb.setRotation({ x: qCur.x, y: qCur.y, z: qCur.z, w: qCur.w }, true)
    }

    mixer.update(dt)
    if (horizSpeed > 0.05) {
      if (stateRef.current !== 'walk') {
        walkAction.reset().setEffectiveWeight(1).play()
        idleAction.crossFadeTo(walkAction, 0.18, false)
        stateRef.current = 'walk'
      }
      walkAction.timeScale = run ? 1.35 : 1.0
    } else {
      if (stateRef.current !== 'idle') {
        idleAction.reset().setEffectiveWeight(1).play()
        walkAction.crossFadeTo(idleAction, 0.18, false)
        stateRef.current = 'idle'
      }
    }
  })

  return (
    <RigidBody
      ref={rbRef}
      colliders={false}
      mass={60}
      position={[0, HEIGHT * 0.5 + 0.05, 0]}
      enabledRotations={[false, true, false]}  // we control yaw
      friction={1}
      linearDamping={0.25}
      angularDamping={8}
    >
      <CapsuleCollider args={[HEIGHT * 0.5 - RADIUS, RADIUS]} />
      <primitive object={idleFBX} position={[0, -HEIGHT * 0.5, 0]} />
    </RigidBody>
  )
})
