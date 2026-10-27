import test from 'node:test';
import assert from 'node:assert/strict';
import { compactReviewEvent } from '../../dist/review.js';

function event() {
  return {
    kind: 'implementation_ready', run_id: 'run', activity_id: 'activity', event_id: 'event',
    report_id: 'report', brief_version: 2, profile: 'strong', supervisor_handle: 'handle',
    payload: {
      workspace: '/project', changed_paths: ['fix.py'], checks_passed: false, uncovered_criteria: ['A2'],
      report: {
        status: 'ready_for_review', changes: ['fixed'], validation: ['tests passed'],
        acceptance_evidence: ['observed A1', 'unstructured counterexample'],
        acceptance_results: [{ criterion_id: 'A1', evidence: 'observed A1' }],
        deviations: ['constraint differs'], remaining_issues: ['A2 unverified'],
        artifacts: [{ id: 'image', path: '/image.png', sha256: 'original hash' }],
      },
      checks: [
        { id: 'pass', status: 'passed', exit_code: 0, expected_exit: 0, timed_out: false, output_summary: 'log'.repeat(600), stdout_sha256: 'hash', stderr_sha256: 'hash', duration_ms: 40 },
        { id: 'fail', status: 'failed', exit_code: 3, output_summary: 'independent failure', stderr_sha256: 'failure hash' },
        { id: 'missing', status: 'error', message: 'check is not configured' },
      ],
    },
  };
}

test('compact review preserves risks, identities and independent failures without mutating durable evidence', () => {
  const original = event(), saved = structuredClone(original);
  const projected = compactReviewEvent(original, '/project/.specship/runs/run/state.json');
  assert.deepEqual(original, saved);
  for (const key of ['kind', 'run_id', 'activity_id', 'event_id', 'report_id', 'brief_version', 'profile', 'supervisor_handle']) assert.equal(projected[key], original[key]);
  for (const key of ['workspace', 'changed_paths', 'checks_passed', 'uncovered_criteria']) assert.deepEqual(projected.payload[key], original.payload[key]);
  for (const key of ['deviations', 'remaining_issues', 'artifacts', 'acceptance_results']) assert.deepEqual(projected.payload.report[key], original.payload.report[key]);
  assert.deepEqual(projected.payload.report.acceptance_evidence, ['unstructured counterexample']);
  assert.deepEqual(projected.payload.checks.slice(1), original.payload.checks.slice(1));
  assert.equal(projected.payload.checks[0].status, 'passed');
  assert.equal(projected.payload.checks[0].output_summary, undefined);
  assert.equal(projected.payload.evidence_ref.report_id, original.report_id);
  assert.equal(projected.payload.evidence_ref.state_path, '/project/.specship/runs/run/state.json');
  assert.ok(JSON.stringify(projected).length < JSON.stringify(original).length * 0.65);
});

test('oversized review previews disclose omissions while keeping all criteria and critical issues', () => {
  const original = event();
  original.payload.report.changes = Array.from({ length: 15 }, (_, i) => `${i}:${'x'.repeat(2_000)}`);
  original.payload.report.acceptance_results = Array.from({ length: 15 }, (_, i) => ({ criterion_id: `A${i}`, evidence: 'e'.repeat(2_000) }));
  original.payload.report.remaining_issues = ['x'.repeat(2_000), ...Array(15).fill('risk')];
  const projected = compactReviewEvent(original, '/state.json');
  assert.equal(projected.payload.report.changes.length, 10);
  assert.ok(projected.payload.truncated_fields.includes('report.changes'));
  assert.ok(projected.payload.truncated_fields.includes('report.changes[0]'));
  assert.ok(projected.payload.truncated_fields.includes('report.acceptance_results[14].evidence'));
  assert.deepEqual(projected.payload.report.acceptance_results.map(result => result.criterion_id), original.payload.report.acceptance_results.map(result => result.criterion_id));
  assert.deepEqual(projected.payload.report.remaining_issues, original.payload.report.remaining_issues);
});

test('legacy reports retain their evidence and non-review events pass through unchanged', () => {
  const original = event();
  delete original.payload.report.acceptance_results;
  assert.deepEqual(compactReviewEvent(original, '/state.json').payload.report.acceptance_evidence, original.payload.report.acceptance_evidence);
  for (const kind of ['decision_required', 'user_input_required', 'execution_failed', 'limit_reached', 'paused', 'cancelled', 'exploration_completed']) {
    const other = { ...original, kind };
    assert.equal(compactReviewEvent(other, '/state.json'), other);
  }
});
