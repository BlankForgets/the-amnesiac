const { getSupabase } = require('../../lib/supabase');
const { requireAdmin, cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAdmin(req, res)) return;

  const supabase = getSupabase();

  // ── GET: list entries ───────────────────────────────────
  if (req.method === 'GET') {
    const { status = 'pending', limit = 50, offset = 0 } = req.query;

    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('status', status)
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ entries: data });
  }

  // ── POST: approve / reject / add AI response ────────────
  if (req.method === 'POST') {
    const { action, id, ai_response } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id is required' });

    if (action === 'approve') {
      const { error } = await supabase
        .from('journal_entries')
        .update({ status: 'approved', ai_response: ai_response || null })
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
      // Generate AI response for this entry
      const { data: entry } = await supabase
        .from('journal_entries')
        .select('text, tier')
        .eq('id', id)
        .single();

      if (!entry) return res.status(404).json({ error: 'Entry not found' });

      const Anthropic = require('@anthropic-ai/sdk');
      const { VOICE_SYSTEM } = require('../../lib/voice');

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const r = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: VOICE_SYSTEM,
        messages: [{
          role: 'user',
          content: `A holder wrote this in your journal:\n\n"${entry.text}"\n\nWrite a short response (1-3 sentences max) in your voice. This will appear below their entry on the website. Do not start with "I —" — just the response text.`
        }]
      });

      const response_text = r.content[0].text.trim();

      await supabase
        .from('journal_entries')
        .update({ ai_response: response_text })
        .eq('id', id);

      return res.status(200).json({ ai_response: response_text });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
