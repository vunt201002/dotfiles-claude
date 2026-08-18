import type { Lane } from '../types';

export type ManagerVerifyGate =
  | 'red-test'
  | 'B8-assert'
  | 'B8-judge'
  | 'design-judge';
export type ManagerReviewGate =
  | 'spec-check'
  | 'tech-review'
  | 'impact-review';
export type ManagerDispatchGate = ManagerVerifyGate | ManagerReviewGate;
export type HookGate = 'hook';
export type OracleGate = ManagerDispatchGate | HookGate;
export type OracleOwner = 'manager-dispatch' | 'hook';
export type OraclePhase = 'verify' | 'review';
export type OracleCondition = 'always' | 'real-browser-oracle';

interface OracleEntryBase {
  phase: OraclePhase;
  condition: OracleCondition;
  displayName: string;
}

export type OracleChainEntry =
  | (OracleEntryBase & { gate: ManagerVerifyGate; owner: 'manager-dispatch'; phase: 'verify' })
  | (OracleEntryBase & { gate: ManagerReviewGate; owner: 'manager-dispatch'; phase: 'review' })
  | (OracleEntryBase & { gate: HookGate; owner: 'hook'; phase: 'verify' });

const hook = { gate: 'hook', owner: 'hook', phase: 'verify', condition: 'always', displayName: 'hook(lint/tsc)' } as const;
const redTest = {
  gate: 'red-test',
  owner: 'manager-dispatch',
  phase: 'verify',
  condition: 'always',
  displayName: 'red-test',
} as const;
const b8Assert = {
  gate: 'B8-assert',
  owner: 'manager-dispatch',
  phase: 'verify',
  condition: 'always',
  displayName: 'B8-assert',
} as const;
const b8Judge = {
  gate: 'B8-judge',
  owner: 'manager-dispatch',
  phase: 'verify',
  condition: 'real-browser-oracle',
  displayName: 'B8-judge',
} as const;
const designJudge = {
  gate: 'design-judge',
  owner: 'manager-dispatch',
  phase: 'verify',
  condition: 'real-browser-oracle',
  displayName: 'design-judge',
} as const;
const specCheck = {
  gate: 'spec-check',
  owner: 'manager-dispatch',
  phase: 'review',
  condition: 'always',
  displayName: 'spec-check',
} as const;
const techReview = {
  gate: 'tech-review',
  owner: 'manager-dispatch',
  phase: 'review',
  condition: 'always',
  displayName: 'tech-review',
} as const;
const impactReview = {
  gate: 'impact-review',
  owner: 'manager-dispatch',
  phase: 'review',
  condition: 'always',
  displayName: 'impact-review',
} as const;

export const ORACLE_CHAIN = {
  trivial: [hook],
  'bug-nho': [hook, redTest, b8Assert, specCheck],
  'bug-lon': [hook, redTest, b8Assert, b8Judge, specCheck, techReview],
  feature: [hook, b8Assert, designJudge, specCheck, techReview, impactReview],
} as const satisfies Record<Lane, readonly OracleChainEntry[]>;

export function managerChain<P extends OraclePhase>(
  lane: Lane,
  phase: P,
): Array<P extends 'verify' ? ManagerVerifyGate : ManagerReviewGate> {
  return ORACLE_CHAIN[lane]
    .filter((entry): entry is Extract<(typeof ORACLE_CHAIN)[Lane][number], { owner: 'manager-dispatch' }> =>
      entry.owner === 'manager-dispatch' && entry.phase === phase,
    )
    .map((entry) => entry.gate) as Array<P extends 'verify' ? ManagerVerifyGate : ManagerReviewGate>;
}

export function displayChain(lane: Lane): string {
  return ORACLE_CHAIN[lane].map((entry) => entry.displayName).join(' -> ');
}

export function managerGates(condition?: OracleCondition): ManagerDispatchGate[] {
  const gates = (Object.keys(ORACLE_CHAIN) as Lane[]).flatMap((lane) =>
    ORACLE_CHAIN[lane]
      .filter((entry) => entry.owner === 'manager-dispatch' && (!condition || entry.condition === condition))
      .map((entry) => entry.gate as ManagerDispatchGate),
  );
  return [...new Set(gates)];
}
