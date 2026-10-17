import { z } from 'zod';

export const Artifact = z.object({ id: z.string().min(1), mime: z.string().min(1), path: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive(), purpose: z.string().min(1) });
export const ArtifactInput = z.union([Artifact,z.object({path:z.string().min(1),mime:z.string().min(1),purpose:z.string().min(1),id:z.string().min(1).optional()}).strict()]);
export const Brief = z.object({ outcome: z.string().min(1), acceptance: z.array(z.string().min(1)).min(1), boundaries: z.array(z.string()), decisions: z.array(z.string()), verified_context: z.array(z.string()), validation: z.array(z.string()), artifacts: z.array(ArtifactInput).optional() });
export const ImplementationReport = z.object({ status: z.enum(['ready_for_review', 'needs_decision', 'unable_to_continue']), changes: z.array(z.string()), acceptance_evidence: z.array(z.string()), validation: z.array(z.string()), deviations: z.array(z.string()), remaining_issues: z.array(z.string()), artifacts: z.array(ArtifactInput).optional() });
export const ExplorationReport = z.object({ findings: z.array(z.string()), checks_performed: z.array(z.string()), uncertainties: z.array(z.string()) });
export const Report = z.union([ImplementationReport, ExplorationReport]);
export type Brief = z.infer<typeof Brief>;
export type Report = z.infer<typeof Report>;
export type EventKind = 'exploration_completed'|'decision_required'|'user_input_required'|'implementation_ready'|'execution_failed'|'paused'|'cancelled'|'limit_reached';
export interface MaterialEvent { run_id: string; activity_id: string; event_id: string; brief_version: number; profile: string; supervisor_handle: string; report_id?: string; kind: EventKind; payload: unknown }
export type ActivityKind = 'explore'|'implement'|'correct';
export interface Profile { harness: 'opencode'; model: string; executable?: string; options: { variant?: string; [key: string]: unknown } }
export interface RunnerConfig { ship: { default_profile: string; profiles: Record<string, Profile> }; limits: { max_dispatch_seconds: number; delivery_margin_seconds: number } }
