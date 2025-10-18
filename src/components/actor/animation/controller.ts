import * as THREE from 'three'
import type {
  AnimNode, AnimStateId, ConditionCtx, StateDef, Transition, TurnBlendNode
} from './machine'

export type ActionMap = Record<string, THREE.AnimationAction>

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smootherstep01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * t * (t * (t * 6 - 15) + 10)
}

export class AnimationController {
  private current: AnimStateId
  private timeInState = 0
  private states: Map<AnimStateId, StateDef>
  private transitions: Transition[]
  private actions: ActionMap
  private mixer: THREE.AnimationMixer

  // Shared gait clock (0..1) and rate (Hz). Drives walk & left-turn.
  private gaitClock = 0
  private gaitRateHz = 1 // steps per second (normalized cycles per second)

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

    Object.values(this.actions).forEach(a => {
      a.enabled = true
      a.setEffectiveWeight(0)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.play()
    })

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

    // Update gait rate from your configured timeScale curve (when moving).
    // Find walk node and evaluate its timeScale(ctx) if any.
    const walkNode = this.states.get('walk')?.node
    let walkTimeScale = 1
    if (walkNode?.kind === 'clip' && walkNode.timeScale) {
      walkTimeScale = walkNode.timeScale(fullCtx)
    }
    // Gait rate Hz: how many cycles per second. If the walk clip is 1 cycle long,
    // the mixer would run at 'timeScale' cycles per second. We emulate that.
    this.gaitRateHz = Math.max(0, walkTimeScale)

    // Advance gait clock only if we’re actually moving; otherwise keep it stable:
    if (fullCtx.speed > 0.05) {
      this.gaitClock = (this.gaitClock + this.gaitRateHz * dt) % 1
    }

    // Evaluate transitions (first match wins)
    for (const t of this.transitions) {
      if (t.from !== 'any' && t.from !== this.current) continue
      if (t.minTimeInState && this.timeInState < t.minTimeInState) continue
      if (!t.when(fullCtx)) continue
      this.crossFadeTo(t.to, t.fade ?? 0.12, fullCtx)
      break
    }

    // Drive the active node (and keep gait sync for walk-related actions)
    const node = this.states.get(this.current)!.node
    this.applyNode(node, undefined, fullCtx)

