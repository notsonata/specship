import { readFile } from 'node:fs/promises';

/**
 * Native DSH callback tools for a Specship runner.
 *
 * The plugin is loaded through a per-launch `--patch` overlay, so it does not
 * modify the user's DSH profile. It reads the runner's authenticated descriptor
 * from the environment and calls the loopback callback server directly. Unlike
 * an MCP tool call, these native tools have no 60-second transport ceiling.
 */
export const name = 'specship-callbacks';
export const inject = ['tools'];

type Descriptor = { url: string; capability: string };

async function descriptor(): Promise<Descriptor> {
  const path = process.env.SPECSHIP_CALLBACK_DESCRIPTOR;
  if (!path) throw new Error('Specship callback descriptor is unavailable');
  const value = JSON.parse(await readFile(path, 'utf8'));
  const url = new URL(value.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || !url.port || url.username || url.password || url.search || url.hash || typeof value.capability !== 'string') {
    throw new Error('Specship callback descriptor is not a trusted loopback endpoint');
  }
  return { url: url.origin, capability: value.capability };
}

async function post(path: string, body: unknown, signal?: AbortSignal): Promise<any> {
  const target = await descriptor();
  const response = await fetch(`${target.url}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${target.capability}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Specship callback failed (${response.status})`);
  return text ? JSON.parse(text) : {};
}

export function apply(ctx: any): void {
  ctx.tools.register({
    name: 'ask_spec',
    description: 'Persist a consequential blocker with the Spec supervisor and wait for the original answer.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        request_id: { type: 'string', description: 'Stable request ID unique within this run.' },
        blocker: { type: 'string', description: 'The decision or missing authority.' },
        decision: { type: 'string', description: 'The one decision needed from Spec.' },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Concrete evidence supporting the blocker.' },
        attempts: { type: 'array', items: { type: 'string' }, description: 'Meaningful attempts already made.' },
        image_artifact_ids: { type: 'array', items: { type: 'string' }, description: 'Optional original image artifact IDs.' },
      },
      required: ['request_id', 'blocker', 'decision', 'evidence', 'attempts'],
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string' } } },
      render: (_args: unknown, value: any) => [{ type: 'text', text: value.text }],
    },
    async execute(args: any, exec: any) {
      const answer = await post('/ask_spec', args, exec?.signal);
      return { text: typeof answer?.text === 'string' ? answer.text : '' };
    },
  });

  ctx.tools.register({
    name: 'report_result',
    description: 'Submit a structured exploration result or implementation report. ready_for_review requires acceptance_results with one {criterion_id,evidence} per exact brief criterion ID. Repair and resubmit rejected reports; prose alone does not cover criteria.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: ['exploration', 'implementation'] },
        status: { type: 'string', enum: ['ready_for_review', 'needs_decision', 'unable_to_continue'] },
        changes: { type: 'array', items: { type: 'string' } },
        acceptance_evidence: { type: 'array', items: { type: 'string' } },
        acceptance_results: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { criterion_id: { type: 'string', minLength: 1 }, evidence: { type: 'string', minLength: 1 } }, required: ['criterion_id', 'evidence'] } },
        validation: { type: 'array', items: { type: 'string' } },
        deviations: { type: 'array', items: { type: 'string' } },
        remaining_issues: { type: 'array', items: { type: 'string' } },
        findings: { type: 'array', items: { type: 'string' } },
        checks_performed: { type: 'array', items: { type: 'string' } },
        uncertainties: { type: 'array', items: { type: 'string' } },
        artifacts: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      required: ['kind'],
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { accepted: { type: 'boolean' } } },
      render: () => [{ type: 'text', text: 'Specship report submitted.' }],
    },
    async execute(args: any, exec: any) {
      await post('/report_result', args, exec?.signal);
      return { accepted: true };
    },
  });
}
