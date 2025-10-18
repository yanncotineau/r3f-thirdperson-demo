import type { StateDef, Transition } from './machine'

export const ACTION = {
  Idle: 'Idle',
  Walk: 'Walk',
  Run:  'Run',
} as const

// States
export const STATES: StateDef[] = [
  { id: 'idle', node: { kind: 'clip', clip: ACTION.Idle } },

  // Optional: Walk cadence scales softly with world speed
  {
    id: 'walk',
    node: {
      kind: 'clip',
      clip: ACTION.Walk,
    },
  },

  // Run at EXACT authoring speed — no scaling
  {
    id: 'run',
    node: {
      kind: 'clip',
      clip: ACTION.Run,
    },
  },
]

// Transitions (ordered: specific before generic)
export const makeTransitions = (): Transition[] => [
  // Stop → Idle
  { from: 'any',  to: 'idle', when: ({ speed }) => speed <= 0.05, fade: 0.22 },

  // Idle → Run/Walk
  { from: 'idle', to: 'run',  when: ({ speed, input }) => speed > 0.05 && input.run,  fade: 0.18 },
  { from: 'idle', to: 'walk', when: ({ speed, input }) => speed > 0.05 && !input.run, fade: 0.16 },

  // Walk ↔ Run while moving
  { from: 'walk', to: 'run',  when: ({ speed, input }) => speed > 0.05 && input.run,  fade: 0.16 },
  { from: 'run',  to: 'walk', when: ({ speed, input }) => speed > 0.05 && !input.run, fade: 0.16 },

  // Stay if still moving in current mode (prevents churn during blends)
  { from: 'walk', to: 'walk', when: ({ speed, input }) => speed > 0.05 && !input.run, fade: 0.0 },
  { from: 'run',  to: 'run',  when: ({ speed, input }) => speed > 0.05 &&  input.run, fade: 0.0 },
]
