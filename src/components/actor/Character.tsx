import React, { forwardRef, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { RigidBody, CapsuleCollider, RapierRigidBody } from '@react-three/rapier'
import { useFBX } from '@react-three/drei'
import type { YawPitch } from '../Scene'
import { AnimationController, type ActionMap } from './animation/controller'
import { STATES, makeTransitions, ACTION } from './animation/config'
import { makeInPlace } from './animation/utils'

const HEIGHT = 1.8
const RADIUS = 0.35
const SPEED_WALK = 2.2
const SPEED_RUN  = 5.0
const MODEL_YAW_OFFSET = 0

type Props = { yawPitchRef: React.MutableRefObject<YawPitch> }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smootherstep01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export const Character = forwardRef<RapierRigidBody, Props>(function Character(_props, ref) {
  const rbRef = useRef<RapierRigidBody | null>(null)
  useEffect(() => {
    if (!ref) return
    if (typeof ref === 'function') ref(rbRef.current!)
    else (ref as React.MutableRefObject<RapierRigidBody | null>).current = rbRef.current
  }, [ref])

  // Single model (with skin)
  const model = useFBX('/Character.fbx')
  useEffect(() => {
    model.scale.setScalar(0.01)
    model.traverse((o) => {
      o.castShadow = true
      o.receiveShadow = true
    })
  }, [model])

  const mixer = useMemo(() => new THREE.AnimationMixer(model), [model])

  // Animation-only FBXs (WITHOUT SKIN)
  const idleFBX         = useFBX('/anims/Idle.fbx')
  const walkFBX         = useFBX('/anims/Walking.fbx')
  const runFBX          = useFBX('/anims/Running.fbx')
  const runStopFBX      = useFBX('/anims/RunToStop.fbx')
  const idleToSprintFBX = useFBX('/anims/IdleToSprint.fbx')

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

    const idleClip         = findClip(idleFBX,         ['Idle', 'idle'])
    let   walkClip         = findClip(walkFBX,         ['Walking', 'Walk', 'walk'])
    let   runClip          = findClip(runFBX,          ['Running', 'Run', 'run'])
    let   runStopClip      = findClip(runStopFBX,      ['Run To Stop', 'RunToStop', 'Run_Stop', 'Run Stop'])
    let   idleToSprintClip = findClip(idleToSprintFBX, ['Idle To Sprint', 'IdleToSprint', 'Idle_To_Sprint'])

    // In-place conversions for any locomotion/transition that carries root translation
    if (walkClip)         walkClip         = makeInPlace(walkClip)
    if (runClip)          runClip          = makeInPlace(runClip)
    if (runStopClip)      runStopClip      = makeInPlace(runStopClip)
    if (idleToSprintClip) idleToSprintClip = makeInPlace(idleToSprintClip)

    if (idleClip)         map[ACTION.Idle]         = mixer.clipAction(idleClip,         model)
    if (walkClip)         map[ACTION.Walk]         = mixer.clipAction(walkClip,         model)
    if (runClip)          map[ACTION.Run]          = mixer.clipAction(runClip,          model)
    if (runStopClip)      map[ACTION.RunStop]      = mixer.clipAction(runStopClip,      model)
    if (idleToSprintClip) map[ACTION.IdleToSprint] = mixer.clipAction(idleToSprintClip, model)

    Object.values(map).forEach((a) => {
      a.enabled = true
      a.setEffectiveWeight(0)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.play()
    })
    return map
  }, [mixer, model, idleFBX, walkFBX, runFBX, runStopFBX, idleToSprintFBX])

  // Cache the IdleToSprint duration (used for acceleration curve)
  const idleToSprintDur = useMemo(() => {
    const a = actions[ACTION.IdleToSprint]
    return a?.getClip()?.duration ?? 0.9
  }, [actions])

  // Controller
  const anim = useMemo(
    () =>
      new AnimationController({
        mixer,
        actions,
        states: STATES,
        transitions: makeTransitions(),
        initial: 'idle',
      }),
    [mixer, actions]
  )

  // ──────────────────────────────────────────────────────────────
  // Input + timing (grace trackers)
  // ──────────────────────────────────────────────────────────────
  const keys = useRef({ f: false, b: false, l: false, r: false, run: false })

  const nowSec = () => performance.now() * 0.001

  // Shift press/release times
  const runPressedAtSec  = useRef<number | null>(null)
  const runReleasedAtSec = useRef<number | null>(null)

  // Movement start time (when input magnitude crosses from <START_INPUT to ≥START_INPUT)
  const moveStartedAtSec = useRef<number | null>(null)
  const lastInputMagRef  = useRef(0)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.f = true
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.b = true
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.l = true
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.r = true
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (!keys.current.run) { // rising edge
          runPressedAtSec.current = nowSec()
        }
        keys.current.run = true
        runReleasedAtSec.current = null
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') keys.current.f = false
      if (e.code === 'KeyS' || e.code === 'ArrowDown') keys.current.b = false
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') keys.current.l = false
      if (e.code === 'KeyD' || e.code === 'ArrowRight') keys.current.r = false
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (keys.current.run) { // falling edge
          runReleasedAtSec.current = nowSec()
        }
        keys.current.run = false
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
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

  useFrame((state, dt) => {
    const rb = rbRef.current
    if (!rb) return

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
    const inputMagNow = Math.hypot(x, z)
    x /= mag; z /= mag

    // Detect movement start (rising edge across START_INPUT)
    const START_INPUT = 0.12
    if (lastInputMagRef.current < START_INPUT && inputMagNow >= START_INPUT) {
      moveStartedAtSec.current = nowSec()
    }
    lastInputMagRef.current = inputMagNow

    const headingRad = Math.atan2(x, z)

    // Measure current velocity before applying new one (for animation logic)
    const vNow = rb.linvel()
    const horizSpeedNow = Math.hypot(vNow.x, vNow.z)

    // Base speed cap (walk or run)
    const runHeld = keys.current.run
    let speedCap = runHeld ? SPEED_RUN : SPEED_WALK

    // Gradual acceleration during IdleToSprint:
    if (anim.state === 'idleToSprint') {
      const dur = Math.max(0.0001, idleToSprintDur)
      const t   = Math.min(anim.elapsed, dur)
      const ramp = smootherstep01(0, dur, t) // smooth 0→1
      speedCap = SPEED_RUN * ramp
    }

    // Desired velocity (camera-relative)
    desired
      .set(0, 0, 0)
      .addScaledVector(forward, z)
      .addScaledVector(right,   x)
      .multiplyScalar(speedCap)

    rb.setLinvel({ x: desired.x, y: vNow.y, z: desired.z }, true)

    // kill residual spin
    const ang = rb.angvel()
    if (Math.abs(ang.x) > 1e-4 || Math.abs(ang.y) > 1e-4 || Math.abs(ang.z) > 1e-4) {
      rb.setAngvel({ x: 0, y: 0, z: 0 }, false)
    }

    // face the movement direction
    if (Math.hypot(desired.x, desired.z) > 0.05) {
      const targetYaw = Math.atan2(desired.x, desired.z) + MODEL_YAW_OFFSET
      const r = rb.rotation()
      qCur.set(r.x, r.y, r.z, r.w)
      euler.set(0, targetYaw, 0)
      qDst.setFromEuler(euler)
      qCur.slerp(qDst, turnLerp(dt))
      rb.setRotation({ x: qCur.x, y: qCur.y, z: qCur.z, w: qCur.w }, true)
    }

    // Ages (seconds) for grace logic
    const now = nowSec()
    const runReleasedAgo =
      (!runHeld && runReleasedAtSec.current != null) ? Math.max(0, now - runReleasedAtSec.current) : Number.POSITIVE_INFINITY
    const runPressedAgo =
      (runHeld && runPressedAtSec.current != null) ? Math.max(0, now - runPressedAtSec.current) : Number.POSITIVE_INFINITY
    const moveStartedAgo =
      (moveStartedAtSec.current != null) ? Math.max(0, now - moveStartedAtSec.current) : Number.POSITIVE_INFINITY

    // animation controller
    anim.update(dt, {
      speed: horizSpeedNow,
      input: { x, z, run: runHeld },
      headingRad,
      prevHeadingRad: prevHeadingRef.current,
      runReleasedAgo,
      runPressedAgo,
      moveStartedAgo,
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
      <primitive object={model} position={[0, -HEIGHT * 0.5, 0]} />
    </RigidBody>
  )
})
