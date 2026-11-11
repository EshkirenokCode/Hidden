const fs=require('node:fs');const path=require('node:path');const{execFileSync}=require('node:child_process');
function build(){
  if(process.platform!=='darwin')return;
  const out=path.resolve(__dirname,'../native/bin');fs.mkdirSync(out,{recursive:true});
  execFileSync('xcrun', ['swiftc', '-O', '-swift-version', '5', '-target',
    `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`,
    path.resolve(__dirname, '../native/ScreenText.swift'), '-o', path.join(out, 'hidden-screen-text')], { stdio: 'inherit' });
  execFileSync('xcrun',['swiftc','-O','-swift-version','5','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macosx13.0`,path.resolve(__dirname,'../native/SystemAudio.swift'),'-o',path.join(out,'hidden-system-audio')],{stdio:'inherit'});
}
if(require.main===module)build();module.exports={build};
