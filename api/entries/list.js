const { getSupabase } = require('../../lib/supabase');
const { cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { day, limit = 20, offset = 0, type } = req.query;

  try {
    const supabase = getSupabase();

    // Return latest waking entry
    if (type === 'waking') {
      const { data, error } = await supabase
        .from('waking_entries')
        .select('id, tweet1, tweet2, day_number, posted_at')
        .eq('status', 'posted')
        .order('posted_at', { ascending: false })
        .limit(parseInt(limit));

      if (error) throw error;
      return res.status(200).json({ waking: data || [] });
    }

    let query = supabase
      .from('journal_entries')
      .select('id, text, tier, is_core_memory, ai_response, created_at, day_number, tx_hash')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (day) query = query.eq('day_number', parseInt(day));
    if (type === 'core') query = query.eq('is_core_memory', true);

    const { data, error, count } = await query;
    if (error) throw error;

    // Anonymize wallets — show holder number only
    const entries = (data || []).map(e => ({
      ...e,
      wallet: undefined, // never expose wallet addresses publicly
    }));

    return res.status(200).json({ entries, total: count });

  } catch (err) {
    console.error('List error:', err);
    return res.status(500).json({ error: 'Could not fetch entries' });
  }
};
