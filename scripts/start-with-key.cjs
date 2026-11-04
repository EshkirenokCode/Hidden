// One-time local launch: read a temporary key file, delete it, inherit key in memory.
const fs=require('node:fs');const {spawn}=require('node:child_process');
const keyFile=process.argv[2];
const key=fs.readFileSync(keyFile,'utf8').trim();fs.unlinkSync(keyFile);
const child=spawn(require('electron'),['.'],{cwd:require('node:path').resolve(__dirname,'..'),env:{...process.env,GEMINI_API_KEY:key},stdio:'inherit'});
child.on('exit',code=>process.exit(code||0));
