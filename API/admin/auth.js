const { cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { secret } = req.body || {};
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ ok: false });
  }

  return res.status(200).json({ ok: true });
};
