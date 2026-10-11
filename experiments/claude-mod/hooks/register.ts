// Claude loads this TypeScript directly; generated declarations belong to the fixture.
let records: unknown[] = [];
let count = 0;
let tools = 0;
let contextMode = false;
let generation = 0;
async function record($, data) {
  records.push({ ...data, sessionId: await $.session.id(), at: await $.clock.now() });
  await $.fs.write('mod-observations.json', JSON.stringify(records, null, 2));
}
export function register(on) {
  on('session.start', async ($, e, next) => {
    contextMode = await $.fs.exists('context-mode');
    await record($, { kind: 'owner-ready', surface: e.surface });
    if (contextMode) await record($, { kind: 'context-startup', generation, usage: await $.session.usage() });
    return next(e);
  });
  on('tool.call', async ($, e, next) => {
    tools += 1;
    await record($, { kind: 'tool', tool: e.tool });
    return next(e);
  });
  on('turn.start', async ($, e, next) => {
    tools = 0;
    await record($, { kind: 'turn-start', turnId: e.turnId, text: e.text });
    if (contextMode) await record($, { kind: 'context-invalidated', turnId: e.turnId, generation, idle: false });
    return next(e);
  });
  on('turn.complete', async ($, e, next) => {
    const result = await next(e);
    count += 1;
    await record($, { kind: 'turn-complete', turnId: e.turnId, text: e.answer, reason: e.reason, toolEvents: tools, ...(contextMode ? { generation, usage: await $.session.usage() } : {}) });
    if (contextMode && e.reason === 'answer' && count < 3) {
      $.clock.after(1500, async () => {
        try {
          if (count === 2) await $.session.compact({ instructions: 'Keep only the remembered VESTA nonce.' });
          await $.prompt.submit({ text: 'Recall the VESTA nonce. Reply with only that nonce. Do not use tools.' });
        } catch (error) { await record($, { kind: 'native-rejection', text: String(error) }); }
      });
      return result;
    }
    if (contextMode) return result;
    if (count === 1 && e.reason === 'answer') {
      $.clock.after(1500, async () => {
        await record($, { kind: 'timer-fired' });
        try {
          await record($, { kind: 'keepalive-submitted' });
          await $.prompt.submit({ text: 'Reply with exactly K. Do not use tools.' });
        } catch (error) {
          await record($, { kind: 'native-rejection', text: String(error) });
        }
      });
    }
    return result;
  });
  on('session.compact', async ($, e, next) => {
    if (!contextMode) return next(e);
    generation += 1;
    await record($, { kind: 'compact-start', generation, trigger: e.trigger, usage: await $.session.usage() });
    const result = await next(e);
    await record($, { kind: 'compact-complete', generation, result, usage: await $.session.usage() });
    return result;
  });
}
