import * as THREE from 'three'
import type {
  AnimNode, AnimStateId, ConditionCtx, StateDef, Transition
} from './machine'

export type ActionMap = Record<string, THREE.AnimationAction>

// How long we manually blend out of a one-shot into its exit state.
// This is the full window; the blend starts when remaining time <= this.
const ONE_SHOT_EXIT_BLEND = 0.28

// Ease with zero slope at ends (very smooth)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smootherstep01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

type ExitBlendState = {
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

  // Manual exit blend for non-looping clips
  private exitBlend: ExitBlendState = { active: false, to: 'idle', dur: 0, t: 0 }

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
    }
    this.applyNode(this.states.get(this.current)!.node, 1, zeroCtx)
  }

  get state() { return this.current }
  get elapsed() { return this.timeInState }

  update(dt: number, ctx: Omit<ConditionCtx, 'timeInState'>) {
    const fullCtx: ConditionCtx = { ...ctx, timeInState: this.timeInState }

    const curNode = this.states.get(this.current)!.node
    const isOneShot = curNode.kind === 'clip' && curNode.loop === false

    // 1) Transitions (skip while manual exit blend is active)
    if (!this.exitBlend.active) {
      for (const t of this.transitions) {
        if (t.from !== 'any' && t.from !== this.current) continue
        // Lock out generic 'any' while a one-shot is playing unless explicitly non-locking
        if (isOneShot && t.from === 'any' && (t.interruptible ?? true)) continue
        if (t.minTimeInState && this.timeInState < t.minTimeInState) continue
        if (!t.when(fullCtx)) continue
        this.crossFadeTo(t.to, t.fade ?? 0.12, fullCtx)
        break
      }
    }

    // 2) Drive active node (normal)
    const node = this.states.get(this.current)!.node
    this.applyNode(node, undefined, fullCtx)

    // 3) Mixer tick & local timer
    this.mixer.update(dt)
    this.timeInState += dt

    // 4) Manual exit blend for one-shots (RunStop → Idle)
    //    Start when remaining time <= ONE_SHOT_EXIT_BLEND. Then we drive weights/timeScale ourselves.
    const maybeNode = this.states.get(this.current)?.node
    if (maybeNode?.kind === 'clip' && maybeNode.loop === false) {
      const fromAction = this.actions[maybeNode.clip]
      const dur = fromAction?.getClip()?.duration ?? 0
      if (dur > 0) {
        const remaining = dur - this.timeInState

        // Start manual exit blend?
        if (!this.exitBlend.active && remaining <= ONE_SHOT_EXIT_BLEND) {
          const toId = maybeNode.exitTo ?? 'idle'
          this.exitBlend = { active: true, to: toId, dur: ONE_SHOT_EXIT_BLEND, t: 0 }

          // Prepare target action
          const toNode = this.states.get(toId)!.node
          const toAction = this.actions[toNode.clip]
          if (toAction) {
            toAction.enabled = true
            toAction.setLoop(THREE.LoopRepeat, Infinity)
            toAction.setEffectiveTimeScale(1)
            // Pre-roll idle a touch so it’s already moving under the stop pose
            // (keeps limbs moving continuously)
            if (toAction.time === 0) toAction.time = 0.05 * (toAction.getClip()?.duration ?? 0)
            toAction.play()
          }

          // Make sure the one-shot clamps at the end and remains valid while we blend
          if (fromAction) {
            fromAction.setLoop(THREE.LoopOnce, Infinity)
            fromAction.clampWhenFinished = true
          }
        }

        // Drive manual exit blend
        if (this.exitBlend.active) {
          const toId = this.exitBlend.to
          const toNode = this.states.get(toId)!.node
          const toAction = this.actions[toNode.clip]

          // Progress
          this.exitBlend.t = Math.min(this.exitBlend.t + dt, this.exitBlend.dur)
          const u = smootherstep01(0, this.exitBlend.dur, this.exitBlend.t)

          // Weight shaping: from 1→0, to 0→1 (super smooth)
          const wFrom = 1 - u
          const wTo = u

          if (fromAction) {
            // Slow the one-shot slightly toward the end (keeps limbs from over-swinging)
            const slow = 1 - 0.6 * u // from 1.0 → 0.4
            fromAction.setEffectiveTimeScale(slow)
            fromAction.setEffectiveWeight(wFrom)
            fromAction.enabled = true
            fromAction.play()
          }
          if (toAction) {
            toAction.setEffectiveWeight(wTo)
            toAction.setEffectiveTimeScale(1)
            toAction.enabled = true
            toAction.play()
          }

          // Finish: switch FSM state precisely at the end of the manual blend
          if (this.exitBlend.t >= this.exitBlend.dur) {
            // Commit to target state and reset timer
            this.current = toId
            this.timeInState = 0
            this.exitBlend = { active: false, to: 'idle', dur: 0, t: 0 }

            // Ensure target is fully weighted; stop the one-shot
            if (toAction) {
              toAction.setEffectiveWeight(1)
              toAction.setLoop(THREE.LoopRepeat, Infinity)
              toAction.setEffectiveTimeScale(1)
              toAction.play()
            }
            if (fromAction) {
              fromAction.setEffectiveWeight(0)
              fromAction.stop()
            }
          }

          // While exit blend is active, we’re done for this frame
          return
        }
      }
    }
  }

  private crossFadeTo(next: AnimStateId, fade: number, ctx: ConditionCtx) {
    if (next === this.current) return

    const fromNode = this.states.get(this.current)!.node
    const toNode   = this.states.get(next)!.node

    // Clear any manual exit blend when switching
    this.exitBlend = { active: false, to: 'idle', dur: 0, t: 0 }

    // Prepare entry
    this.timeInState = 0
    const entryCtx: ConditionCtx = { ...ctx, timeInState: 0 }

    // Clip → Clip crossfade (regular)
    const from = this.actions[(fromNode as AnimNode).clip]
    const to   = this.actions[(toNode   as AnimNode).clip]
    if (from && to) {
      // Looping/clamp per node
      const looping = toNode.kind === 'clip' ? (toNode.loop ?? true) : true
      to.setLoop(looping ? THREE.LoopRepeat : THREE.LoopOnce, Infinity)
      to.clampWhenFinished = !looping

      // Playback rate
      if (toNode.kind === 'clip' && toNode.timeScale) {
        to.setEffectiveTimeScale(toNode.timeScale(entryCtx))
      } else {
        to.setEffectiveTimeScale(1)
      }

      // Keep source valid while fading (prevents gaps)
      if (fromNode.kind === 'clip' && fromNode.loop === false) {
        from.setLoop(THREE.LoopOnce, Infinity)
        from.clampWhenFinished = true
      }

      to.reset().play()
      to.crossFadeFrom(from, Math.max(0.01, fade), false)
    } else {
      // Fallback path
      this.fadeNode(fromNode, 0, fade)
      this.applyNode(toNode, 1, entryCtx, fade)
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
