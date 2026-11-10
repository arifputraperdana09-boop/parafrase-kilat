// Server kecil: menerima beberapa potongan teks sekaligus, memanggil Gemini (Google AI)
// dengan API key rahasia, lalu mengembalikan hasil parafrase per potongan.
const LEVEL = {
  ringan: 'Ganti sebagian kata dan susun ulang frasa, kerangka kalimat boleh tetap mirip.',
  sedang: 'Ubah struktur kalimat dan pilihan kata secara jelas.',
  kuat: 'Ubah total: pecah atau gabung kalimat, pindahkan klausa, balik aktif dan pasif.'
};
// Urutan model yang dicoba. Bila satu model tidak tersedia untuk akun Anda, model berikutnya dipakai.
const MODELS = [process.env.MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.0-flash']
  .filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);
const hits = new Map(); // pembatas harian per alamat IP (berlaku per instance server)

function buildPrompt(items, level, retry) {
  const data = items.map(it => ({ id: it.id, sebelum: it.before || '-', target: it.target, sesudah: it.after || '-' }));
  return `Kamu editor karya tulis ilmiah berbahasa Indonesia. Parafrasekan setiap "target" pada daftar di bawah tanpa mengubah makna, fakta, tingkat kepastian, atau nada akademiknya.
Tingkat perubahan: ${LEVEL[level]}
Aturan:
1. Token seperti [[K0]], [[K1]], dst adalah bagian terkunci (nomor standar, peraturan, pasal, sitasi, angka, kutipan, singkatan). Salin PERSIS karakter demi karakter, termasuk kurung sikunya. Jangan diterjemahkan, diberi spasi, dihapus, atau digandakan. Susun ulang kalimat di sekitarnya saja.
2. Jangan menambah atau menghilangkan informasi, data, klaim, atau opini. Jangan mengganti istilah teknis baku, nama orang, judul, nama peraturan, atau nama metode.
3. Gunakan bahasa Indonesia formal. Hindari pembuka klise seperti "Perlu diketahui bahwa" atau "Dengan demikian".
4. Panjang kira-kira sama dengan target aslinya. Hasil harus berbeda jelas dari aslinya, bukan hanya mengganti satu dua kata.
5. "target" hanya potongan teks; hasilnya harus tetap menyambung dengan teks "sebelum" dan "sesudah". Jangan menyalin teks "sebelum" atau "sesudah" ke dalam hasil.
6. Hasil berupa teks polos tanpa tanda kutip pembuka/penutup dan tanpa markdown.${retry ? '\n7. PERHATIAN: percobaan sebelumnya ditolak karena token terkunci tidak utuh atau hasil terlalu mirip aslinya. Pastikan setiap token [[Kn]] muncul tepat satu kali dan struktur kalimat benar-benar berubah.' : ''}

Kembalikan JSON berupa array berisi satu objek {"id": ..., "text": ...} untuk setiap item, dengan id yang sama persis.

DAFTAR ITEM (JSON):
${JSON.stringify(data)}`;
}

async function callGemini(key, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  // Batas waktu per model: kalau satu model lambat/menggantung, pindah ke model
  // berikutnya sebelum seluruh fungsi Vercel kena timeout (504).
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 18000);
  let r;
  try {
    r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: ac.signal,
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.8,
        // Model Gemini baru "berpikir" dulu dan token berpikir ikut dihitung di sini,
        // jadi batasnya dibuat longgar agar jawaban tidak terpotong.
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, text: { type: 'STRING' } }, required: ['id', 'text'] }
        }
      }
    })
    });
  } finally {
    clearTimeout(to);
  }
  let j = {};
  try { j = await r.json(); } catch (e) {}
  return { r, j };
}

function parseResults(j) {
  const cand = (j.candidates || [])[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  const raw = parts.filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!raw) return { error: 'AI tidak mengembalikan hasil' + (cand && cand.finishReason ? ' (' + cand.finishReason + ')' : '') + '.' };
  let arr = null;
  try { arr = JSON.parse(raw); } catch (e) {
    const a = raw.indexOf('['), b = raw.lastIndexOf(']');
    if (a >= 0 && b > a) { try { arr = JSON.parse(raw.slice(a, b + 1)); } catch (e2) {} }
  }
  if (!Array.isArray(arr)) return { error: 'Format jawaban AI tidak terbaca' + (cand && cand.finishReason === 'MAX_TOKENS' ? ' (jawaban terpotong).' : '.') };
  return { results: arr.map(x => ({ id: String(x.id), text: String(x.text || '') })) };
}

