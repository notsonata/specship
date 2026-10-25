// Fail closed on errors that another paid attempt cannot repair.
export function nonretryableProviderFailure(evidence) {
  const text = typeof evidence === 'string' ? evidence : JSON.stringify(evidence);
  return /api_key_expired|invalid_api_key|incorrect api key|authentication[_ ](?:error|failed)|unauthorized|insufficient[_ ](?:quota|balance|credits)|credit balance|payment required|provider(?:model)?notfound|model unavailable|variant .+ unavailable|(?:HTTP|status(?:Code)?["']?\s*[:=]?)\s*(?:401|402|403)\b/i.test(text ?? '');
}

export function orderedArms(arms, caseIndex, repeat, shipFirst = false) {
  const rotation = (caseIndex + repeat) % arms.length;
  const order = [...arms.slice(rotation), ...arms.slice(0, rotation)];
  if (shipFirst && caseIndex === 0 && repeat === 0 && order.includes('ship')) return ['ship', ...order.filter(arm => arm !== 'ship')];
  return order;
}
