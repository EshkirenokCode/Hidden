const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'darwin') throw Error('Supply your own question.wav and statement.wav fixtures; automatic speech generation currently uses macOS say.');
fs.mkdirSync('artifacts', { recursive: true });
for (const [name, text] of Object.entries({ question: 'What is a database index, and when should we use it?', statement: 'I have five years of experience working with PostgreSQL databases.' })) {
  execFileSync('say', ['-v', 'Samantha', '-r', '145', '-o', `artifacts/${name}.aiff`, text]);
  fs.rmSync(`artifacts/${name}.wav`, { force: true });
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', `artifacts/${name}.aiff`, `artifacts/${name}.wav`]);
}
console.log('Created known question and non-question audio fixtures.');
