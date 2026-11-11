const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createKeyStorage(directory, safeStorage) {
  const file = provider => path.join(directory, `api-key-${provider}.enc`);
  return {
    async read(provider) {
      let encrypted;
      try {
        encrypted = await fs.readFile(file(provider));
      } catch (error) {
        if (error.code === 'ENOENT') return '';
        throw error;
      }
      const { result } = await safeStorage.decryptStringAsync(encrypted);
      if (typeof result !== 'string' || !result || result.length > 512) throw Error('Invalid saved key');
      return result;
    },
    async save(provider, key) {
      const destination = file(provider);
      if (!key) {
        await fs.rm(destination, { force: true });
        return;
      }
      if (!(await safeStorage.isAsyncEncryptionAvailable())) throw Error('Secure storage is unavailable');
      const encrypted = await safeStorage.encryptStringAsync(key);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, destination);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    }
  };
}

module.exports = { createKeyStorage };
