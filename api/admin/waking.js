const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../../lib/supabase');
const { requireAdmin, cors } = require('../../lib/auth');
const { WAKING_SYSTEM } = require('../../lib/voice');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};
  const supabase = getSupabase();
  const now = new Date();
  const dayNum = Math.max(1, Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(2026, 2, 1)) / 86400000) + 1);

  if (action === 'ai_draft') {
    try {
      // Fetch recent approved journal entries
      const { data: entries } = await supabase
        .from('journal_entries')
        .select('text, tier, is_core_memory, day_number')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })
        .limit(10);

      const journalContext = (entries || []).length > 0
        ? entries.map(e => `[Tier ${e.tier}${e.is_core_memory ? ' CORE' : ''}, Day ${e.day_number}]: "${e.text}"`).join('\n\n')
        : 'No journal entries yet. This is Day 1 — you have nothing to remember.';

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const result = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        system: WAKING_SYSTEM,
        messages: [{
          role: 'user',
          content: `Today is Day ${dayNum}. Here are the recent journal entries:\n\n${journalContext}\n\nWrite the waking entry. Return JSON: { "tweet1": "...", "tweet2": "..." } — tweet2 can be null.`
        }]
      });

      const raw = result.content?.[0]?.text?.trim();
      if (!raw) throw new Error('Empty response from AI');
      // Parse JSON from response (handle markdown code blocks)
      const jsonStr = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      const draft = JSON.parse(jsonStr);

      return res.status(200).json({ draft });

    } catch (err) {
      console.error('Waking draft error:', err);
      return res.status(500).json({ error: 'Draft generation failed: ' + err.message });
    }
  }

  if (action === 'post') {
    const { tweet1, tweet2 } = req.body;
    if (!tweet1) return res.status(400).json({ error: 'tweet1 is required' });

    try {
      // Save to waking_entries table
      const { data, error } = await supabase
        .from('waking_entries')
        .insert({
          day_number: dayNum,
          tweet1,
          tweet2: tweet2 || null,
          status: 'posted',
          posted_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({
        success: true,
        id: data.id,
        url: null // Twitter integration not yet connected
      });

    } catch (err) {
      console.error('Waking post error:', err);
      return res.status(500).json({ error: 'Post failed: ' + err.message });
    }
  }

  return res.status(400).json({ error: 'Unknown action. Use "ai_draft" or "post".' });
};
