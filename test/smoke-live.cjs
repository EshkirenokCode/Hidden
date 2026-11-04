// Deterministic socket transport; production uses the native WebSocket in main.
module.exports = () => {
  const socket = new EventTarget(); socket.bufferedAmount = 0; let closed = false, sent = false;
  const deliver = value => { if (!closed) socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); };
  socket.send = data => {
    const value = JSON.parse(data);
    if (value.setup) queueMicrotask(() => deliver(value.setup.inputAudioTranscription.customVocabulary.includes('DENY_LIVE_TEST') ? { error: { code: 403 } } : { setupComplete: {} }));
    if (value.realtimeInput?.audio && !sent) {
      sent = true;
      deliver({ serverContent: { interimInputTranscription: { text: 'Расскажите об особенностях языка' } } });
      setTimeout(() => deliver({ serverContent: { inputTranscription: { text: 'Расскажите об особенностях языка Голанд?' } } }), 30);
    }
  };
  socket.close = () => { closed = true; socket.dispatchEvent(new Event('close')); };
  queueMicrotask(() => socket.dispatchEvent(new Event('open'))); return socket;
};
