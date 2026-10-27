import type { MaterialEvent } from './contracts.js';

// Project only at the supervisor boundary. Durable events, reports and acceptance
// checks retain their original evidence, including on recovery and replay.
export function compactReviewEvent(event: MaterialEvent, statePath: string): MaterialEvent {
  if (event.kind !== 'implementation_ready') return event;
  const payload = event.payload as Record<string, any>;
  const report = payload.report;
  if (!report || report.status !== 'ready_for_review') return event;
  const truncated: string[] = [];
  const preview = (value: string, field: string): string => {
    if (value.length <= 1_000) return value;
    truncated.push(field);
    return `${value.slice(0, 1_000)}…`;
  };
  const summaries = (values: string[], field: string): string[] => {
    const unique = [...new Set(values)];
    if (unique.length > 10) truncated.push(field);
    return unique.slice(0, 10).map((value, index) => preview(value, `${field}[${index}]`));
  };
  const results = report.acceptance_results as Array<{ criterion_id: string; evidence: string }> | undefined;
  const structuredEvidence = new Set(results?.map(result => result.evidence));
  const acceptance = (report.acceptance_evidence as string[]).filter(value => !structuredEvidence.has(value));
  const compactReport = {
    ...report,
    changes: summaries(report.changes, 'report.changes'),
    validation: summaries(report.validation, 'report.validation'),
    acceptance_evidence: summaries(acceptance, 'report.acceptance_evidence'),
    ...(results ? { acceptance_results: results.map((result, index) => ({
      ...result, evidence: preview(result.evidence, `report.acceptance_results[${index}].evidence`),
    })) } : {}),
  };
  const checks = payload.checks?.map((check: Record<string, unknown>) => {
    // Keep failures/errors intact. Successful output and audit hashes remain in
    // state.check_results, rather than competing with criterion evidence here.
    if (check.status !== 'passed') return check;
    const { output_summary, stdout_sha256, stderr_sha256, duration_ms, ...summary } = check;
    return summary;
  });
  return { ...event, payload: {
    ...payload, report: compactReport, ...(checks ? { checks } : {}),
    evidence_ref: { state_path: statePath, report_id: event.report_id },
    ...(truncated.length ? { truncated_fields: truncated } : {}),
  } };
}