/* ---------- jalur DeepSeek (opsional, aktif kalau PROVIDER=deepseek) ---------- */
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

function buildPromptDeepSeek(items, level, retry) {
  const data = items.map(it => ({ id: it.id, sebelum: it.before || '-', target: it.target, sesudah: it.after || '-' }));
  return `Kamu editor karya tulis ilmiah berbahasa Indonesia. Parafrasekan setiap "target" pada daftar di bawah tanpa mengubah makna, fakta, tingkat kepastian, atau nada akademiknya.
Tingkat perubahan: ${LEVEL[level]}
Aturan:
1. Token seperti [[K0]], [[K1]], dst adalah bagian terkunci (nomor standar, peraturan, pasal, sitasi, angka, kutipan, singkatan). Salin PERSIS karakter demi karakter, termasuk kurung sikunya. Jangan diterjemahkan, diberi spasi, dihapus, atau digandakan. Susun ulang kalimat di sekitarnya saja.
2. Jangan menambah atau menghilangkan informasi, data, klaim, atau opini. Jangan mengganti istilah teknis baku, nama orang, judul, nama peraturan, atau nama metode.
3. Gunakan bahasa Indonesia formal. Hindari pembuka klise seperti "Perlu diketahui bahwa" atau "Dengan demikian".
4. Panjang kira-kira sama dengan target aslinya. Hasil harus berbeda jelas dari aslinya, bukan hanya mengganti satu dua kata.
5. "target" hanya potongan teks; hasilnya harus tetap menyambung dengan teks "sebelum" dan "sesudah". Jangan menyalin teks "sebelum" atau "sesudah" ke dalam hasil.
6. Hasil berupa teks polos tanpa tanda kutip pembuka/penutup dan tanpa markdown.${retry ? '\n7. PERHATIAN: percobaan sebelumnya ditolak karena token terkunci tidak utuh atau hasil terlalu mirip aslinya. Pastikan setiap token [[Kn]] muncul tepat satu kali dan struktur kalimat benar-benar berubah.' : ''}

Kembalikan HANYA JSON berupa objek dengan satu kunci "items" berisi array objek {"id": ..., "text": ...} untuk setiap item, id sama persis. Jangan tambahkan teks, markdown, atau penjelasan lain di luar JSON itu.

DAFTAR ITEM (JSON):
${JSON.stringify(data)}`;
}

async function callDeepSeek(key, prompt) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 40000);
  let r;
  try {
    r = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      signal: ac.signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        max_tokens: 4096,
        response_format: { type: 'json_object' }
      })
    });
  } finally {
    clearTimeout(to);
  }
  let j = {};
  try { j = await r.json(); } catch (e) {}
  return { r, j };
}

function parseDeepSeekResults(j) {
  const msg = (j.choices || [])[0] && j.choices[0].message;
  const raw = (msg && msg.content || '').trim();
  const finish = (j.choices || [])[0] && j.choices[0].finish_reason;
  if (!raw) return { error: 'AI tidak mengembalikan hasil' + (finish ? ' (' + finish + ')' : '') + '.' };
  let obj = null;
  try { obj = JSON.parse(raw); } catch (e) {
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a >= 0 && b > a) { try { obj = JSON.parse(raw.slice(a, b + 1)); } catch (e2) {} }
  }
  const arr = obj && Array.isArray(obj.items) ? obj.items : (Array.isArray(obj) ? obj : null);
  if (!Array.isArray(arr)) return { error: 'Format jawaban AI tidak terbaca' + (finish === 'length' ? ' (jawaban terpotong).' : '.') };
  return { results: arr.map(x => ({ id: String(x.id), text: String(x.text || '') })) };
}

