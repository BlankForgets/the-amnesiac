const Anthropic = require('@anthropic-ai/sdk');
const { getSupabase } = require('../../lib/supabase');
const { requireAdmin, cors } = require('../../lib/auth');
const { BLANK_SYSTEM, SYNTHESIS_PROMPT } = require('../../lib/voice');

const TREASURY = '4VdBG5uXv1bnEJFKikzYxRVuPUfgScC4oTPj5NYTYHsg';
const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const MAX_POSITION_PERCENT = 0.15;

async function getTreasuryBalance() {
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [TREASURY] })
    });
    const data = await res.json();
    return (data?.result?.value || 0) / 1e9;
  } catch { return 0; }
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (!requireAdmin(req, res)) return;

  const supabase = getSupabase();
  const now = new Date();
  const dayNum = Math.max(1, Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.UTC(2026, 2, 1)) / 86400000) + 1);

  // GET — fetch today's synthesis + position guardrail
  if (req.method === 'GET') {
    const [synthResult, balance] = await Promise.all([
      supabase.from('daily_synthesis').select('*').eq('day_number', dayNum).single(),
      getTreasuryBalance()
    ]);

    if (synthResult.error && synthResult.error.code !== 'PGRST116') {
      return res.status(500).json({ error: synthResult.error.message });
    }

    const maxPositionSol = parseFloat((balance * MAX_POSITION_PERCENT).toFixed(4));
    return res.status(200).json({
      synthesis: synthResult.data || null,
      day_number: dayNum,
      treasury_balance_sol: balance,
      max_position_sol: maxPositionSol
    });
  }

  // POST — generate synthesis from today's approved entries
  if (req.method === 'POST') {
    try {
      // Fetch today's approved entries
      const { data: entries, error: fetchErr } = await supabase
        .from('journal_entries')
        .select('text, tier, is_core_memory, created_at')
        .eq('status', 'approved')
        .eq('day_number', dayNum)
        .order('created_at', { ascending: true });

      if (fetchErr) throw fetchErr;

      if (!entries || entries.length === 0) {
        return res.status(400).json({ error: 'No approved entries today. Nothing to synthesize.' });
      }

      // Also fetch core memories (permanent)
      const { data: cores } = await supabase
        .from('journal_entries')
        .select('text')
        .eq('is_core_memory', true)
        .eq('status', 'approved');

      const entriesText = entries.map((e, i) =>
        `[Entry ${i + 1}, Tier ${e.tier}${e.is_core_memory ? ' CORE' : ''}]: "${e.text}"`
      ).join('\n\n');

      const coreText = (cores || []).length > 0
        ? '\n\nPERMANENT CORE MEMORIES:\n' + cores.map(c => `- "${c.text}"`).join('\n')
        : '';

      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const result = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        system: SYNTHESIS_PROMPT,
        messages: [{
          role: 'user',
          content: `Today is Day ${dayNum}. ${entries.length} entries were written.\n\n${entriesText}${coreText}\n\nSynthesize BLANK's mind for today.`
        }]
      });

      const synthesisText = result.content?.[0]?.text?.trim();
      if (!synthesisText) throw new Error('Empty response from AI');

      // Upsert into daily_synthesis
      const { data, error } = await supabase
        .from('daily_synthesis')
        .upsert({
          day_number: dayNum,
          synthesis_text: synthesisText,
          entry_count: entries.length,
          generated_at: new Date().toISOString()
        }, { onConflict: 'day_number' })
        .select()
        .single();

      if (error) throw error;

      const balance = await getTreasuryBalance();
      const maxPositionSol = parseFloat((balance * MAX_POSITION_PERCENT).toFixed(4));

      return res.status(200).json({
        synthesis: data,
        treasury_balance_sol: balance,
        max_position_sol: maxPositionSol
      });

    } catch (err) {
      console.error('Synthesis error:', err);
      return res.status(500).json({ error: 'Synthesis failed: ' + err.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
