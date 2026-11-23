// GET  /api/settings          -> { payment: true|false }  (publik, dipakai halaman utama)
// POST /api/settings          -> ubah saklar; wajib header x-admin-password = ADMIN_PASSWORD
//      body: { payment: true|false }  atau  { check: true } untuk sekadar cek kata sandi
const { getPayment, setPayment, hasStore, checkAdmin } = require('../lib/settings');

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ payment: await getPayment() });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metode tidak didukung.' });

  if (!process.env.ADMIN_PASSWORD)
    return res.status(500).json({ error: 'ADMIN_PASSWORD belum diisi di Environment Variables Vercel.' });
  if (!checkAdmin(req.headers['x-admin-password']))
    return res.status(401).json({ error: 'Kata sandi admin salah.' });

  const b = req.body || {};
  if (b.check || typeof b.payment !== 'boolean') {
    return res.status(200).json({ payment: await getPayment(), store: hasStore(), accessCode: !!process.env.ACCESS_CODE });
  }
  if (!hasStore())
    return res.status(500).json({ error: 'Penyimpanan belum terhubung. Di Vercel buka Storage, pilih Upstash (Redis), lalu Connect ke project ini dan Redeploy.' });
  try {
    const payment = await setPayment(b.payment);
    return res.status(200).json({ payment, store: true, accessCode: !!process.env.ACCESS_CODE });
  } catch (e) {
    return res.status(502).json({ error: 'Gagal menyimpan pengaturan: ' + e.message });
  }
};
