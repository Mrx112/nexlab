(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const iterations = 310000;
  const feedbackFormat = "nexlab-encrypted-feedback";
  const privateKeyFormat = "nexlab-encrypted-feedback-private-key";

  function toBase64(bytes) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }

  function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  async function derivePasswordKey(password, salt) {
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptPrivateKey(privateJwk, password) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await derivePasswordKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(JSON.stringify(privateJwk))
    );
    return {
      format: privateKeyFormat,
      version: 1,
      iterations,
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(new Uint8Array(ciphertext))
    };
  }

  async function generateAdminKeys(password) {
    const pair = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["encrypt", "decrypt"]
    );
    const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const privateBundle = await encryptPrivateKey(privateJwk, password);
    return { publicJwk, privateBundle };
  }

  async function unlockPrivateKey(bundle, password) {
    if (bundle.format !== privateKeyFormat || bundle.version !== 1 || bundle.iterations !== iterations) {
      throw new Error("Format kunci pribadi tidak didukung.");
    }
    const key = await derivePasswordKey(password, fromBase64(bundle.salt));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(bundle.iv) },
      key,
      fromBase64(bundle.ciphertext)
    );
    const jwk = JSON.parse(decoder.decode(plaintext));
    return crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"]
    );
  }

  async function encryptFeedback(feedback, publicJwk) {
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"]
    );
    const contentKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt"]
    );
    const iv = randomBytes(12);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      contentKey,
      encoder.encode(JSON.stringify(feedback))
    );
    const rawContentKey = await crypto.subtle.exportKey("raw", contentKey);
    const wrappedKey = await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      publicKey,
      rawContentKey
    );
    return {
      id: crypto.randomUUID(),
      iv: toBase64(iv),
      wrappedKey: toBase64(new Uint8Array(wrappedKey)),
      ciphertext: toBase64(new Uint8Array(ciphertext))
    };
  }

  async function decryptFeedback(record, privateKey) {
    const rawContentKey = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      privateKey,
      fromBase64(record.wrappedKey)
    );
    const contentKey = await crypto.subtle.importKey(
      "raw",
      rawContentKey,
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(record.iv) },
      contentKey,
      fromBase64(record.ciphertext)
    );
    return JSON.parse(decoder.decode(plaintext));
  }

  window.NexLabSupportCrypto = {
    feedbackFormat,
    generateAdminKeys,
    unlockPrivateKey,
    encryptFeedback,
    decryptFeedback
  };
})();
