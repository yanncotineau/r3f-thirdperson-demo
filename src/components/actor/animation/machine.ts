// Minimal FSM types for Idle / Walk / Run + one-shots (RunStop, IdleToSprint)

export type AnimStateId = 'idle' | 'walk' | 'run' | 'runStop' | 'idleToSprint'

export type ConditionCtx = {
  speed: number
  input: { x: number; z: number; run: boolean }
  headingRad: number
  prevHeadingRad: number
  timeInState: number
  // Seconds since Shift was released (Infinity while held or never pressed)
  runReleasedAgo: number
}

export type ClipNode = {
  kind: 'clip'
  clip: string
  loop?: boolean
  // For one-shots: where to go when done (controller blends proactively)
  exitTo?: AnimStateId
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
