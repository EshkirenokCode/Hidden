export function captureError(error, kind, diagnostics = {}) {
  if (diagnostics.applicationDenial) return diagnostics.applicationDenial;
  if (error.name === 'InvalidStateError') return 'Окно Hidden должно быть активным при выборе источника. Вернитесь в Hidden и запустите захват ещё раз.';
  if (error.name === 'NotAllowedError') {
    if (kind === 'system') return diagnostics.screen === 'granted'
      ? 'Доступ к экрану macOS уже выдан. Выбор источника мог быть отменён или не разрешён системный звук. Выберите источник в системном диалоге, включите передачу аудио и перезапустите Hidden после изменения разрешений.'
      : 'Захват экрана не разрешён или выбор источника отменён. Проверьте доступ к записи экрана и системного звука именно для Hidden и перезапустите приложение после изменения разрешений.';
    return 'Микрофон не разрешён или запрос отменён. Проверьте доступ к микрофону для Hidden.';
  }
  return error.message || 'Не удалось запустить источник звука.';
}
