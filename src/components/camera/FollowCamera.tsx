import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import type { YawPitch } from '../Scene'

type Props = {
  // Accept nullable ref (RefObject<T | null>)
  target: React.RefObject<RapierRigidBody | null>
  yawPitchRef: React.MutableRefObject<YawPitch>
}

/**
 * Pointer-lock third-person camera with constant boom distance.
 * Smooths only the target point; keeps radius fixed.
 */
export function FollowCamera({ target, yawPitchRef }: Props) {
  const { camera, gl } = useThree()

  const distance = 4.8
  const heightLook = 0.9

  const targetSmoothed = useRef(new THREE.Vector3())
  const targetInstant = useRef(new THREE.Vector3())
  const rot = useRef(new THREE.Euler(0, 0, 0, 'YXZ'))
  const offset = useRef(new THREE.Vector3())

  useEffect(() => {
    const el = gl.domElement

    const onClick = () => {
      if (document.pointerLockElement !== el) el.requestPointerLock()
    }
    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === el
      el.style.cursor = locked ? 'none' : 'default'
    }
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el) return
      yawPitchRef.current.yaw   -= e.movementX * 0.002
      yawPitchRef.current.pitch += e.movementY * 0.002
      const PITCH_MIN = -Math.PI / 2 + 0.1
      const PITCH_MAX =  Math.PI / 2 - 0.1
      yawPitchRef.current.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, yawPitchRef.current.pitch))
    }

    el.addEventListener('click', onClick)
    document.addEventListener('pointerlockchange', onPointerLockChange)
    document.addEventListener('mousemove', onMouseMove)
    return () => {
      el.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', onMouseMove)
    }
  }, [gl, yawPitchRef])

  useFrame((_state, dt) => {
    const rb = target.current
    if (!rb) return

    // Update target (instant)
    const t = rb.translation()
    targetInstant.current.set(t.x, t.y + heightLook, t.z)

    // Smooth target only (critically damped)
    const k = 0.001
    const alpha = 1 - Math.pow(k, dt)
    targetSmoothed.current.lerp(targetInstant.current, alpha)

    // Rotated boom offset (constant length)
    rot.current.set(yawPitchRef.current.pitch, yawPitchRef.current.yaw, 0)
    offset.current.set(0, 0, -distance).applyEuler(rot.current)

    // Camera position: smoothed target + boom
    camera.position.copy(targetSmoothed.current).add(offset.current)
    camera.lookAt(targetSmoothed.current)
  })

  return null
}
