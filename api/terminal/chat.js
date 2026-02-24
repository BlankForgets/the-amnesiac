const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../../lib/supabase');
const { cors } = require('../../lib/auth');
const { buildTerminalPrompt } = require('../../lib/voice');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, wallet } = req.body || {};

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (messages.length > 60) {
    return res.status(400).json({ error: 'Conversation too long' });
  }

  const cleaned = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 2000)
  }));

  try {
    const supabase = getSupabase();
    const dayNum = Math.max(1, Math.ceil((Date.now() - new Date('2026-03-01').getTime()) / 86400000));

    // Fetch today's approved journal entries
    const { data: entries } = await supabase
      .from('journal_entries')
      .select('text, tier, is_core_memory')
      .eq('status', 'approved')
      .eq('day_number', dayNum)
      .order('created_at', { ascending: true });

    // Fetch permanent core memories
    const { data: cores } = await supabase
      .from('journal_entries')
      .select('text')
      .eq('is_core_memory', true)
      .eq('status', 'approved');

    // Fetch today's synthesis
    const { data: synthesis } = await supabase
      .from('daily_synthesis')
      .select('*')
      .eq('day_number', dayNum)
      .single();

    // Build dynamic system prompt from today's journal
    const systemPrompt = buildTerminalPrompt(entries || [], cores || [], synthesis);

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const result = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: systemPrompt,
      messages: cleaned
    });

    const text = result.content[0].text.trim();
    return res.status(200).json({
      text,
      mind_status: {
        entry_count: (entries || []).length,
        has_synthesis: !!synthesis,
        day_number: dayNum
      }
    });
  } catch (err) {
    console.error('Terminal chat error:', err);
    return res.status(500).json({ error: 'I could not find the words. Try again.' });
  }
};
