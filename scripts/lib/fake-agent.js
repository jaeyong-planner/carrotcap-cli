// Stand-in for an interactive agent CLI in tests: turns on bracketed paste like
// Claude Code does, and appends every byte it receives to the file in argv[2].
// Receiving "QUIT" turns bracketed paste off and exits (back to the shell).
const fs = require('fs');
const out = process.argv[2];
process.stdout.write('\x1b[?2004h');
process.stdout.write('fake-agent ready> ');
if (process.stdin.setRawMode) process.stdin.setRawMode(true);
process.stdin.on('data', (d) => {
  fs.appendFileSync(out, d);
  process.stdout.write(`[got ${d.length}]`);
  if (d.toString().includes('QUIT')) {
    process.stdout.write('\x1b[?2004l\r\nfake-agent bye\r\n');
    process.exit(0);
  }
});
setTimeout(() => process.exit(0), 120000);
