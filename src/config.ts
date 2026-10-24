import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { isAbsolute } from 'node:path';
import type { Profile, RunnerConfig } from './contracts.js';
import { DEFAULT_DELIVERY_MARGIN_SECONDS } from './timeouts.js';

const model = z.string().regex(/^[^/]+\/.+$/);
const opencode = z.object({
  harness: z.literal('opencode'),
  model,
  executable: z.string().min(1).optional(),
  options: z.object({
    variant: z.enum(['low','medium','high']).optional(),
    shell: z.string().refine(isAbsolute,'Shell must be an absolute executable path').optional(),
  }).strict(),
}).strict();
const deepseek = z.object({
  harness: z.literal('deepseek'),
  model,
  executable: z.string().min(1).refine(isAbsolute,'DeepSeek executable must be an absolute path'),
  options: z.object({
    reasoning_effort: z.enum(['off','low','high','max']).optional(),
    profile: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/,'DeepSeek profile name must be a simple profile identifier').optional(),
    cli: z.string().min(1).refine(isAbsolute,'DeepSeek CLI must be an absolute path').optional(),
    sandbox: z.enum(['workspace-write','danger-full-access']).optional(),
  }).strict(),
}).strict();
const profile = z.discriminatedUnion('harness', [opencode, deepseek]);
const check = z.object({
  command: z.string().min(1).max(8_000),
  cwd: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().max(600_000).optional(),
  expected_exit: z.number().int().optional(),
}).strict();
const schema = z.object({ ship: z.object({ default_profile: z.string(), profiles: z.record(z.string(), profile), isolation: z.enum(['shared','worktree']).optional() }).refine(p => Object.hasOwn(p.profiles, p.default_profile), 'default_profile must name a configured profile'), limits: z.object({ max_dispatch_seconds: z.number().int().positive().nullable().optional(), delivery_margin_seconds: z.number().int().positive().default(DEFAULT_DELIVERY_MARGIN_SECONDS) }).strict().default({ delivery_margin_seconds: DEFAULT_DELIVERY_MARGIN_SECONDS }), checks: z.record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), check).optional() }).strict();
export async function readConfig(path: string): Promise<RunnerConfig> { return schema.parse(JSON.parse(await readFile(path, 'utf8'))) as RunnerConfig; }
export function resolveProfile(config: RunnerConfig, name?: string): { name: string; profile: Profile } { const selected = name ?? config.ship.default_profile; const profile = config.ship.profiles[selected]; if (!profile) throw new Error(`Unknown Ship profile '${selected}'`); return { name: selected, profile }; }
export function splitModel(value:string):[string,string]{const split=value.indexOf('/');if(split<1||split===value.length-1)throw new Error('Model must be provider/model');return [value.slice(0,split),value.slice(split+1)];}
