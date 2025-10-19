import * as THREE from 'three'
import type {
  AnimNode, AnimStateId, ConditionCtx, StateDef, Transition
} from './machine'

export type ActionMap = Record<string, THREE.AnimationAction>

// How long we blend AFTER a one-shot fully finishes (super smooth).
const ONE_SHOT_POST_BLEND = 0.28

// Empirical phase alignment to better match end-pose of one-shots.
const ALIGN_PHASE: Partial<Record<AnimStateId, number>> = {
  run:  0.18,
  idle: 0.06,
}

// Easing helpers (very smooth)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smootherstep01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

type PostBlendState = {
  active: boolean
  to: AnimStateId
  dur: number
  t: number
}

export class AnimationController {
  private current: AnimStateId
  private timeInState = 0
  private states: Map<AnimStateId, StateDef>
  private transitions: Transition[]
  private actions: ActionMap
  private mixer: THREE.AnimationMixer

  // Manual post-finish blend (one-shot -> looping)
  private postBlend: PostBlendState = { active: false, to: 'idle', dur: 0, t: 0 }

  constructor(params: {
    mixer: THREE.AnimationMixer
    actions: ActionMap
    states: StateDef[]
    transitions: Transition[]
    initial: AnimStateId
  }) {
    this.mixer = params.mixer
    this.actions = params.actions
    this.states = new Map(params.states.map(s => [s.id, s]))
    this.transitions = params.transitions
    this.current = params.initial

    // Prime all actions muted
    Object.values(this.actions).forEach(a => {
      a.enabled = true
      a.setEffectiveWeight(0)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.play()
    })

    // Enter initial state
    const zeroCtx: ConditionCtx = {
      speed: 0,
      input: { x: 0, z: 0, run: false },
      headingRad: 0,
      prevHeadingRad: 0,
      timeInState: 0,
      runReleasedAgo: Number.POSITIVE_INFINITY,
      runPressedAgo: Number.POSITIVE_INFINITY,   // ⟵ add
      moveStartedAgo: Number.POSITIVE_INFINITY,  // ⟵ add
    }
    this.applyNode(this.states.get(this.current)!.node, 1, zeroCtx)
  }

  get state() { return this.current }
  get elapsed() { return this.timeInState }

  update(dt: number, ctx: Omit<ConditionCtx, 'timeInState'>) {
    const fullCtx: ConditionCtx = { ...ctx, timeInState: this.timeInState }

    // If we’re in a post-finish blend, drive it exclusively (prevents new transitions mid-blend).
    if (this.postBlend.active) {
      this.drivePostBlend(dt)
      return
    }

    const curNode = this.states.get(this.current)!.node
    const isOneShot = curNode.kind === 'clip' && curNode.loop === false

    // 1) Transitions (skip generic 'any' while a one-shot plays to avoid interrupts)
    for (const t of this.transitions) {
      if (t.from !== 'any' && t.from !== this.current) continue
      if (isOneShot && t.from === 'any' && (t.interruptible ?? true)) continue
      if (t.minTimeInState && this.timeInState < t.minTimeInState) continue
      if (!t.when(fullCtx)) continue
      this.crossFadeTo(t.to, t.fade ?? 0.12, fullCtx)
      break
    }

    // 2) Drive active node
    this.applyNode(this.states.get(this.current)!.node, undefined, fullCtx)

    // 3) Tick mixer and timer
    this.mixer.update(dt)
    this.timeInState += dt

    // 4) Guarantee: if current is a one-shot, PLAY IT FULLY.
    //    When finished, begin a manual post-finish blend to exitTo.
    if (isOneShot) {
      const a = this.actions[curNode.clip]
      const dur = a?.getClip()?.duration ?? 0
      if (dur > 0 && this.timeInState >= dur) {
        // Clamp the one-shot at its last frame so pose is stable under our blend
        if (a) {
          a.setLoop(THREE.LoopOnce, Infinity)
          a.clampWhenFinished = true
          a.setEffectiveTimeScale(1)
          a.setEffectiveWeight(1)
          a.play()
        }

        // Prepare target (exitTo) for a manual post-finish blend
        const toId = (curNode.exitTo ?? 'idle') as AnimStateId
        const toNode = this.states.get(toId)!.node
        const to = this.actions[toNode.clip]
        if (to) {
          // Looping config
          const looping = toNode.kind === 'clip' ? (toNode.loop ?? true) : true
          to.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
          to.clampWhenFinished = !looping

          // Start target at a pose that matches nicely (align phase),
          // BUT do not freeze it anymore — give it a small timeScale so there’s zero “pause”.
          const phase = ALIGN_PHASE[toId] ?? 0
          const toDur = to.getClip()?.duration ?? 0
          if (toDur > 0) to.time = phase * toDur
          to.setEffectiveTimeScale(0.25) // <- small motion from the very start
          to.setEffectiveWeight(0)       // will ramp up smoothly
          to.enabled = true
          to.play()
        }

        // Arm the post-finish blend
        this.postBlend = { active: true, to: toId, dur: ONE_SHOT_POST_BLEND, t: 0 }
        return
      }
    }
  }

