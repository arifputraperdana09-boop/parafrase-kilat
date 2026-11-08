// Server kecil: menerima potongan teks, memanggil Gemini (Google AI) dengan API key rahasia, mengembalikan parafrase.
const LEVEL = {
  ringan: 'Ganti sebagian kata dan susun ulang frasa, kerangka kalimat boleh tetap mirip.',
  sedang: 'Ubah struktur kalimat dan pilihan kata secara jelas.',
  kuat: 'Ubah total: pecah atau gabung kalimat, pindahkan klausa, balik aktif dan pasif.'
};
const hits = new Map(); // pembatas harian per alamat IP (berlaku per instance server)

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak didukung.' });

  const need = process.env.ACCESS_CODE;
  if (need && req.headers['x-access-code'] !== need)
    return res.status(401).json({ error: 'Kode akses salah atau belum diisi.' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'Server belum diatur: GEMINI_API_KEY kosong.' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x';
  const day = new Date().toISOString().slice(0, 10);
  const k = ip + '|' + day;
  const n = (hits.get(k) || 0) + 1;
  hits.set(k, n);
  if (hits.size > 5000) hits.clear();
  const max = Number(process.env.DAILY_LIMIT || 400); // jaga di bawah jatah gratis Gemini (±500 req/hari)
  if (n > max) return res.status(429).json({ error: 'Batas pemakaian harian tercapai. Coba lagi besok.' });

  const b = req.body || {};
  const target = String(b.target || '');
  const before = String(b.before || '').slice(-300);
  const after = String(b.after || '').slice(0, 300);
  const level = LEVEL[b.level] ? b.level : 'sedang';
  if (target.length < 8 || target.length > 2500)
    return res.status(400).json({ error: 'Panjang teks tidak valid.' });

  const prompt = `Kamu editor karya tulis ilmiah berbahasa Indonesia. Parafrasekan TEKS TARGET tanpa mengubah makna, fakta, tingkat kepastian, atau nada akademiknya.
Tingkat perubahan: ${LEVEL[level]}
Aturan:
1. Token seperti [[K0]], [[K1]], dst adalah bagian terkunci (contoh: nomor standar, peraturan, sitasi, angka). Salin PERSIS apa adanya, karakter demi karakter, termasuk tanda kurung sikunya; jangan diterjemahkan, diberi spasi tambahan, diubah formatnya, dihapus, atau digandakan. Cukup susun ulang kalimat di sekitar token itu.
2. Jangan menambah atau menghilangkan informasi, data, klaim, atau opini.
3. Pertahankan istilah teknis baku dan bahasa Indonesia yang formal.
4. Panjang kira-kira sama dengan aslinya.
5. TEKS TARGET hanya potongan kalimat; hasilnya harus tetap menyambung dengan teks sebelum dan sesudahnya.
6. Keluarkan HANYA hasil parafrase, satu paragraf polos, tanpa tanda kutip, tanpa markdown (jangan pakai ** atau backtick), tanpa penjelasan, tanpa awalan.

TEKS SEBELUM: ${before || '-'}
TEKS TARGET: ${target}
TEKS SESUDAH: ${after || '-'}`;

  const model = process.env.MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 600 }
      })
    });
    const j = await r.json();
    if (!r.ok) {
      const msg = (j && j.error && j.error.message) || 'Layanan AI sedang bermasalah.';
      const status = r.status === 429 ? 503 : 503;
      return res.status(status).json({ error: 'Layanan AI sedang bermasalah: ' + msg });
    }
    const cand = (j.candidates || [])[0];
    const text = ((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('').trim();
    if (!text) return res.status(503).json({ error: 'AI tidak mengembalikan hasil. Coba lagi.' });
    return res.status(200).json({ text });
  } catch (e) {
    return res.status(503).json({ error: 'Gagal menghubungi layanan AI. Coba lagi.' });
  }
};
