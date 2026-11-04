# Hidden 0.4: audio and overlay validation

Local acceptance on macOS 26.6.2, Apple Silicon, 4 November 2026.

## System audio

Fixed the application permission handler rejecting Chromium's separate `display-capture` request even when macOS permission was enabled. Permission checks remain limited to an armed session in the trusted main document; webcam access is rejected.

Chromium still returned an absent/ended audio track on this machine. Added a bundled Swift ScreenCaptureKit helper. It registers only an audio output, streams PCM to the parent over stdout, and writes no recordings. Stop, hide-and-stop, window closure and app exit terminate the helper. An unexpected parent exit also terminates it.

The first helper failed because the AudioBufferList allocation was too small (-12737). It now queries the required size before allocating the list, retains the CoreMedia block while reading it, and downmixes 48 kHz Float32 audio to mono. Unsupported formats and buffer errors are surfaced rather than silently ignored.

With user approval, removed obsolete Hidden screen-permission entries, reset only Hidden's ScreenCapture/AudioCapture decisions, and added the final signed app to the upper Screen & System Audio Recording category. macOS would not simultaneously add this identity to the audio-only category. Other apps' permissions were unchanged.

Installed the final app in `/Users/ilya/Applications/Hidden.app` outside iCloud Documents. Its ad-hoc signature passed `codesign --verify --deep --strict`. This is a local development signature, not Developer ID or notarization; rebuilding can require renewing permission.

Actual UI test: System audio → Check sound started successfully. The level meter was nonzero and the UI displayed “Звук получен ✓ · локальная проверка, без отправки в API.” A synthetic local tone was played with afplay; capture remained active and received samples. The session was then stopped, Stop became disabled, and no `hidden-system-audio` process remained. No Gemini/API request was made during these checks. This validates local acquisition, not transcription accuracy or a long Zoom/Meet session.

## Compact overlay

The BrowserWindow is transparent and frameless. Background alpha is adjustable from 15–85%; text opacity stays at 1. The panel grows and shrinks with content. When an answer exceeds the display work area, the answer scrolls while controls remain visible. The header is draggable. Click-through has a registered shortcut guard and is reset when the app is activated or shown again.

Electron smoke checks verify actual window growth, shrink after a long answer, no medium-answer clipping, long-answer scrollability, translucent rendered pixel alpha, opaque text CSS, source controls, local audio monitoring, session stop and emergency hide. Unit checks verify display bounds including negative coordinates, media policy, and native process termination/error delivery. All 17 unit tests and the Electron smoke test passed.

The installed UI was left open in compact mode with a prepared example, sound stopped and click-through disabled. The click-through state toggled through the UI; synthetic Cmd+Shift+M input did not visibly toggle it in CUA, so a real keyboard check remains necessary.

Content protection remains best-effort on macOS; this change does not establish universal invisibility in Zoom, Chrome, Meet or Teams.
