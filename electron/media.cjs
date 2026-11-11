function media(value, kind) {
  const types = kind === 'image' ? ['image/png', 'image/jpeg'] : ['audio/wav', 'audio/webm'];
  if (!value || !types.includes(value.mimeType) || typeof value.data !== 'string' || value.data.length < 4 || value.data.length > 8_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw Error('Некорректный или слишком большой медиафайл (до 6 МБ).');
  return { type: kind, data: value.data, mime_type: value.mimeType };
}

module.exports = { media };
