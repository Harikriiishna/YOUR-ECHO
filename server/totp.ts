import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateBase32Secret(byteLength = 20): string {
  const bytes = crypto.randomBytes(byteLength);
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  if (!clean) {
    throw new Error('Empty Base32 secret.');
  }

  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error('Invalid Base32 character.');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(out);
}

export function computeHotp(secretBytes: Buffer, counter: number): string {
  const counterBuf = Buffer.alloc(8);
  const bigCounter = BigInt(counter);
  counterBuf.writeBigUInt64BE(bigCounter, 0);

  const hmac = crypto.createHmac('sha1', secretBytes).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(
  secretBase32: string,
  codeInput: string,
  options: {
    adjacentIntervals?: number;
    lastAcceptedStep?: number | null;
    nowMs?: number;
  } = {}
): { valid: boolean; matchedStep: number | null } {
  const cleanCode = codeInput.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleanCode)) {
    return { valid: false, matchedStep: null };
  }

  let secretBytes: Buffer;
  try {
    secretBytes = decodeBase32(secretBase32);
  } catch {
    return { valid: false, matchedStep: null };
  }

  const adjacent = Math.min(Math.max(Math.floor(options.adjacentIntervals ?? 2), 0), 10);
  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const currentStep = Math.floor(nowSec / 30);
  const candidateBuf = Buffer.from(cleanCode, 'utf8');

  let matchedStep: number | null = null;
  for (let offset = -adjacent; offset <= adjacent; offset += 1) {
    const step = currentStep + offset;
    if (step < 0) continue;
    const expected = computeHotp(secretBytes, step);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (
      candidateBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(candidateBuf, expectedBuf)
    ) {
      matchedStep = step;
      break;
    }
  }

  if (matchedStep === null) {
    return { valid: false, matchedStep: null };
  }

  if (
    typeof options.lastAcceptedStep === 'number' &&
    Number.isFinite(options.lastAcceptedStep) &&
    matchedStep <= options.lastAcceptedStep
  ) {
    return { valid: false, matchedStep: null };
  }

  return { valid: true, matchedStep };
}

export function buildTotpUri(params: {
  accountName: string;
  issuer?: string;
  secret: string;
}): string {
  const issuer = (params.issuer || 'ECHO').trim();
  const account = params.accountName.trim() || 'member@echo';
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const search = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${search.toString()}`;
}
