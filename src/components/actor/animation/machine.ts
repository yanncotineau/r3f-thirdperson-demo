// Minimal FSM types for Idle / Walk / Run

export type AnimStateId = 'idle' | 'walk' | 'run'

export type ConditionCtx = {
  speed: number
  input: { x: number; z: number; run: boolean }
  headingRad: number
  prevHeadingRad: number
  timeInState: number
}

export type ClipNode = {
  kind: 'clip'
  clip: string
  loop?: boolean
  timeScale?: (ctx: ConditionCtx) => number
}

export type AnimNode = ClipNode

export type StateDef = {
  id: AnimStateId
  node: AnimNode
}

export type Transition = {
  from: AnimStateId | 'any'
  to: AnimStateId
  when: (ctx: ConditionCtx) => boolean
  minTimeInState?: number
  fade?: number
  interruptible?: boolean
}
