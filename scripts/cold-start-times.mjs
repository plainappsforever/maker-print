// Reads a Maestro log of .maestro/release/cold-start.yaml and prints, per cold start, the milliseconds from the start of
// "Launch app" to the end of "Assert that id: projects-screen is visible", then the median. Usage: node scripts/cold-start-times.mjs <maestro.log>
import { readFileSync } from 'node:fs';
const lines = readFileSync(process.argv[2], 'utf8').split('\n');
const ts = (l) => { const m = l.match(/^(\d\d):(\d\d):(\d\d)\.(\d\d\d)/); return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] : null; };
const times = [];
let start = null;
for (const l of lines) {
  if (/Launch app "\$\{APP_ID\}" RUNNING|Launch app .* RUNNING/.test(l)) start = ts(l);
  if (start !== null && /Assert that id: projects-screen is visible COMPLETED/.test(l)) { times.push(ts(l) - start); start = null; }
}
times.forEach((t, i) => console.log(`start ${i + 1}: ${t} ms`));
const s = [...times].sort((a, b) => a - b);
console.log(`n=${s.length} median ${s[Math.floor(s.length / 2)]} ms, min ${s[0]} ms, max ${s[s.length - 1]} ms`);
