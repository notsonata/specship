import { z } from 'zod';

export const Artifact = z.object({ id: z.string().min(1), mime: z.string().min(1), path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive(), purpose: z.string().min(1) });
export const ArtifactInput = z.union([Artifact,z.object({path:z.string().min(1),mime:z.string().min(1),purpose:z.string().min(1),id:z.string().min(1).optional()}).strict()]);
export const AcceptanceCriterion = z.object({ id: z.string().min(1), text: z.string().min(1) }).strict();
export const AcceptanceResult = z.object({ criterion_id: z.string().min(1), evidence: z.string().trim().min(1) }).strict();
export const Brief = z.object({ outcome: z.string().min(1), acceptance: z.array(z.string().min(1)).min(1), boundaries: z.array(z.string()), decisions: z.array(z.string()), verified_context: z.array(z.string()), validation: z.array(z.string()), artifacts: z.array(ArtifactInput).optional(), acceptance_criteria: z.array(AcceptanceCriterion).optional(), required_checks: z.array(z.string().min(1)).optional() });
export const ImplementationReport = z.object({ status: z.enum(['ready_for_review', 'needs_decision', 'unable_to_continue']), changes: z.array(z.string()), acceptance_evidence: z.array(z.string()).default([]), validation: z.array(z.string()), deviations: z.array(z.string()), remaining_issues: z.array(z.string()), artifacts: z.array(ArtifactInput).optional(), acceptance_results: z.array(AcceptanceResult).optional() });
export const ExplorationReport = z.object({ findings: z.array(z.string()), checks_performed: z.array(z.string()), uncertainties: z.array(z.string()) });
export const Report = z.union([ImplementationReport, ExplorationReport]);
export type Brief = z.infer<typeof Brief>;
export type Report = z.infer<typeof Report>;
export function acceptanceEvidenceIssues(criteria: Array<{ id: string }>, results: Array<{ criterion_id: string; evidence: string }>): string[] {
  if (!criteria.length) return [];
  const expected = new Set(criteria.map(item => item.id));
  const seen = new Set<string>(), duplicates = new Set<string>(), unknown = new Set<string>();
  for (const result of results) {
    if (seen.has(result.criterion_id)) duplicates.add(result.criterion_id);
    seen.add(result.criterion_id);
    if (!expected.has(result.criterion_id)) unknown.add(result.criterion_id);
  }
  const missing = criteria.filter(item => !results.some(result => result.criterion_id === item.id && result.evidence.trim())).map(item => item.id);
  return [
    ...(missing.length ? [`missing criterion IDs: ${missing.join(', ')}`] : []),
    ...(duplicates.size ? [`duplicate criterion IDs: ${[...duplicates].join(', ')}`] : []),
    ...(unknown.size ? [`unknown criterion IDs: ${[...unknown].join(', ')}`] : []),
  ];
}
export type EventKind = 'exploration_completed'|'decision_required'|'user_input_required'|'implementation_ready'|'execution_failed'|'paused'|'cancelled'|'limit_reached';
export interface MaterialEvent { run_id: string; activity_id: string; event_id: string; brief_version: number; profile: string; supervisor_handle: string; report_id?: string; kind: EventKind; payload: unknown }
export type ActivityKind = 'explore'|'implement'|'correct';
export type NativePermissionAction = 'allow' | 'ask' | 'deny';
export interface OpenCodeProfile { harness: 'opencode'; model: string; executable?: string; options: { variant?: 'low'|'medium'|'high'; shell?: string; permission?: Record<string, NativePermissionAction> } }
export interface DeepSeekProfile { harness: 'deepseek'; model: string; executable: string; options: { reasoning_effort?: 'off'|'low'|'high'|'max'; profile?: string; cli?: string; sandbox?: 'workspace-write'|'danger-full-access'; callbacks?: 'native'|'mcp' } }
export type Profile = OpenCodeProfile | DeepSeekProfile;
export function isOpenCodeProfile(profile: Profile): profile is OpenCodeProfile { return profile.harness === 'opencode'; }
export function isDeepSeekProfile(profile: Profile): profile is DeepSeekProfile { return profile.harness === 'deepseek'; }
export interface CheckDefinition { command: string; cwd?: string; timeout_ms?: number; expected_exit?: number }
export interface RunnerConfig { ship: { default_profile: string; profiles: Record<string, Profile>; isolation?: 'shared' | 'worktree' }; limits: { max_dispatch_seconds?: number | null; delivery_margin_seconds: number }; checks?: Record<string, CheckDefinition> }
