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

No real API latency or speech accuracy is established by the mocked tests. Initial development had no GEMINI_API_KEY; no historical chat key was reused. Subsequent real acceptance used the key entered by the user in the installed app, without reading or exporting it. Live traffic may incur different costs/quotas from the existing text model.

## Real installed-app acceptance, 4 November 2026

The user renewed the existing macOS screen/system-audio permission and entered a key in Hidden 0.5. The audio-only local monitor received an OS test sound. The Live availability probe succeeded in 2.08 seconds without sending audio.

Russian synthetic questions were generated locally with the installed Milena TTS voice, played through afplay, captured by the real ScreenCaptureKit helper, streamed to the actual Transcribe Live service and answered by the actual `gemini-3.5-flash-lite` endpoint. These were not mocked API requests. No background speech appeared in the observed transcripts.

The initial Go transcription was correct (“Golang”) and arrived approximately 1.49 seconds after the locally detected end of speech, but the text model exceeded the eight-second first-text deadline. A subsequent explicit manual request for the same question took 11.72 seconds to first text and 12.48 seconds to complete. The reason for this outlier is not established; it must not be presented as proven server cold-start behavior.

The next voice questions completed successfully:

| Question | Final transcript after speech | First answer text after speech | Complete answer after speech |
| --- | ---: | ---: | ---: |
| What is DNS and what is it for? (Russian) | 1.01 s | 2.27 s | 2.93 s |
| TCP versus UDP (Russian) | 1.15 s | 2.82 s | 3.34 s |
| Features of Golang, repeated (Russian) | 1.97 s | 3.34 s | 4.47 s |

All three transcripts matched the intended questions and produced relevant technical answers. The Go question was recognized directly as Golang; the local typo replacement was not needed in these real samples. The earlier refusal based on absent resume context did not recur. The first-response latency from the text API itself was 1.25, 1.67 and 1.37 seconds respectively on those successful voice turns.

These are three clear synthetic-speech samples on one machine and connection, not a latency distribution, a human-microphone accuracy benchmark or proof of reliable performance under noise. The initial timeout remains a material limitation. Capture was stopped after testing, Stop became disabled, and no native audio helper process remained. The app and in-memory key were left available; no key was logged or committed.

## Sources

[Google Live transcription documentation](https://aistudio.google.com/docs/live-api/live-transcribe) specifies the dedicated model, WebSocket setup, PCM input, interim/final text, vocabulary biasing, language hints and hybrid end-of-stream behavior.

The release is a local ad-hoc macOS build. It is not notarized or signed with a distribution identity; changing the build can require renewing the existing screen/audio permission. Screen-capture invisibility limitations from prior releases remain unchanged.
