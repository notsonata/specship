// Gate fixture only. Forward an Interrupt to a local marker without model work.
import { writeFileSync } from 'node:fs';

const destination = process.argv[2];
if (!destination) throw new Error('Expected a test marker path');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 64_000) throw new Error('Unexpected hook payload size');
}
const event = JSON.parse(input);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (event.hook_event_name !== 'Interrupt' || !uuid.test(event.session_id) || !uuid.test(event.turn_id)) {
  throw new Error('Expected an Interrupt with exact session and turn identities');
}
// The fixture's reader tolerates a partial marker; this is not durable runner state.
writeFileSync(destination, JSON.stringify({
  session_id: event.session_id, turn_id: event.turn_id, at: new Date().toISOString(),
}));
