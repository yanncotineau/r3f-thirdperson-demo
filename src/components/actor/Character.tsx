import React, { forwardRef, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CapsuleCollider, RapierRigidBody } from '@react-three/rapier'
import { useFBX } from '@react-three/drei'
import type { YawPitch } from '../Scene'
import { AnimationController, type ActionMap } from './animation/controller'
import { STATES, makeTransitions, ACTION, DEFAULT_TURN_LEFT_DURATION } from './animation/config'

const HEIGHT = 1.8
const RADIUS = 0.35
const SPEED_WALK = 2.2
const SPEED_RUN  = 4.0
const MODEL_YAW_OFFSET = 0

type Props = { yawPitchRef: React.MutableRefObject<YawPitch> }

export const Character = forwardRef<RapierRigidBody, Props>(function Character(_props, ref) {
  const rbRef = useRef<RapierRigidBody | null>(null)
  useEffect(() => {
    if (!ref) return
    if (typeof ref === 'function') ref(rbRef.current!)
    else (ref as React.MutableRefObject<RapierRigidBody | null>).current = rbRef.current
  }, [ref])

  // Assets
  const idleFBX = useFBX('/Idle.fbx')
  const walkFBX = useFBX('/Walking.fbx')
  const walkLeftTurnFBX = useFBX('/Walking Left Turn.fbx')

  // Prep
  useEffect(() => {
    idleFBX.scale.setScalar(0.01)
    idleFBX.traverse(o => { o.castShadow = o.receiveShadow = true })
  }, [idleFBX])

  // Mixer
  const mixer = useMemo(() => new THREE.AnimationMixer(idleFBX), [idleFBX])

  // Helper
  function findClip(src: THREE.Object3D, names: string[]) {
    const list = src.animations || []
    for (const n of names) {
      const c = THREE.AnimationClip.findByName(list, n)
      if (c) return c
    }
    return list[0]
  }

  // Actions
  const actions: ActionMap = useMemo(() => {
    const map: ActionMap = {}
    const idle = findClip(idleFBX, ['Idle', 'idle'])
    const walk = findClip(walkFBX, ['Walking', 'Walk', 'walk'])
    const walkLT = findClip(walkLeftTurnFBX, [
      'Walking Left Turn','Walk_Left_Turn','Walk Left Turn','Turn_Left_Walk'
    ])
    if (idle) map[ACTION.Idle] = mixer.clipAction(idle, idleFBX)
    if (walk) map[ACTION.Walk] = mixer.clipAction(walk, idleFBX)
    if (walkLT) map[ACTION.WalkLeftTurn] = mixer.clipAction(walkLT, idleFBX)

    Object.values(map).forEach(a => {
      a.enabled = true
      a.setEffectiveWeight(0)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.play()
    })
    return map
  }, [idleFBX, walkFBX, walkLeftTurnFBX, mixer])

  // Controller (transitions based on the constant)
  const anim = useMemo(() =>
    new AnimationController({
      mixer,
      actions,
      states: STATES,
      transitions: makeTransitions(),
      initial: 'idle',
    }), [mixer, actions]
  )

  // Input
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
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // scratch
  const desired = useMemo(() => new THREE.Vector3(), [])
  const forward = useMemo(() => new THREE.Vector3(), [])
  const right   = useMemo(() => new THREE.Vector3(), [])
  const up      = useMemo(() => new THREE.Vector3(0, 1, 0), [])
  const qCur    = useMemo(() => new THREE.Quaternion(), [])
  const qDst    = useMemo(() => new THREE.Quaternion(), [])
  const euler   = useMemo(() => new THREE.Euler(), [])
  const turnLerp = (dt: number) => 1 - Math.pow(0.001, dt)

  const prevHeadingRef = useRef(0)
  const turnStartAngleRef = useRef(0)   // start at 0 (forward)
  const turnTargetAngleRef = useRef(-Math.PI / 4) // fixed -45° target
  const prevStateRef = useRef<'idle'|'walk'|'walkLeftTurn'>('idle')

  useFrame((state, dt) => {
    const rb = rbRef.current
    if (!rb) return

    const run = keys.current.run
    const speedCap = run ? SPEED_RUN : SPEED_WALK

    // camera-space basis
    state.camera.getWorldDirection(forward)
    forward.y = 0
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
    forward.normalize()
    right.crossVectors(forward, up).normalize()

    // camera-space input
    let x = 0, z = 0
    if (keys.current.f) z += 1
    if (keys.current.b) z -= 1
    if (keys.current.l) x -= 1
    if (keys.current.r) x += 1
    const mag = Math.hypot(x, z) || 1
    x /= mag; z /= mag

    const headingRad = Math.atan2(x, z)

    // On entering the turn, lock the target to exactly -45°
    const curState = anim.state
    if (prevStateRef.current !== curState && curState === 'walkLeftTurn') {
      turnStartAngleRef.current = 0
      turnTargetAngleRef.current = -Math.PI / 4
    }
    prevStateRef.current = curState

    // Steering/facing blend strictly over the constant duration
    const D = DEFAULT_TURN_LEFT_DURATION

    let dirX = x
    let dirZ = z
    if (curState === 'walkLeftTurn') {
      const t = Math.min(1, anim.elapsed / Math.max(0.001, D))
      const a = (1 - t) * turnStartAngleRef.current + t * turnTargetAngleRef.current
      dirX = Math.sin(a)
      dirZ = Math.cos(a)
    }

    // velocity
    desired.set(0, 0, 0)
      .addScaledVector(forward, dirZ)
      .addScaledVector(right,   dirX)
      .multiplyScalar(speedCap)

    const cur = rb.linvel()
    rb.setLinvel({ x: desired.x, y: cur.y, z: desired.z }, true)

    // kill residual spin
    const ang = rb.angvel()
    if (Math.abs(ang.x) > 1e-4 || Math.abs(ang.y) > 1e-4 || Math.abs(ang.z) > 1e-4) {
      rb.setAngvel({ x: 0, y: 0, z: 0 }, false)
    }

    // face the blended direction
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

    // controller (no duration passed; graph/node use the constant)
    anim.update(dt, {
      speed: horizSpeed,
      input: { x, z, run },
      headingRad,
      prevHeadingRad: prevHeadingRef.current,
    })
    prevHeadingRef.current = headingRad
  })

  useEffect(() => () => { mixer.stopAllAction() }, [mixer])

  return (
    <RigidBody
      ref={rbRef}
      colliders={false}
      mass={60}
      position={[0, HEIGHT * 0.5 + 0.05, 0]}
      enabledRotations={[false, true, false]}
      friction={1}
      linearDamping={0.25}
      angularDamping={8}
    >
      <CapsuleCollider args={[HEIGHT * 0.5 - RADIUS, RADIUS]} />
      <primitive object={idleFBX} position={[0, -HEIGHT * 0.5, 0]} />
    </RigidBody>
  )
})
