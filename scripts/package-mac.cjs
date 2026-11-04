const path = require('node:path');
(async () => {
  if (process.platform !== 'darwin') throw Error('Run the macOS packaging command on a Mac.');
  const { packager } = await import('@electron/packager');
  const outputs = await packager({
    dir: path.resolve(__dirname, '..'), name: 'Hidden', executableName: 'Hidden',
    appBundleId: 'com.eshkirenok.hidden', platform: 'darwin', arch: process.arch,
    out: path.resolve(__dirname, '../dist'), overwrite: true, asar: true, prune: true,
    ignore: [/^\/(artifacts|dist|docs|tools|test|scripts|\.git)(\/|$)/, /^\/\.env(?:\.|$)/, /\.(key|pem|p12)$/],
    usageDescription: {
      Microphone: 'Hidden uses the microphone only when you start an audio session.',
      AudioCapture: 'Hidden uses system audio only when you select it and start a session.'
    }
  });
  for (const output of outputs) console.log(path.join(output, 'Hidden.app'));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
