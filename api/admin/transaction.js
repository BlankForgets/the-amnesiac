const { getSupabase } = require('../../lib/supabase');
const { requireAdmin, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAdmin(req, res)) return;

  const supabase = getSupabase();

  // GET — fetch today's transactions
  if (req.method === 'GET') {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .eq('date', today)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ transactions: data || [] });
  }

  // POST — log a new transaction
  if (req.method === 'POST') {
    const {
      action, asset_name, asset_mint, amount_sol,
      entry_price_usd, exit_price_usd, pnl_sol, pnl_percent,
      tx_hash, journal_synthesis, influencing_entries, status = 'executed'
    } = req.body || {};

    if (!action) return res.status(400).json({ error: 'action is required' });

    const today = new Date().toISOString().split('T')[0];

    try {
      const row = {
        date: today,
        action,
        asset_name: asset_name || null,
        asset_mint: asset_mint || null,
        amount_sol: amount_sol || null,
        entry_price_usd: entry_price_usd || null,
        exit_price_usd: exit_price_usd || null,
        pnl_sol: pnl_sol || null,
        pnl_percent: pnl_percent || null,
        tx_hash: tx_hash || null,
        journal_synthesis: journal_synthesis || null,
        influencing_entries: influencing_entries || null,
        status,
        announced_at: status === 'announced' ? new Date().toISOString() : null,
        executed_at: status === 'executed' ? new Date().toISOString() : null
      };

      const { data, error } = await supabase
        .from('wallet_transactions')
        .insert(row)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({ success: true, transaction: data });

    } catch (err) {
      console.error('Transaction log error:', err);
      return res.status(500).json({ error: 'Failed to log transaction: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
