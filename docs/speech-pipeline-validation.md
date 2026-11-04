# Hidden 0.5: streaming speech pipeline

## Problem and changes

The installed 0.4.1 UI confirmed the reported 30.62-second response to a misrecognized Go question, followed by an audio queue overflow. The previous path serialized transcription and a full structured question/answer request, and rendered the audio answer only after both finished.

The new default path streams 16 kHz mono PCM to Gemini Transcribe Live over a main-process WebSocket. Interim text is shown without starting an answer. Final text passes through a local question/imperative detector, conservative term normalization, incomplete-turn assembly and short duplicate suppression. An identified question starts a separate streaming text request. General technical answers use model knowledge even without resume context; personal experience must still come from candidate context.

An unavailable Live connection in automatic mode visibly falls back to the selected Gemini model for short audio transcription requests, with vocabulary hints. Answer generation runs separately from the transcription queue. At most one phrase waits; a newer phrase replaces it with a message, and a waiting phrase older than eight seconds is discarded. This bounds lag but can lose a waiting phrase under sustained overload; it is not lossless meeting recording.

New questions supersede unfinished voice answers. Request IDs, session epochs and controller ownership prevent late responses from replacing a newer answer or deleting its controller. Browsing old answers and editing a manual draft remain supported.

The dictionary combines user terms, built-in programming terms and context words (100 terms maximum). The narrow Go correction applies to forms such as “языка Голанд”; it does not rewrite “голландский язык”. It does not solve every recognition ambiguity. Local detection can miss implicit requests; it is deliberately not a claim of perfect semantic question recognition.

Client VAD now keeps approximately 300 ms of prefix audio independent of packet size, uses a bounded adaptive level threshold, and finalizes after 650 ms of silence. Native 48 kHz audio is converted to 16 kHz PCM with persistent resampling state; packets contain 100 ms. The local end-of-speech estimate powers approximate latency displays. The resampler uses linear interpolation, not a studio-quality anti-aliasing filter.

Timeouts bound Live startup (8 s), fallback transcription (12 s), first response text (8 s), and whole voice answer (20 s). They do not guarantee that useful output arrives within those limits. Network/model errors are surfaced without automatic request retry loops.

## Validation

27 unit tests passed. Added coverage includes vocabulary priority/bounds, scoped Go correction, Dutch negative cases, incomplete questions across clips, duplicate suppression, ordinary statement rejection, packet-boundary-invariant PCM conversion, clipping/duration, native-size-independent VAD prefix, WebSocket setup/interim/final/end-turn, intentional shutdown, backpressure, error sanitization and cancellation before connection setup. Provider tests verify dictionary hints and the technical-knowledge instruction.

The actual Electron smoke test passed with a fake Chromium microphone, synthetic PCM injected into the shared frame consumer for the fallback VAD check, and deterministic HTTP/WebSocket transports. It exercises:

- Live setup → PCM → interim text → final text → Go correction → streamed answer visible before completion;
- local timing fields and completed answers in conversation context;
- explicit fallback after a denied Live connection, including fallback audio transcription and its answer;
- supersession of a still-running answer, emergency stop during a request, and key deletion stopping a session;
- existing isolation, draft/history handling, image input, transparent adaptive overlay and control checks.

No real API latency or speech accuracy is established by those tests. Gemini Transcribe Live availability and quota must be tested with the user's key; the development environment has no GEMINI_API_KEY. No historical chat key is reused. Live traffic may incur different costs/quotas from the existing text model.

## Sources

[Google Live transcription documentation](https://aistudio.google.com/docs/live-api/live-transcribe) specifies the dedicated model, WebSocket setup, PCM input, interim/final text, vocabulary biasing, language hints and hybrid end-of-stream behavior.

The release is a local ad-hoc macOS build. It is not notarized or signed with a distribution identity; changing the build can require renewing the existing screen/audio permission. Screen-capture invisibility limitations from prior releases remain unchanged.
