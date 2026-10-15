// Classify stdin without changing the bytes forwarded to the native terminal.
const readingMouse = (body: string) => {
  const match = /^<(\d+);(\d+);(\d+)M$/.exec(body);
  if (!match) return false;
  const [button, column, row] = match.slice(1).map(Number);
  return Number.isSafeInteger(button) && button! >= 0 && button! <= 127
    && [35, 64, 65].includes(button! & ~28)
    && [column, row].every(value => Number.isSafeInteger(value) && value! > 0 && value! <= 65535);
};
export class TerminalInput {
  private sequence = '';
  private since = 0;
  get pending() { return this.sequence.length > 0; }
  get deadline() { return this.since + 250; }
  expire(at: number) {
    if (!this.pending || at - this.since < 250) return false;
    this.sequence = ''; return true;
  }
  feed(data: Buffer, at: number) {
    let unknown = this.expire(at); let keyboard = false; let text = '';
    const user = (value: string) => { keyboard = true; text += value; };
    for (const byte of data) {
      const char = String.fromCharCode(byte);
      if (!this.pending) {
        if (byte === 27) { this.sequence = char; this.since = at; }
        else user(char);
        continue;
      }
      this.sequence += char;
      const sequence = this.sequence;
      if (sequence.length > 1024) { unknown = true; this.sequence = ''; continue; }
      if (sequence.length === 2) {
        if (char === '[' || char === ']') continue;
        if (byte === 27) { unknown = true; this.sequence = char; this.since = at; }
        else { user(sequence); this.sequence = ''; }
        continue;
      }
      if (sequence[1] === '[') {
        if (byte >= 0x40 && byte <= 0x7e) {
          const body = sequence.slice(2);
          if (!/^(?:[IO]|[?>]?[0-9;]*[Rc]|\?[0-9;]*u)$/.test(body) && !readingMouse(body)) {
            if (/^(?:[0-9;]*[ABCDHF~]|[0-9:;]+u|<[0-9;]+[Mm])$/.test(body)) user(sequence);
            else unknown = true;
          }
          this.sequence = '';
        } else if (byte < 0x20 || byte > 0x3f) {
          unknown = true; this.sequence = byte === 27 ? char : ''; if (byte === 27) this.since = at;
        }
      } else {
        if (byte === 7 || sequence.endsWith('\x1b\\')) {
          if (!/^\x1b\](?:10|11);rgb:[0-9a-fA-F]+\/[0-9a-fA-F]+\/[0-9a-fA-F]+(?:\x07|\x1b\\)$/.test(sequence)) unknown = true;
          this.sequence = '';
        } else if (byte < 0x20 && byte !== 27 || byte > 0x7e || sequence.slice(0, -1).endsWith('\x1b') && char !== '\\') {
          unknown = true; this.sequence = byte === 27 ? char : ''; if (byte === 27) this.since = at;
        }
      }
    }
    return { keyboard, unknown, text };
  }
}
