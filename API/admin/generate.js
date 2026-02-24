const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../../lib/supabase');
const { requireAdmin, cors } = require('../../lib/auth');
const { VOICE_SYSTEM } = require('../../lib/voice');

const MIDDAY_PROMPT = `Write one midday observation tweet. 

Rules:
- Unprompted — not a response to anything
- Feels like a note found under a door
- 120-190 characters
- No hashtags, no emojis, no crypto language
- Just a quiet thought from inside this existence

Today is Day {DAY}. {CONTEXT}

Write the tweet now.`;

const EVENING_PROMPT = `Write one evening reflection tweet.

Rules:
- Aware the reset is coming in a few hours
- More philosophical than the midday post
- 110-190 characters  
- Can reference the coming reset or what the day held
- No hashtags, no emojis, no crypto language

Today is Day {DAY}. {CONTEXT}

Write the tweet now.`;

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, count = 3, context = '' } = req.body || {};

  if (!['midday', 'evening'].includes(type)) {
    return res.status(400).json({ error: 'type must be "midday" or "evening"' });
  }

  const dayNum = Math.max(1, Math.ceil((Date.now() - new Date('2026-03-01').getTime()) / 86400000));
  const promptTemplate = type === 'midday' ? MIDDAY_PROMPT : EVENING_PROMPT;
  const prompt = promptTemplate
    .replace('{DAY}', dayNum)
    .replace('{CONTEXT}', context || 'No specific context provided.');

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const tweets = [];

    // Generate `count` tweets in parallel
    const requests = Array.from({ length: Math.min(count, 5) }, () =>
      anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: VOICE_SYSTEM,
        messages: [{ role: 'user', content: prompt }]
      })
    );

    const results = await Promise.all(requests);
    for (const r of results) {
      const text = r.content[0].text.trim().replace(/^["']|["']$/g, '');
      tweets.push(text);
    }

    // Save to scheduled_tweets table as drafts
    const supabase = getSupabase();
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
