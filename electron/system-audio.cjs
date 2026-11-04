const {spawn}=require('node:child_process');
class SystemAudio {
  constructor(binary,onPcm,onError,spawnImpl=spawn){this.binary=binary;this.onPcm=onPcm;this.onError=onError;this.spawn=spawnImpl;this.child=null;}
  start(){
    if(this.child)throw Error('Захват системного звука уже запущен.');
    return new Promise((resolve,reject)=>{
      let pending='',ready=false,finished=false;
      const child=this.spawn(this.binary,[],{stdio:['ignore','pipe','pipe']});this.child=child;
      const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);if(this.child===child)this.child=null;if(!ready)reject(error);else if(!child.hiddenIntentionalStop)this.onError(error.message);};
      const timer=setTimeout(()=>{finish(Error('ScreenCaptureKit не запустился. Проверьте доступ к записи экрана для Hidden.'));child.kill('SIGTERM');},15000);
      child.stdout.setEncoding('utf8');child.stderr.resume();
      child.stdout.on('data',chunk=>{
        if(finished || child.hiddenIntentionalStop)return;
        pending+=chunk;
        if(pending.length>1000000){finish(Error('Некорректный поток системного звука.'));child.kill();return;}
        let end;
        while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(!line)continue;
          try{const value=JSON.parse(line);
            if(value.type==='ready'){ready=true;clearTimeout(timer);resolve({backend:'ScreenCaptureKit'});}
            else if(value.type==='diagnostic')this.onPcm({diagnostic:String(value.message).slice(0,200)});
            else if(value.type==='pcm'&&Number.isFinite(value.sampleRate)&&value.sampleRate>=8000&&value.sampleRate<=192000&&typeof value.data==='string'&&value.data.length<300000)this.onPcm(value);
            else if(value.type==='error'){finish(Error('ScreenCaptureKit: '+value.message));child.kill('SIGTERM');}
          }catch{finish(Error('Не удалось прочитать поток системного звука.'));child.kill();}
        }
      });
      child.on('error',()=>finish(Error('Не удалось запустить модуль системного звука. Пересоберите Hidden.app.')));
      child.on('exit',()=>finish(Error(child.hiddenIntentionalStop?'Захват остановлен.':'Модуль системного звука завершился.')));
    });
  }
  stop(){if(this.child){const child=this.child;this.child=null;child.hiddenIntentionalStop=true;child.kill('SIGTERM');}}
}
module.exports={SystemAudio};