    // IMPORTANT: We still tick the mixer for non-gait clips (like Idle)
    // but Walk/Turn clips have effectiveTimeScale=0 and are driven by gaitClock
    this.mixer.update(dt)
    this.timeInState += dt
  }

  private crossFadeTo(next: AnimStateId, fade: number, ctx: ConditionCtx) {
    if (next === this.current) return
    const fromNode = this.states.get(this.current)!.node
    const toNode = this.states.get(next)!.node

    // entry context for new node
    this.timeInState = 0
    const entryCtx: ConditionCtx = { ...ctx, timeInState: 0 }

    if (fromNode.kind === 'clip' && toNode.kind === 'clip') {
      const from = this.actions[fromNode.clip]
      const to = this.actions[toNode.clip]
      if (from && to) {
        // Phase continuity via gait clock (set 'to' time by clock)
        const toDur = to.getClip()?.duration ?? 0
        if (toDur > 0) to.time = this.gaitClock * toDur
        // Freeze to action; we’ll drive by gait clock
        to.setEffectiveTimeScale(0)
        to.reset().play()
        to.crossFadeFrom(from, Math.max(0.01, fade), false)
      } else {
        this.fadeNode(fromNode, 0, fade)
        this.applyNode(toNode, 1, entryCtx, fade)
      }
    }
    else if (toNode.kind === 'turnBlend') {
      // entering turn: set turn clip to gait clock; freeze both to the clock
      const tb = toNode as TurnBlendNode
      const base = this.actions[tb.fromClip]
      const turnPose = this.actions[tb.toClip]

      if (base) {
        base.enabled = true
        base.setEffectiveWeight(1)
        base.setEffectiveTimeScale(0) // clock-driven
        const bd = base.getClip()?.duration ?? 0
        if (bd > 0) base.time = this.gaitClock * bd
      }
      if (turnPose) {
        turnPose.enabled = true
        turnPose.setEffectiveWeight(0)
        turnPose.setEffectiveTimeScale(0) // clock-driven
        const td = turnPose.getClip()?.duration ?? 0
        if (td > 0) turnPose.time = this.gaitClock * td
        turnPose.reset().play()
      }
      this.applyNode(toNode, 1, entryCtx, 0)
    }
    else if (fromNode.kind === 'turnBlend' && toNode.kind === 'clip') {
      // leaving turn: hand off keeping gait phase; fade out turn pose
      const tb = fromNode as TurnBlendNode
      const base = this.actions[tb.fromClip]
      const turnPose = this.actions[tb.toClip]
      const to = this.actions[toNode.clip]

      const toDur = to?.getClip()?.duration ?? 0
      if (to && toDur > 0) {
        to.enabled = true
        to.play()
        to.setEffectiveTimeScale(0) // clock-driven
        to.time = this.gaitClock * toDur
        to.fadeIn(Math.max(0.01, fade))
      }
      if (turnPose) turnPose.fadeOut(Math.max(0.01, fade))
      if (base && base !== to) {
        base.setEffectiveTimeScale(0)
        const bd = base.getClip()?.duration ?? 0
        if (bd > 0) base.time = this.gaitClock * bd
        base.fadeIn(Math.max(0.01, fade))
      }
    }
    else {
      this.fadeNode(fromNode, 0, fade)
      this.applyNode(toNode, 1, entryCtx, fade)
    }

    this.current = next
  }

  private applyNode(node: AnimNode, weight = 1, ctx?: ConditionCtx, fade = 0.0) {
    switch (node.kind) {
      case 'clip': {
        const a = this.actions[node.clip]
        if (!a) return
        // Idle: let mixer advance normally; Walk: clock-driven
        if (node.clip === 'Walk') {
          a.setEffectiveTimeScale(0) // we’ll place time via gait clock below
        } else {
          // Non-gait clips (e.g., Idle) can use mixer time normally
          if (ctx && node.timeScale) a.setEffectiveTimeScale(node.timeScale(ctx))
          else a.setEffectiveTimeScale(1)
        }

        if (fade > 0) a.fadeIn(fade)
        else a.setEffectiveWeight(weight)
        a.enabled = true
        a.play()

        // Keep gait-synced time for Walk every frame
        if (node.clip === 'Walk') {
          const dur = a.getClip()?.duration ?? 0
          if (dur > 0) a.time = this.gaitClock * dur
        }
        break
      }

      case 'turnBlend': {
        if (!ctx) return
        const from = this.actions[node.fromClip]   // Walk
        const to   = this.actions[node.toClip]     // Turn
        if (!from || !to) return

        // Both clips are clock-driven
        from.setEffectiveTimeScale(0)
        to.setEffectiveTimeScale(0)

        // Place both by gait clock every frame
        const bd = from.getClip()?.duration ?? 0
        const td = to.getClip()?.duration ?? 0
        if (bd > 0) from.time = this.gaitClock * bd
        if (td > 0) to.time = this.gaitClock * td

        const dur = Math.max(0.001, node.duration(ctx))
        const tNorm = clamp01(ctx.timeInState / dur)

        const [inS, inE]   = node.rampIn  ?? [0.0, 0.65]
        const [outS, outE] = node.rampOut ?? [0.65, 1.0]

        const wIn  = smootherstep01(inS,  inE,  tNorm)     // 0→1
        const wOut = 1 - smootherstep01(outS, outE, tNorm) // 1→0
        const wTo  = clamp01(wIn * wOut)
        const wFrom = 1 - wTo

        from.enabled = true; from.play()
        to.enabled   = true; to.play()

        if (ctx.timeInState === 0) {
          from.setEffectiveWeight(1)
          to.setEffectiveWeight(0)
          to.reset().play()
        } else {
          from.setEffectiveWeight(wFrom)
          to.setEffectiveWeight(wTo)
        }
        break
      }
    }
  }

  private fadeNode(node: AnimNode, targetWeight: number, fade: number) {
    switch (node.kind) {
      case 'clip': {
        const a = this.actions[node.clip]
        if (!a) return
        if (targetWeight === 0) a.fadeOut(Math.max(0.01, fade))
        else a.fadeIn(Math.max(0.01, fade))
        break
      }
      case 'turnBlend': {
        const tb = node as TurnBlendNode
        const a = this.actions[tb.fromClip]
        const b = this.actions[tb.toClip]
        if (a) targetWeight === 0 ? a.fadeOut(Math.max(0.01, fade)) : a.fadeIn(Math.max(0.01, fade))
        if (b) targetWeight === 0 ? b.fadeOut(Math.max(0.01, fade)) : b.fadeIn(Math.max(0.01, fade))
        break
      }
    }
  }
}
