const { getSupabase } = require('../../lib/supabase');
const { cors } = require('../../lib/auth');

// Verify Solana token balance (read-only)
async function getTokenBalance(walletAddress) {
  const mint = process.env.BLANK_TOKEN_MINT;
  const rpc = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'getTokenAccountsByOwner',
      params: [walletAddress, { mint }, { encoding: 'jsonParsed' }]
    })
  });

  const data = await res.json();
  const accounts = data?.result?.value || [];
  if (accounts.length === 0) return 0;
  return accounts[0].account.data.parsed.info.tokenAmount.uiAmount || 0;
}

function getTier(balance) {
  if (balance >= 200000) return 3;
  if (balance >= 50000)  return 2;
  if (balance >= 10000)  return 1;
  return 0;
}

function getMaxChars(tier) {
  return tier >= 2 ? 1000 : 280;
}

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { wallet, text, is_core_memory = false } = req.body || {};

  // Validate inputs
  if (!wallet || typeof wallet !== 'string' || wallet.length < 32) {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'Entry text is required' });
  }

  try {
    // 1. Verify token balance on-chain
    const balance = await getTokenBalance(wallet);
    const tier = getTier(balance);

    if (tier === 0) {
      return res.status(403).json({
        error: 'Insufficient balance',
        message: `You need at least 10,000 $BLANK to write in the journal. Current balance: ${balance.toLocaleString()}`
      });
    }

    // 2. Check text length for tier
    const maxChars = getMaxChars(tier);
    if (text.trim().length > maxChars) {
      return res.status(400).json({
        error: `Entry too long. Tier ${tier} allows ${maxChars} characters.`
      });
    }

    // 3. Core memory only for Tier 3
    if (is_core_memory && tier < 3) {
      return res.status(403).json({ error: 'Core memories require Tier III (200,000 $BLANK)' });
    }

    // 4. Check daily limit — one entry per wallet per day (Tier 1)
    if (tier === 1) {
      const supabase = getSupabase();
      const todayMidnight = new Date();
      todayMidnight.setUTCHours(0, 0, 0, 0);
      const { count } = await supabase
        .from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('wallet', wallet)
        .gte('created_at', todayMidnight.toISOString());

      if (count > 0) {
        return res.status(429).json({
          error: 'Daily limit reached',
          message: 'Tier I allows one entry per day. Upgrade to Tier II for unlimited entries.'
        });
      }
    }

    // 5. Save to database
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('journal_entries')
      .insert({
        wallet,
        text: text.trim(),
        tier,
        balance,
        is_core_memory: is_core_memory && tier === 3,
        status: 'pending', // pending | approved | rejected
        day_number: Math.max(1, Math.ceil((Date.now() - new Date('2026-03-01').getTime()) / 86400000))
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      entry_id: data.id,
      tier,
      is_core_memory: data.is_core_memory,
      message: data.is_core_memory
        ? 'Core memory submitted. It will be written to the blockchain after review.'
        : 'Entry submitted. It will become part of my mind today after review.'
    });

  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};
