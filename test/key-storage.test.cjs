const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createKeyStorage } = require('../electron/key-storage.cjs');

test('keys survive a storage restart independently and can be removed', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'hidden-key-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const ciphertext = Buffer.from([32, 67, 145, 0]);
  const safeStorage = {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async key => {
      assert.equal(key, 'test-key');
      return ciphertext;
    },
    decryptStringAsync: async encrypted => {
      assert.deepEqual(encrypted, ciphertext);
      return { result: 'test-key' };
    }
  };

  await createKeyStorage(directory, safeStorage).save('groq', 'test-key');
  const restored = createKeyStorage(directory, safeStorage);
  assert.deepEqual(await fs.readFile(path.join(directory, 'api-key-groq.enc')), ciphertext);
  assert.equal(await restored.read('groq'), 'test-key');
  assert.equal(await restored.read('gemini'), '');

  safeStorage.isAsyncEncryptionAvailable = async () => false;
  await assert.rejects(restored.save('groq', 'replacement-key'), /Secure storage is unavailable/);
  assert.equal(await restored.read('groq'), 'test-key');
  await restored.save('groq', '');
  assert.equal(await createKeyStorage(directory, safeStorage).read('groq'), '');
});
