import type { StateDef, Transition } from './machine'

export const ACTION = {
  Idle:         'Idle',
  Walk:         'Walk',
  Run:          'Run',
  RunStop:      'RunStop',
  IdleToSprint: 'IdleToSprint',
} as const

export const STATES: StateDef[] = [
  { id: 'idle',         node: { kind: 'clip', clip: ACTION.Idle } },
  { id: 'walk',         node: { kind: 'clip', clip: ACTION.Walk } },
  { id: 'run',          node: { kind: 'clip', clip: ACTION.Run } },
  // One-shots
  { id: 'runStop',      node: { kind: 'clip', clip: ACTION.RunStop,      loop: false, exitTo: 'idle' } },
  { id: 'idleToSprint', node: { kind: 'clip', clip: ACTION.IdleToSprint, loop: false, exitTo: 'run'  } },
]

const inputMag = (x: number, z: number) => Math.hypot(x, z)
const STOP_INPUT  = 0.12
const START_INPUT = 0.12
const SPEED_EPS   = 0.05

// Shift-release grace for RunStop
export const RUN_GRACE = 0.25 // seconds

export const makeTransitions = (): Transition[] => [
  // ─────────────────────────────────────────────────────────────────────────────
  // Highest priority: One-shot guards
  // ─────────────────────────────────────────────────────────────────────────────

  // Grace-based RunStop
  {
    from: 'any',
    to: 'runStop',
    when: ({ runReleasedAgo, input, speed }) =>
      runReleasedAgo < RUN_GRACE &&
      inputMag(input.x, input.z) < STOP_INPUT &&
      speed > SPEED_EPS,
    fade: 0.10,
  },

  // Idle → IdleToSprint one-shot: start moving with Shift from true idle
  {
    from: 'idle',
    to: 'idleToSprint',
    when: ({ input, speed }) =>
      input.run &&
      inputMag(input.x, input.z) >= START_INPUT &&
      speed <= SPEED_EPS,
    fade: 0.10,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Core locomotion
  // ─────────────────────────────────────────────────────────────────────────────

  // Fallbacks if one-shot didn’t trigger (e.g., asset missing)
  { from: 'idle', to: 'run',  when: ({ speed, input }) => speed > SPEED_EPS && input.run,  fade: 0.18 },
  { from: 'idle', to: 'walk', when: ({ speed, input }) => speed > SPEED_EPS && !input.run, fade: 0.16 },

  // Walk ↔ Run while moving
  { from: 'walk', to: 'run',  when: ({ speed, input }) => speed > SPEED_EPS && input.run,  fade: 0.16 },
  { from: 'run',  to: 'walk', when: ({ speed, input }) => speed > SPEED_EPS && !input.run, fade: 0.16 },

  // Run → RunStop (regular, release movement while running)
  {
    from: 'run',
    to: 'runStop',
    when: ({ input, speed }) =>
      inputMag(input.x, input.z) < STOP_INPUT &&
      speed > SPEED_EPS,
    fade: 0.10,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // One-shot interrupts / resumes
  // ─────────────────────────────────────────────────────────────────────────────

  // If you abort the sprint start (release movement), bail to Idle
  {
    from: 'idleToSprint',
    to: 'idle',
    when: ({ input }) => inputMag(input.x, input.z) < STOP_INPUT,
    fade: 0.12,
  },
  // If you keep moving but release Shift mid-start, go to Walk
  {
    from: 'idleToSprint',
    to: 'walk',
    when: ({ input }) => !input.run && inputMag(input.x, input.z) >= START_INPUT,
    fade: 0.14,
  },
  // Otherwise the controller will auto-exit to Run (exitTo) with a very smooth handoff

  // If you resume input during RunStop, go back to locomotion
  {
    from: 'runStop',
    to: 'run',
    when: ({ input }) => input.run && inputMag(input.x, input.z) >= START_INPUT,
    fade: 0.12,
  },
  {
    from: 'runStop',
    to: 'walk',
    when: ({ input }) => !input.run && inputMag(input.x, input.z) >= START_INPUT,
    fade: 0.12,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Generic stop / stay rules (ordered last so one-shots & specifics win first)
  // ─────────────────────────────────────────────────────────────────────────────
  { from: 'any',  to: 'idle', when: ({ speed }) => speed <= SPEED_EPS, fade: 0.22, interruptible: true },
  { from: 'walk', to: 'walk', when: ({ speed, input }) => speed > SPEED_EPS && !input.run, fade: 0.0 },
  { from: 'run',  to: 'run',  when: ({ speed, input }) => speed > SPEED_EPS &&  input.run,  fade: 0.0 },
]
