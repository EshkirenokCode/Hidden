const MODEL = 'gemini-3.5-transcribe-live';
// The connection and credential stay in the main process, never in the renderer.
class LiveTranscriber {
  constructor(onEvent, socketFactory = url => new WebSocket(url)) {
    this.onEvent = onEvent; this.factory = socketFactory; this.socket = null; this.ready = false;
  }
  start(key, vocabulary = []) {
    this.stop();
    if (!key) return Promise.reject(Error('Добавьте ключ Gemini.'));
    return new Promise((resolve, reject) => {
      let settled = false, intentional = false;
      const socket = this.factory('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(key));
      socket.binaryType = 'arraybuffer';
      this.socket = socket;
      const finish = message => {
        if (this.socket !== socket || intentional) return;
        intentional = true; clearTimeout(timer); this.socket = null; this.ready = false;
        try { socket.close(); } catch {}
        if (!settled) { settled = true; reject(Error(message)); }
        else this.onEvent({ type: 'error', message });
      };
      const timer = setTimeout(() => finish('Live не подключился за 8 секунд. Проверьте доступ к модели и сеть.'), 8000);
      this.cancelPending = () => { intentional = true; clearTimeout(timer); if (!settled) { settled = true; reject(Error('Подключение остановлено.')); } };
      socket.addEventListener('open', () => {
        if (this.socket !== socket) return;
        socket.send(JSON.stringify({ setup: { model: 'models/' + MODEL,
          generationConfig: { responseModalities: ['TEXT'] },
          inputAudioTranscription: { languageCodes: ['ru-RU', 'en-US'], customVocabulary: vocabulary.slice(0, 100), mode: 'SMART' }
        } }));
      });
      socket.addEventListener('message', event => {
        if (this.socket !== socket) return;
        try {
          const data = event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : event.data;
          if (typeof data !== 'string' || data.length > 1000000) throw Error();
          const value = JSON.parse(data);
          if (value.error) {
            const code = Number(value.error.code);
            return finish(code === 429 ? 'Live: квота исчерпана. Проверьте лимиты проекта.' : code === 403 || code === 401 ? 'Live: нет доступа к модели. Проверьте ключ и проект.' : 'Live отклонил подключение или параметры. Можно выбрать режим «По фразам».');
          }
          if (value.setupComplete) { clearTimeout(timer); this.ready = true; if (!settled) { settled = true; resolve({ model: MODEL }); } }
          const content = value.serverContent;
          const interim = content?.interimInputTranscription?.text;
          const final = content?.inputTranscription?.text;
          if (typeof interim === 'string' && interim.trim()) this.onEvent({ type: 'interim', text: interim.slice(0, 12000) });
          if (typeof final === 'string' && final.trim()) this.onEvent({ type: 'final', text: final.slice(0, 12000) });
          if (value.goAway) finish('Live завершает сессию. Остановите и запустите слушание снова.');
        } catch { finish('Не удалось прочитать ответ Live. Перезапустите слушание.'); }
      });
      socket.addEventListener('error', () => finish('Ошибка соединения Live. Проверьте сеть и доступ к модели.'));
      socket.addEventListener('close', () => finish('Соединение Live закрыто. Перезапустите слушание.'));
    });
  }
  send(data) {
    if (!this.ready || !this.socket) return false;
    if (this.socket.bufferedAmount > 128000) { this.onEvent({ type: 'error', message: 'Live не успевает отправлять звук. Сессия остановлена; проверьте сеть.' }); this.stop(); return false; }
    this.socket.send(JSON.stringify({ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } }));
    return true;
  }
  endTurn() { if (this.ready) this.socket?.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } })); }
  stop() { this.cancelPending?.(); this.cancelPending = null; const socket = this.socket; this.socket = null; this.ready = false; try { socket?.close(); } catch {} }
}
module.exports = { LiveTranscriber, MODEL };
