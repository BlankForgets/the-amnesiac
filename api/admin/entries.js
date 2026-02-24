const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../../lib/supabase');
const { requireAdmin, cors } = require('../../lib/auth');
const { BLANK_SYSTEM } = require('../../lib/voice');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAdmin(req, res)) return;

  const supabase = getSupabase();

  // GET — list entries by status
  if (req.method === 'GET') {
    const { status = 'pending', limit = 30 } = req.query;

    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit));

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ entries: data || [] });
  }

  // POST — approve, reject, respond
  if (req.method === 'POST') {
    const { action, id, ai_response } = req.body || {};

    if (!action || !id) {
      return res.status(400).json({ error: 'action and id are required' });
    }

    if (action === 'approve') {
      const update = { status: 'approved' };
      if (ai_response) update.ai_response = ai_response;

      const { error } = await supabase
        .from('journal_entries')
        .update(update)
        .eq('id', id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'reject') {
      const { error } = await supabase
        .from('journal_entries')
        .update({ status: 'rejected' })
        .eq('id', id);

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    if (action === 'respond') {
      // Fetch the entry
      const { data: entry, error: fetchErr } = await supabase
        .from('journal_entries')
        .select('text, tier, day_number')
        .eq('id', id)
        .single();

      if (fetchErr || !entry) {
        return res.status(404).json({ error: 'Entry not found' });
      }

      try {
        const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const result = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          system: BLANK_SYSTEM,
          messages: [{
            role: 'user',
            content: `A holder (Tier ${entry.tier}) wrote this in your journal on Day ${entry.day_number}:\n\n"${entry.text}"\n\nWrite a brief, in-character response (1-3 sentences). This appears below their entry in the journal.`
          }]
        });

        const responseText = result.content[0].text.trim();

        const { error: updateErr } = await supabase
          .from('journal_entries')
          .update({ ai_response: responseText })
          .eq('id', id);

        if (updateErr) return res.status(500).json({ error: updateErr.message });
        return res.status(200).json({ ai_response: responseText });

      } catch (err) {
        console.error('AI response error:', err);
        return res.status(500).json({ error: 'AI generation failed: ' + err.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