async function handleDeepSeek(res, key, items, level, retry) {
  const prompt = buildPromptDeepSeek(items, level, retry);
  let out;
  try { out = await callDeepSeek(key, prompt); }
  catch (e) { return res.status(502).json({ error: 'Gagal menghubungi DeepSeek.' }); }
  const { r, j } = out;
  const msg = (j && j.error && j.error.message) || '';
  if (r.ok) {
    const p = parseDeepSeekResults(j);
    if (p.results) return res.status(200).json({ results: p.results, model: DEEPSEEK_MODEL });
    return res.status(502).json({ error: p.error });
  }
  if (r.status === 429) {
    return res.status(429).json({ daily: false, retryAfter: 40, error: 'Jatah per menit DeepSeek penuh.' });
  }
  if (r.status === 402) {
    return res.status(502).json({ error: 'Saldo DeepSeek habis (akun butuh top-up). Pesan: ' + msg });
  }
  if (r.status === 401 || r.status === 403) {
    return res.status(502).json({ error: 'API key DeepSeek ditolak (' + r.status + '). Periksa DEEPSEEK_API_KEY di Vercel. Pesan: ' + msg });
  }
  return res.status(502).json({ error: 'DeepSeek error ' + r.status + ': ' + msg });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak didukung.' });

  const need = process.env.ACCESS_CODE;
  if (need && req.headers['x-access-code'] !== need)
    return res.status(401).json({ error: 'Kode akses salah atau belum diisi. Samakan dengan ACCESS_CODE di Vercel.' });

  // Saklar penyedia AI: set PROVIDER=deepseek di Vercel untuk sementara pindah ke DeepSeek.
  // Tidak diisi (atau "gemini") = tetap pakai Gemini seperti biasa.
  const provider = String(process.env.PROVIDER || 'gemini').toLowerCase();
  const key = provider === 'deepseek' ? process.env.DEEPSEEK_API_KEY : process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: provider === 'deepseek'
        ? 'Server belum diatur: DEEPSEEK_API_KEY kosong di Vercel.'
        : 'Server belum diatur: GEMINI_API_KEY kosong di Vercel.'
    });
  }

  const b = req.body || {};
  const level = LEVEL[b.level] ? b.level : 'sedang';
  const items = Array.isArray(b.items) ? b.items.slice(0, 10).map((it, i) => ({
    id: String(it.id ?? i),
    target: String(it.target || ''),
    before: String(it.before || '').slice(-300),
    after: String(it.after || '').slice(0, 300)
  })).filter(it => it.target.length >= 8 && it.target.length <= 3000) : [];
  if (!items.length) return res.status(400).json({ error: 'Tidak ada teks yang valid untuk diparafrase.' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const k = ip + '|' + new Date().toISOString().slice(0, 10);
  const n = (hits.get(k) || 0) + 1;
  hits.set(k, n);
  if (hits.size > 5000) hits.clear();
  if (n > Number(process.env.DAILY_LIMIT || 150))
    return res.status(429).json({ daily: true, error: 'Batas pemakaian harian web ini tercapai. Coba lagi besok.' });

  if (provider === 'deepseek') return handleDeepSeek(res, key, items, level, !!b.retry);

  const prompt = buildPrompt(items, level, !!b.retry);
  let lastErr = 'Layanan AI tidak merespons.';
  for (const model of MODELS) {
    let out;
    try { out = await callGemini(key, model, prompt); }
    catch (e) { lastErr = 'Gagal menghubungi Gemini.'; continue; }
    const { r, j } = out;
    const msg = (j && j.error && j.error.message) || '';
    if (r.ok) {
      const p = parseResults(j);
      if (p.results) return res.status(200).json({ results: p.results, model });
      lastErr = p.error; continue;              // coba model berikutnya
    }
    if (r.status === 429) {
      const daily = /per ?day|PerDay|daily/i.test(msg);
      const m = msg.match(/retry in ([\d.]+)s/i);
      return res.status(429).json({
        daily,
        retryAfter: m ? Math.ceil(Number(m[1])) + 2 : 40,
        error: daily ? 'Jatah gratis harian Gemini untuk API key ini sudah habis. Coba lagi besok atau pakai API key lain.' : 'Jatah per menit Gemini penuh.'
      });
    }
    if (r.status === 401 || r.status === 403) {
      return res.status(502).json({ error: 'API key Gemini ditolak (' + r.status + '). Periksa GEMINI_API_KEY di Vercel. Pesan Google: ' + msg });
    }
    if (r.status === 404 || /not found|not supported|unknown name|invalid json payload/i.test(msg)) { lastErr = 'Model ' + model + ' tidak tersedia: ' + msg; continue; }
    lastErr = 'Gemini error ' + r.status + ': ' + msg;
  }
  return res.status(502).json({ error: lastErr });
};
