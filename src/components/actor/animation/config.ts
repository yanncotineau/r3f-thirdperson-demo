import type { StateDef, Transition } from './machine'

export const ACTION = {
  Idle: 'Idle',
  Walk: 'Walk',
  WalkLeftTurn: 'WalkLeftTurn',
} as const

// Single source of truth
export const DEFAULT_TURN_LEFT_DURATION = 0.65 // seconds

const DEG = (d: number) => (d * Math.PI) / 180

// Entry tuning
const FORWARD_Z_MIN      = 0.2
const ENTER_LEFT_MIN_X   = -0.55
const PREV_NEAR_STRAIGHT = DEG(15)

export const STATES: StateDef[] = [
  { id: 'idle', node: { kind: 'clip', clip: ACTION.Idle } },
  {
    id: 'walk',
    node: {
      kind: 'clip',
      clip: ACTION.Walk,
      // This remains your canonical speed->timeScale curve.
      timeScale: ({ speed }) => {
        const base = 1
        return Math.min(1.6, Math.max(0.8, base + (speed - 1.5) * 0.25))
      },
    },
  },
  {
    id: 'walkLeftTurn',
    node: {
      kind: 'turnBlend',
      fromClip: ACTION.Walk,
      toClip: ACTION.WalkLeftTurn,
      duration: () => DEFAULT_TURN_LEFT_DURATION,
      // Long, soft envelope (stays super smooth)
      rampIn:  [0.00, 0.65],
      rampOut: [0.65, 1.00],
    },
  },
]

export const makeTransitions = (): Transition[] => {
  const D = DEFAULT_TURN_LEFT_DURATION
  return [
    // Stop -> Idle
    { from: 'any',  to: 'idle', when: ({ speed }) => speed <= 0.05, fade: 0.22 },

    // Idle -> Walk
    { from: 'idle', to: 'walk', when: ({ speed }) => speed > 0.05,  fade: 0.16 },

    // Walk -> WalkLeftTurn (no phase gating anymore; gait clock keeps feet aligned)
    {
      from: 'walk',
      to: 'walkLeftTurn',
      minTimeInState: 0.03,
      when: ({ speed, input, prevHeadingRad }) =>
        speed > 0.05 &&
        input.z > FORWARD_Z_MIN &&
        input.x <= ENTER_LEFT_MIN_X &&
        Math.abs(prevHeadingRad) <= PREV_NEAR_STRAIGHT,
      fade: 0.14,
    },

    // WalkLeftTurn -> Walk (finish at duration or abort if not forward-left)
    {
      from: 'walkLeftTurn',
      to: 'walk',
      when: ({ timeInState, input }) =>
        timeInState >= D ||
        !(input.z > FORWARD_Z_MIN && input.x <= ENTER_LEFT_MIN_X),
      fade: 0.14,
    },

    // Stay in Walk if already moving
    { from: 'walk', to: 'walk', when: ({ speed }) => speed > 0.05, fade: 0.0 },
  ]
}
