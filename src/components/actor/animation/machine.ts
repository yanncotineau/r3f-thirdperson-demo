export type AnimStateId =
  | 'idle'
  | 'walk'
  | 'walkLeftTurn'

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

export type TurnBlendNode = {
  kind: 'turnBlend'
  fromClip: string            // base clip (Walk)
  toClip: string              // turn clip (WalkLeftTurn)
  duration: (ctx: ConditionCtx) => number
  // Envelope windows (normalized 0..1)
  rampIn?:  [start: number, end: number]
  rampOut?: [start: number, end: number]
}

export type AnimNode = ClipNode | TurnBlendNode

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
