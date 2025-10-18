import * as THREE from 'three'
import type {
  AnimNode, AnimStateId, ConditionCtx, StateDef, Transition
} from './machine'

export type ActionMap = Record<string, THREE.AnimationAction>

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

    // Prime all actions
    Object.values(this.actions).forEach(a => {
      a.enabled = true
      a.setEffectiveWeight(0)
      a.setLoop(THREE.LoopRepeat, Infinity)
      a.play()
    })

    // Start in the initial state's clip
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

    // transitions (first match wins)
    for (const t of this.transitions) {
      if (t.from !== 'any' && t.from !== this.current) continue
      if (t.minTimeInState && this.timeInState < t.minTimeInState) continue
      if (!t.when(fullCtx)) continue
      this.crossFadeTo(t.to, t.fade ?? 0.12, fullCtx)
      break
    }

    // drive active node (update clip timescales if needed)
    const node = this.states.get(this.current)!.node
    this.applyNode(node, undefined, fullCtx)

    this.mixer.update(dt)
    this.timeInState += dt
  }

  private crossFadeTo(next: AnimStateId, fade: number, ctx: ConditionCtx) {
    if (next === this.current) return
    const fromNode = this.states.get(this.current)!.node
    const toNode   = this.states.get(next)!.node

    this.timeInState = 0
    const entryCtx: ConditionCtx = { ...ctx, timeInState: 0 }

    // Clip → Clip
    const from = this.actions[(fromNode as AnimNode).clip]
    const to   = this.actions[(toNode   as AnimNode).clip]
    if (from && to) {
      // Apply target playback rate
      if (toNode.kind === 'clip' && toNode.timeScale) {
        to.setEffectiveTimeScale(toNode.timeScale(entryCtx))
      } else {
        to.setEffectiveTimeScale(1)
      }
      to.reset().play()
      to.crossFadeFrom(from, Math.max(0.01, fade), false)
    } else {
      // Fallback: just set target node weight
      this.fadeNode(fromNode, 0, fade)
      this.applyNode(toNode, 1, entryCtx, fade)
    }

    this.current = next
  }

  private applyNode(node: AnimNode, weight = 1, ctx?: ConditionCtx, fade = 0.0) {
    const a = this.actions[node.clip]
    if (!a) return
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
