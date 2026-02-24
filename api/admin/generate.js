const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../../lib/supabase');
const { requireAdmin, cors } = require('../../lib/auth');
const { BLANK_SYSTEM, TWEET_TEMPLATES } = require('../../lib/voice');

const VALID_TYPES = ['morning', 'midday_decision', 'evening_result', 'final_thought'];

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, count = 3, context = '', decision = '', result: actionResult = '' } = req.body || {};

  if (!VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
  }

  const supabase = getSupabase();
  const dayNum = Math.max(1, Math.ceil((Date.now() - new Date('2026-03-01').getTime()) / 86400000));

  // Build context from today's journal entries if not provided
  let journalContext = context;
  if (!journalContext) {
    const { data: entries } = await supabase
      .from('journal_entries')
      .select('text, tier')
      .eq('status', 'approved')
      .eq('day_number', dayNum)
      .order('created_at', { ascending: true });

    if (entries && entries.length > 0) {
      journalContext = `${entries.length} journal entries today. Themes: ` +
        entries.map(e => `"${e.text.slice(0, 80)}"`).join('; ');
    } else {
      journalContext = 'The journal is empty today. Nobody has written.';
    }
  }

  // Build the prompt from template
  let prompt = TWEET_TEMPLATES[type]
    .replace('{CONTEXT}', `Day ${dayNum}. ${journalContext}`)
    .replace('{DECISION}', decision || 'No decision provided.')
    .replace('{RESULT}', actionResult || 'No result provided.');

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const tweets = [];

    const requests = Array.from({ length: Math.min(count, 5) }, () =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 300,
        system: BLANK_SYSTEM,
        messages: [{ role: 'user', content: prompt }]
      })
    );

    const results = await Promise.all(requests);
    for (const r of results) {
      const text = r.content[0].text.trim().replace(/^["']|["']$/g, '');
      tweets.push(text);
    }

    // Save to scheduled_tweets table as drafts
    const rows = tweets.map(text => ({
      text,
      type,
      day_number: dayNum,
      status: 'draft',
      scheduled_for: null
    }));

    const { data, error } = await supabase
      .from('scheduled_tweets')
      .insert(rows)
      .select();

    if (error) throw error;

    return res.status(200).json({ tweets: data });

  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: 'Generation failed: ' + err.message });
  }
};
