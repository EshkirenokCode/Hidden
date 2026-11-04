// Screen capture and microphone capture are separate Chromium permissions.
function allowMediaRequest({ trusted, mode, permission, mediaTypes = [], mainFrame = true }) {
  if (!trusted || !mainFrame || !['microphone', 'system'].includes(mode)) return false;
  if (permission === 'display-capture') return mode === 'system';
  if (permission === 'media') return mediaTypes.length > 0 && mediaTypes.every(type => type === 'audio');
  return false;
}
module.exports = { allowMediaRequest };
