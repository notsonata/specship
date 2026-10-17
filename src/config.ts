import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { isAbsolute } from 'node:path';
import type { Profile, RunnerConfig } from './contracts.js';

const profile = z.object({ harness: z.literal('opencode'), model: z.string().regex(/^[^/]+\/.+$/), executable: z.string().min(1).optional(), options: z.object({ variant: z.enum(['low','medium','high']).optional(),shell:z.string().refine(isAbsolute,'Shell must be an absolute executable path').optional() }).strict() }).strict();
export function splitModel(value:string):[string,string]{const split=value.indexOf('/');if(split<1||split===value.length-1)throw new Error('Model must be provider/model');return [value.slice(0,split),value.slice(split+1)];}
const schema = z.object({ ship: z.object({ default_profile: z.string(), profiles: z.record(z.string(), profile) }).refine(p => Object.hasOwn(p.profiles, p.default_profile), 'default_profile must name a configured profile'), limits: z.object({ max_dispatch_seconds: z.number().int().positive(), delivery_margin_seconds: z.number().int().positive() }).strict() }).strict();
export async function readConfig(path: string): Promise<RunnerConfig> { return schema.parse(JSON.parse(await readFile(path, 'utf8'))) as RunnerConfig; }
export function resolveProfile(config: RunnerConfig, name?: string): { name: string; profile: Profile } { const selected = name ?? config.ship.default_profile; const profile = config.ship.profiles[selected]; if (!profile) throw new Error(`Unknown Ship profile '${selected}'`); return { name: selected, profile }; }
