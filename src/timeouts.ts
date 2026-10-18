// MCP clients still have transport timeouts. Keep their timers within Node's
// signed 32-bit timer range; this is not a runner assignment deadline.
export const LONG_TOOL_TIMEOUT_SECONDS = 2_147_483;
export const LONG_TOOL_TIMEOUT_MS = LONG_TOOL_TIMEOUT_SECONDS * 1_000;
export const DEFAULT_DELIVERY_MARGIN_SECONDS = 120;

export function callbackTimeoutMs(deadline: number | null | undefined, marginMs: number): number | undefined {
  return deadline == null ? undefined : Math.max(1, Math.min(LONG_TOOL_TIMEOUT_MS, deadline - Date.now() + marginMs));
}

export function toolTimeoutSeconds(maxSeconds: number | null | undefined, marginSeconds: number): number {
  return maxSeconds == null ? LONG_TOOL_TIMEOUT_SECONDS : Math.min(LONG_TOOL_TIMEOUT_SECONDS, maxSeconds + marginSeconds);
}
