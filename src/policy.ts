import type { RunState } from './state.js';
import { SpecshipError } from './errors.js';

export type Phase =
  | 'idle' | 'dispatching' | 'running'
  | 'awaiting_decision' | 'awaiting_user' | 'awaiting_review'
  | 'paused' | 'limit_reached' | 'cancelled' | 'completed' | 'failed';

export type Action =
  | 'dispatch' | 'reply' | 'wait' | 'inspect' | 'accept'
  | 'pause' | 'resume' | 'cancel'
  | 'ship_question' | 'ship_permission' | 'ship_report_ready' | 'ship_report_needs'
  | 'deadline' | 'interrupt' | 'recover';

export type Actor = 'spec' | 'ship' | 'runner' | 'user';

const TERMINAL = new Set<Phase>(['cancelled', 'completed', 'failed']);

const TARGET: Partial<Record<Action, Phase>> = {
  dispatch: 'running',
  reply: 'running',
  resume: 'running',
  recover: 'running',
  ship_question: 'awaiting_decision',
  ship_permission: 'awaiting_user',
  ship_report_ready: 'awaiting_review',
  ship_report_needs: 'awaiting_decision',
  accept: 'completed',
  pause: 'paused',
  interrupt: 'paused',
  deadline: 'limit_reached',
  cancel: 'cancelled',
};

const ALLOWED: Record<Phase, Set<Action>> = {
  idle: new Set(['dispatch', 'wait', 'inspect']),
  dispatching: new Set(['dispatch', 'wait', 'inspect', 'cancel']),
  running: new Set(['dispatch', 'ship_question', 'ship_permission', 'ship_report_ready', 'ship_report_needs', 'deadline', 'interrupt', 'pause', 'cancel', 'wait', 'inspect']),
  awaiting_decision: new Set(['reply', 'cancel', 'deadline', 'interrupt', 'wait', 'inspect']),
  awaiting_user: new Set(['reply', 'cancel', 'deadline', 'interrupt', 'wait', 'inspect']),
  awaiting_review: new Set(['accept', 'dispatch', 'pause', 'cancel', 'interrupt', 'wait', 'inspect']),
  paused: new Set(['resume', 'recover', 'cancel', 'dispatch', 'wait', 'inspect']),
  limit_reached: new Set(['recover', 'cancel', 'wait', 'inspect']),
  cancelled: new Set(['wait', 'inspect']),
  completed: new Set(['wait', 'inspect']),
  failed: new Set(['wait', 'inspect', 'cancel']),
};

export function phaseFromLegacy(lifecycle: string): Phase {
  switch (lifecycle) {
    case 'idle': return 'idle';
    case 'running': return 'running';
    case 'awaiting_spec': return 'awaiting_decision';
    case 'awaiting_user': return 'awaiting_user';
    case 'awaiting_review': return 'awaiting_review';
    case 'paused': return 'paused';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    case 'limit_reached': return 'limit_reached';
    default: return 'failed';
  }
}

export function legacyPhase(phase: Phase): string {
  if (phase === 'awaiting_decision') return 'awaiting_spec';
  if (phase === 'limit_reached') return 'paused';
  return phase;
}

export function isTerminal(phase: Phase): boolean { return TERMINAL.has(phase); }

export function setPhase(state: RunState, phase: Phase): void {
  state.phase = phase;
  state.lifecycle = legacyPhase(phase);
}

export function authorize(state: RunState, action: Action): void {
  const phase = state.phase ?? phaseFromLegacy(state.lifecycle);
  if (TERMINAL.has(phase) && action !== 'wait' && action !== 'inspect' && action !== 'cancel') {
    throw new SpecshipError('TERMINAL_RUN', `Run is terminal (${phase}); no further mutation is allowed`);
  }
  if (!ALLOWED[phase].has(action)) {
    throw new SpecshipError('INVALID_TRANSITION', `Action ${action} is not allowed from phase ${phase}`);
  }
}

export function transition(state: RunState, action: Action): Phase {
  authorize(state, action);
  const target = TARGET[action];
  if (!target) throw new SpecshipError('INVALID_TRANSITION', `Action ${action} does not change the run phase`);
  setPhase(state, target);
  return target;
}

export function assertInvariants(state: RunState): void {
  if (state.schema !== 1 && state.schema !== 2) throw new SpecshipError('INTERNAL', `Unsupported run schema ${String((state as any).schema)}`);
  if (!state.phase) state.phase = phaseFromLegacy(state.lifecycle);
  if (legacyPhase(state.phase) !== state.lifecycle) throw new SpecshipError('INTERNAL', `Run phase ${state.phase} conflicts with lifecycle ${state.lifecycle}`);
  if (!Number.isInteger(state.brief_version) || state.brief_version < 0) throw new SpecshipError('INTERNAL', 'Run brief_version must be a nonnegative integer');
  if (!state.operation_ids || typeof state.operation_ids !== 'object' || Array.isArray(state.operation_ids)) throw new SpecshipError('INTERNAL', 'Run operation_ids must be an object');
  if (!Array.isArray(state.events)) throw new SpecshipError('INTERNAL', 'Run events must be an array');
  if (state.phase === 'awaiting_review') {
    if (!state.report || !state.report_id) throw new SpecshipError('INTERNAL', 'An awaiting_review run must have a report and report_id');
  }
  if (Boolean(state.report) !== Boolean(state.report_id)) throw new SpecshipError('INTERNAL', 'Run report and report_id must agree');
  if (state.phase === 'awaiting_decision' || state.phase === 'awaiting_user') {
    if (!state.pending) throw new SpecshipError('INTERNAL', `A run in ${state.phase} must have a pending interaction`);
  }
}
