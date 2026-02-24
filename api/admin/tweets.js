const { getSupabase } = require('../../lib/supabase');
const { requireAdmin, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAdmin(req, res)) return;

  const supabase = getSupabase();

  // GET — list tweets by status
  if (req.method === 'GET') {
    const { status = 'approved' } = req.query;

    const { data, error } = await supabase
      .from('scheduled_tweets')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ tweets: data || [] });
  }

  // POST — approve, edit, post, delete
  if (req.method === 'POST') {
    const { action, id, text } = req.body || {};

    if (!action || !id) {
      return res.status(400).json({ error: 'action and id are required' });
    }

    if (action === 'approve') {
      const { error } = await supabase
        .from('scheduled_tweets')
        .update({ status: 'approved' })
        .eq('id', id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'edit') {
      if (!text) return res.status(400).json({ error: 'text is required' });

      const { error } = await supabase
        .from('scheduled_tweets')
        .update({ text })
        .eq('id', id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'post') {
      // Mark as posted (Twitter integration not yet connected)
      const { error } = await supabase
        .from('scheduled_tweets')
        .update({ status: 'posted', posted_at: new Date().toISOString() })
        .eq('id', id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true, url: null });
    }

    if (action === 'delete') {
      const { error } = await supabase
        .from('scheduled_tweets')
        .update({ status: 'deleted' })
        .eq('id', id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
