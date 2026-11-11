const { execFile } = require('node:child_process');

const maxScreenText = 30000;
function recognizeScreenText(binary, png) {
  return new Promise((resolve, reject) => {
    const child = execFile(binary, { timeout: 12000, maxBuffer: 256 * 1024 }, (error, stdout) => {
      if (error) return reject(Error('Не удалось распознать текст на снимке. Повторите захват или выберите модель для изображений.'));
      const text = stdout.trim();
      if (!text) return reject(Error('На снимке не найден текст. Увеличьте масштаб окна или выберите модель для изображений.'));
      if (text.length > maxScreenText) return reject(Error('На снимке слишком много текста. Выберите окно с нужной задачей.'));
      resolve(text);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(png);
  });
}

module.exports = { maxScreenText, recognizeScreenText };