  // Smoothly blend OUT of the finished one-shot into the target loop,
  // keeping BOTH clips animating (small → full) to avoid any frozen moment.
  private drivePostBlend(dt: number) {
    const fromNode = this.states.get(this.current)!.node
    const from = this.actions[(fromNode as AnimNode).clip]
    const toNode = this.states.get(this.postBlend.to)!.node
    const to = this.actions[toNode.clip]

    // Progress the post-blend clock
    this.postBlend.t = Math.min(this.postBlend.t + dt, this.postBlend.dur)
    const u = smootherstep01(0, this.postBlend.dur, this.postBlend.t) // 0→1, smooth ends

    // Weights: from 1→0, to 0→1
    const wFrom = 1 - u
    const wTo = u

    // TimeScale shaping:
    //  - One-shot eases down from 1.0 → 0.6 (keeps momentum but avoids overswing)
    //  - Target loop eases up from 0.25 → 1.0 (never fully frozen)
    const fromRate = 1.0 - 0.4 * u
    const toRate   = 0.25 + 0.75 * u

    if (from) {
      from.setEffectiveWeight(wFrom)
      from.setLoop(THREE.LoopOnce, Infinity)
      from.clampWhenFinished = true
      from.setEffectiveTimeScale(fromRate)
      from.enabled = true
      from.play()
    }
    if (to) {
      to.setEffectiveWeight(wTo)
      to.setEffectiveTimeScale(toRate)
      to.enabled = true
      to.play()
    }

    // Tick mixer and timer (we keep the FSM in the one-shot state until complete)
    this.mixer.update(dt)
    this.timeInState += dt

    if (this.postBlend.t >= this.postBlend.dur) {
      // Finalize: switch to the loop, full weight, full speed
      if (to) {
        to.setEffectiveWeight(1)
        to.setEffectiveTimeScale(1)
        to.setLoop(THREE.LoopRepeat, Infinity)
        to.play()
      }
      if (from) {
        from.setEffectiveWeight(0)
        from.stop()
      }

      this.current = this.postBlend.to
      this.timeInState = 0
      this.postBlend = { active: false, to: 'idle', dur: 0, t: 0 }
    }
  }

  private crossFadeTo(next: AnimStateId, fade: number, ctx: ConditionCtx) {
    if (next === this.current) return

    // Cancel any post-blend in progress (explicit state change overrides it)
    this.postBlend = { active: false, to: 'idle', dur: 0, t: 0 }

    const fromNode = this.states.get(this.current)!.node
    const toNode   = this.states.get(next)!.node

    // Prepare entry
    this.timeInState = 0
    const entryCtx: ConditionCtx = { ...ctx, timeInState: 0 }

    // Clip → Clip crossfade
    const from = this.actions[(fromNode as AnimNode).clip]
    const to   = this.actions[(toNode   as AnimNode).clip]
    if (from && to) {
      const looping = toNode.kind === 'clip' ? (toNode.loop ?? true) : true
      to.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
      to.clampWhenFinished = !looping

      if (fromNode.kind === 'clip' && fromNode.loop === false) {
        from.setLoop(THREE.LoopOnce, Infinity)
        from.clampWhenFinished = true
      }

      if (toNode.kind === 'clip' && toNode.timeScale) {
        to.setEffectiveTimeScale(toNode.timeScale(entryCtx))
      } else {
        to.setEffectiveTimeScale(1)
      }

      to.reset().play()
      to.crossFadeFrom(from, Math.max(0.01, fade), false)
    } else {
      this.fadeNode(toNode, 1, fade)
    }

    this.current = next
  }

  private applyNode(node: AnimNode, weight = 1, ctx?: ConditionCtx, fade = 0.0) {
    const a = this.actions[node.clip]
    if (!a) return

    const looping = node.loop ?? true
    a.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
    a.clampWhenFinished = !looping

    if (ctx && node.timeScale) a.setEffectiveTimeScale(node.timeScale(ctx))
    else a.setEffectiveTimeScale(1)

    if (fade > 0) a.fadeIn(fade)
    else a.setEffectiveWeight(weight)

    a.enabled = true
    a.play()
  }

  private fadeNode(node: AnimNode, targetWeight: number, fade: number) {
    const a = this.actions[node.clip]
    if (!a) return
    if (targetWeight === 0) a.fadeOut(Math.max(0.01, fade))
    else a.fadeIn(Math.max(0.01, fade))
  }
}
