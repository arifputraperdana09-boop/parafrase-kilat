// Penyimpanan pengaturan web (saklar pembayaran) di Upstash Redis lewat REST API.
// Di Vercel: Storage -> Upstash (Redis) -> Connect, maka variabel
// KV_REST_API_URL / KV_REST_API_TOKEN (atau UPSTASH_REDIS_REST_URL / _TOKEN) terisi otomatis.
const crypto = require('crypto');

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const KEY = 'parafrase:payment';

const hasStore = () => !!(URL_ && TOKEN);

// Nilai awal bila belum pernah diatur dari halaman admin: PAYMENT_ENABLED (default "on").
function defaultPayment() {
  return !/^(off|0|false|no|tidak)$/i.test(String(process.env.PAYMENT_ENABLED || 'on').trim());
}

async function redis(cmd) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(URL_, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
      signal: ac.signal
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || 'Redis error ' + r.status);
    return j.result;
  } finally {
    clearTimeout(to);
  }
}

// true = pembayaran aktif (kode akses wajib), false = gratis.
async function getPayment() {
  if (!hasStore()) return defaultPayment();
  try {
    const v = await redis(['GET', KEY]);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch (e) { /* penyimpanan bermasalah: pakai nilai awal */ }
  return defaultPayment();
}

async function setPayment(on) {
  await redis(['SET', KEY, on ? 'on' : 'off']);
  return on;
}

function checkAdmin(given) {
  const need = process.env.ADMIN_PASSWORD || '';
  if (!need || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(need).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { getPayment, setPayment, hasStore, checkAdmin };
