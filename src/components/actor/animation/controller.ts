import * as THREE from 'three'
import type {
  AnimNode, AnimStateId, ConditionCtx, StateDef, Transition, TurnBlendNode
} from './machine'

export type ActionMap = Record<string, THREE.AnimationAction>

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const smoothstep01 = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export class AnimationController {
  private current: AnimStateId
  private timeInState = 0
  private states: Map<AnimStateId, StateDef>
  private transitions: Transition[]
  private actions: ActionMap
  private mixer: THREE.AnimationMixer

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

    // Start all actions muted
    Object.values(this.actions).forEach(a => {
      a.enabled = true
      a.setEffectiveWeight(0)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.play()
    })

    // Initialize with a full default ctx
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

    // transitions
    for (const t of this.transitions) {
      if (t.from !== 'any' && t.from !== this.current) continue
      if (t.minTimeInState && this.timeInState < t.minTimeInState) continue
      if (!t.when(fullCtx)) continue
      this.crossFadeTo(t.to, t.fade ?? 0.12, fullCtx)
      break
    }

    // drive current node
    const node = this.states.get(this.current)!.node
    this.applyNode(node, undefined, fullCtx)

    this.mixer.update(dt)
    this.timeInState += dt
  }

  private crossFadeTo(next: AnimStateId, fade: number, ctx: ConditionCtx) {
    if (next === this.current) return
    const fromNode = this.states.get(this.current)!.node
    const toNode = this.states.get(next)!.node

    // Prepare entry context for new node
    this.timeInState = 0
    const entryCtx: ConditionCtx = { ...ctx, timeInState: 0 }

    if (fromNode.kind === 'clip' && toNode.kind === 'clip') {
      const from = this.actions[fromNode.clip]
      const to = this.actions[toNode.clip]
      if (from && to) {
        to.reset().play()
        to.crossFadeFrom(from, Math.max(0.01, fade), false)
      } else {
        this.fadeNode(fromNode, 0, fade)
        this.applyNode(toNode, 1, entryCtx, fade)
      }
    }
    else if (toNode.kind === 'turnBlend') {
      const tb = toNode as TurnBlendNode
      const turnPose = this.actions[tb.toClip]
      if (turnPose) turnPose.reset().play()
      const base = this.actions[tb.fromClip]
      if (base) { base.enabled = true; base.setEffectiveWeight(1) }
      if (turnPose) { turnPose.enabled = true; turnPose.setEffectiveWeight(0) }
      this.applyNode(toNode, 1, entryCtx, 0)
    }
    else if (fromNode.kind === 'turnBlend' && toNode.kind === 'clip') {
      // Hand-off with captured weights to avoid any dip
      const tb = fromNode as TurnBlendNode
      const base = this.actions[tb.fromClip]   // Walk
      const turnPose = this.actions[tb.toClip] // Turn
      const to = this.actions[toNode.clip]     // Walk

      const dur = Math.max(0.001, tb.duration(ctx))
      const tNorm = clamp01(ctx.timeInState / dur)
      const [inS, inE] = tb.rampIn ?? [0.0, 0.35]
      const [outS, outE] = tb.rampOut ?? [0.55, 1.0]

      const wIn = smoothstep01(inS, inE, tNorm)
      const wOut = 1 - smoothstep01(outS, outE, tNorm)
      const wTo = clamp01(wIn * wOut)       // turn pose
      const wFrom = 1 - wTo                 // base walk

      if (to) {
        to.enabled = true; to.play()
        to.setEffectiveWeight(wFrom)
        to.fadeIn(Math.max(0.01, fade))
      }
      if (turnPose) {
        turnPose.setEffectiveWeight(wTo)
        turnPose.fadeOut(Math.max(0.01, fade))
      }
      if (base && base !== to) {
        base.setEffectiveWeight(wFrom)
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
        if (ctx && node.timeScale) a.setEffectiveTimeScale(node.timeScale(ctx))
        if (fade > 0) a.fadeIn(fade)
        else a.setEffectiveWeight(weight)
        a.enabled = true
        a.play()
        break
      }

      case 'turnBlend': {
        if (!ctx) return
        const from = this.actions[node.fromClip]
        const to   = this.actions[node.toClip]
        if (!from || !to) return

        const dur = Math.max(0.001, node.duration(ctx))
        const tNorm = clamp01(ctx.timeInState / dur)

        const [inS, inE]   = node.rampIn  ?? [0.0, 0.45]
        const [outS, outE] = node.rampOut ?? [0.55, 1.0]

        const wIn  = smoothstep01(inS,  inE,  tNorm)          // 0→1
        const wOut = 1 - smoothstep01(outS, outE, tNorm)      // 1→0
        const wTo  = clamp01(wIn * wOut)                      // bell-ish
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

        from.setEffectiveTimeScale(1)
        to.setEffectiveTimeScale(1)
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
