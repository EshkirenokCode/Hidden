const defaults = ['Go','Golang','goroutine','channel','interface','defer','Python','JavaScript','TypeScript','Java','C++','C#','.NET','Rust','PostgreSQL','MySQL','Redis','MongoDB','SQL','NoSQL','Docker','Kubernetes','Kafka','RabbitMQ','gRPC','REST','GraphQL','HTTP','TCP','UDP','DNS','Linux','Git','GitHub','CI/CD','AWS','React','Node.js','optimistic locking','pessimistic locking','deadlock','mutex','garbage collector'];
export function vocabulary(custom = '', context = '') {
  const words = custom.split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
  const fromContext = context.match(/[A-Za-z][A-Za-z0-9+#./-]{1,40}/g) || [];
  const seen = new Set();
  return [...words, ...defaults, ...fromContext].filter(x => {
    const key = x.toLowerCase(); if (x.length > 80 || seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, 100);
}
export function normalizeTerms(text) {
  const corrections = [];
  const corrected = text.replace(/(язык(?:а|е|ом)?\s+)(голл?[ао]нд(?:а|е|ом)?|голанг(?:а|е|ом)?|гоуланг)(?=$|[\s.,?!:;])/giu, (whole, prefix, term) => {
    corrections.push(`${term} → Go (Golang)`); return prefix + 'Go (Golang)';
  });
  return { text: corrected, corrections };
}
// Fast path handles explicit questions/requests without another model round trip.
export class QuestionTurns {
  constructor() { this.pending = ''; this.last = ''; this.lastAt = 0; }
  accept(raw, now = Date.now()) {
    let normalized = normalizeTerms(raw.trim());
    if (!normalized.text) return { question: '', ...normalized };
    if (now - this.lastAt > 20000) this.pending = '';
    this.lastAt = now;
    normalized = normalizeTerms((this.pending + ' ' + raw.trim()).trim().slice(-3000));
    const text = normalized.text;
    const explicit = /\?|(?:^|[.!:]\s*)(?:what|why|how|when|where|explain|describe|compare|tell me|write|solve|can you|could you|have you|do you|are you)\b/iu.test(text);
    const russian = /(?:^|[.!:]\s*)(?:(?:а|ну|тогда)\s+)?(?:что|как|чем|почему|зачем|какие|какой|какая|какое|каких|какими|каковы|когда|где|сколько|особенности|разница)(?=$|[^\p{L}])|(?:^|[^\p{L}])(?:расскажите|расскажи|объясните|объясни|сравните|сравни|назовите|опишите|решите|напишите|покажите)(?=$|[^\p{L}])/iu.test(text);
    const unfinished = /(?:^|[^\p{L}])(?:об|о|про|в|на|и|языка|языке|такое|такой|отличается|отличаются|между|особенностях|особенности|about|between|what is|how to)[\s.,]*$/iu.test(text);
    if ((!explicit && !russian) || unfinished || text.length < 8) { this.pending = explicit || russian ? text : ''; return { ...normalized, question: '' }; }
    this.pending = '';
    const key = text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (key === this.last && now - (this.answeredAt || 0) < 10000) return { ...normalized, question: '' };
    this.last = key; this.answeredAt = now;
    return { ...normalized, question: text };
  }
}

// Streaming resampling retains the fractional position across arbitrary input packets.
export class PcmPackets {
  constructor(rate, emit) { this.rate = rate; this.emit = emit; this.pending = []; this.position = 0; this.packet = []; }
  push(frame) {
    for (const value of frame) this.pending.push(value);
    const step = this.rate / 16000;
    while (this.position + 1 < this.pending.length) {
      const index = Math.floor(this.position), fraction = this.position - index;
      const sample = this.pending[index] * (1 - fraction) + this.pending[index + 1] * fraction;
      this.packet.push(Math.max(-1, Math.min(1, sample))); this.position += step;
      if (this.packet.length === 1600) { this.output(this.packet); this.packet = []; }
    }
    const consumed = Math.min(Math.floor(this.position), Math.max(0, this.pending.length - 1)); this.pending.splice(0, consumed); this.position -= consumed;
  }
  output(samples) { const data = new ArrayBuffer(samples.length * 2), view = new DataView(data); samples.forEach((x,i) => view.setInt16(i*2, x < 0 ? x*32768 : x*32767, true)); this.emit(data); }
  flush() { if (this.packet.length) { this.output(this.packet); this.packet = []; } }
}
