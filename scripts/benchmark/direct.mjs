// Instructions and review evidence for the baseline with no Specship integration.
export function directPrompt(problem, ship) {
  const invocation = ['opencode', 'run', '--format', 'json', '--model', ship.model,
    ...(ship.effort ? ['--variant', ship.effort] : [])].map(value => `'${value.replaceAll("'", "'\\''")}'`).join(' ');
  return `${problem}

Supervise OpenCode directly through the shell to implement this request in /testbed.
Launch the worker with ${invocation} followed by your assignment. For corrections,
continue the same worker using --session SESSION_ID. You may consult opencode --help.
Use the configured model and reasoning variant for every worker call.
Send a compact assignment promptly; OpenCode owns repository investigation, coding,
debugging, and relevant existing tests. Tell it not to delegate, search for upstream
fixes, access benchmark solutions, ask for human input, or commit changes.
Wait for the worker, review its report and an actual targeted diff against the
original request, and request corrections for concrete defects or missing evidence.
Do not routinely repeat its research or tests. Do not implement the fix yourself.
Do not use Specship, its skills, adapters, MCP tools, or runtime. Do not use other agents.
Do not commit changes. If blocked, stop and explain the unresolved issue.
Stop on authentication, unavailable-model, or credit errors; do not retry or switch providers.
Finish your final response with exactly one review verdict on its own line:
BENCHMARK_REVIEW: ACCEPTED
or
BENCHMARK_REVIEW: BLOCKED
Use ACCEPTED only after reviewing the completed implementation and validation.
`;
}

export function directAcceptance(events) {
  const messages = events.filter(event => event.type === 'item.completed' && event.item?.type === 'agent_message');
  const final = messages.at(-1)?.item.text?.trim();
  if (typeof final !== 'string') return null;
  if (/(?:^|\n)BENCHMARK_REVIEW: ACCEPTED$/.test(final)) return true;
  if (/(?:^|\n)BENCHMARK_REVIEW: BLOCKED$/.test(final)) return false;
  return null;
}
