const { execFile } = require('node:child_process');

const maxScreenText = 30000;
function runOCR(binary, png, args = []) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout: 12000, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(png);
  });
}

async function recognizeScreenText(binary, png) {
  let text;
  try {
    text = await runOCR(binary, png);
  } catch (error) {
    // An abnormal Vision exit must not force the user to capture the window again.
    if (!error.signal && error.code !== 1) throw recognitionError();
    try { text = await runOCR(binary, png, ['--whole-image']); }
    catch { throw recognitionError(); }
  }
  if (!text) throw Error('На снимке не найден текст. Увеличьте масштаб окна или выберите модель для изображений.');
  if (text.length > maxScreenText) throw Error('На снимке слишком много текста. Выберите окно с нужной задачей.');
  return text;
}

function recognitionError() {
  return Error('Не удалось распознать текст на снимке. Повторите захват или выберите модель для изображений.');
}

module.exports = { maxScreenText, recognizeScreenText };
