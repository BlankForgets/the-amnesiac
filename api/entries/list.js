const { getSupabase } = require('../../lib/supabase');
const { cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { day, limit = 20, offset = 0, type } = req.query;
  const dayNum = Math.max(1, Math.ceil((Date.now() - new Date('2026-03-01').getTime()) / 86400000));

  try {
    const supabase = getSupabase();

    // Return today's synthesis
    if (type === 'synthesis') {
      const { data, error } = await supabase
        .from('daily_synthesis')
        .select('*')
        .eq('day_number', parseInt(day) || dayNum)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return res.status(200).json({ synthesis: data || null });
    }

    // Return today's decision
    if (type === 'decision') {
      const { data, error } = await supabase
        .from('daily_decisions')
        .select('*')
        .eq('day_number', parseInt(day) || dayNum)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return res.status(200).json({ decision: data || null });
    }

    // Return today's entries (for terminal prompt building)
    if (type === 'today') {
      const { data, error } = await supabase
        .from('journal_entries')
        .select('id, text, tier, is_core_memory, ai_response, created_at, day_number')
        .eq('status', 'approved')
        .eq('day_number', dayNum)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const { data: cores } = await supabase
        .from('journal_entries')
        .select('id, text, created_at')
        .eq('is_core_memory', true)
        .eq('status', 'approved');

      const { data: synthesis } = await supabase
        .from('daily_synthesis')
        .select('*')
        .eq('day_number', dayNum)
        .single();

      return res.status(200).json({
        entries: data || [],
        core_memories: cores || [],
        synthesis: synthesis || null,
        day_number: dayNum,
        entry_count: (data || []).length
      });
    }

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

    // Default: list approved entries (public journal view)
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

    const entries = (data || []).map(e => ({
      ...e,
      wallet: undefined,
    }));

    return res.status(200).json({ entries, total: count });

  } catch (err) {
    console.error('List error:', err);
    return res.status(500).json({ error: 'Could not fetch entries' });
  }
};
