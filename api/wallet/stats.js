const { getSupabase } = require('../../lib/supabase');
const { cors } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const supabase = getSupabase();

    // Fetch all transactions
    const { data: transactions, error } = await supabase
      .from('wallet_transactions')
      .select('*')
      .order('date', { ascending: false });

    if (error) throw error;

    const txs = transactions || [];

    // Compute stats
    const executed = txs.filter(t => t.status === 'executed');
    const withPnl = executed.filter(t => t.pnl_sol !== null && t.pnl_sol !== undefined);
    const wins = withPnl.filter(t => t.pnl_sol > 0);
    const losses = withPnl.filter(t => t.pnl_sol < 0);

    const totalPnlSol = withPnl.reduce((sum, t) => sum + parseFloat(t.pnl_sol || 0), 0);
    const totalVolume = executed.reduce((sum, t) => sum + Math.abs(parseFloat(t.amount_sol || 0)), 0);
    const winRate = withPnl.length > 0 ? Math.round((wins.length / withPnl.length) * 100) : 0;

    // Best and worst trades
    const bestTrade = withPnl.length > 0
      ? withPnl.reduce((best, t) => parseFloat(t.pnl_percent || 0) > parseFloat(best.pnl_percent || 0) ? t : best)
      : null;
    const worstTrade = withPnl.length > 0
      ? withPnl.reduce((worst, t) => parseFloat(t.pnl_percent || 0) < parseFloat(worst.pnl_percent || 0) ? t : worst)
      : null;

    // Current streak — count consecutive wins or losses from most recent
    let streak = 0;
    let streakType = null;
    for (const t of withPnl) {
      const isWin = parseFloat(t.pnl_sol) > 0;
      if (streakType === null) {
        streakType = isWin ? 'win' : 'loss';
        streak = 1;
      } else if ((isWin && streakType === 'win') || (!isWin && streakType === 'loss')) {
        streak++;
      } else {
        break;
      }
    }

    // Open positions — buys that haven't been fully sold
    // Group by asset_mint: sum buy amounts, subtract sell amounts
    const positionMap = {};
    // Process in chronological order for positions
    const chronological = [...executed].reverse();
    for (const t of chronological) {
      if (!t.asset_mint) continue;
      if (!positionMap[t.asset_mint]) {
        positionMap[t.asset_mint] = {
          asset_name: t.asset_name,
          asset_mint: t.asset_mint,
          net_sol: 0,
          entry_price_usd: 0,
          buy_count: 0
        };
      }
      const pos = positionMap[t.asset_mint];
      if (t.action === 'buy') {
        pos.net_sol += parseFloat(t.amount_sol || 0);
        pos.entry_price_usd = parseFloat(t.entry_price_usd || 0);
        pos.buy_count++;
      } else if (t.action === 'sell') {
        pos.net_sol -= parseFloat(t.amount_sol || 0);
      }
    }
    const openPositions = Object.values(positionMap).filter(p => p.net_sol > 0.0001);

    // Daily balance history — cumulative P&L by date
    const dailyMap = {};
    for (const t of chronological) {
      const dateStr = t.date;
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { date: dateStr, pnl_sol: 0, action: t.action, asset_name: t.asset_name };
      }
      dailyMap[dateStr].pnl_sol += parseFloat(t.pnl_sol || 0);
    }
    const dailyHistory = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
    let cumulative = 0;
    const balanceHistory = dailyHistory.map(d => {
      cumulative += d.pnl_sol;
      return { date: d.date, cumulative_pnl: cumulative, daily_pnl: d.pnl_sol, action: d.action, asset_name: d.asset_name };
    });

    return res.status(200).json({
      transactions: txs,
      stats: {
        total_pnl_sol: totalPnlSol,
        total_transactions: executed.length,
        win_rate: winRate,
        total_volume_sol: totalVolume,
        best_trade: bestTrade ? { asset_name: bestTrade.asset_name, pnl_percent: parseFloat(bestTrade.pnl_percent), pnl_sol: parseFloat(bestTrade.pnl_sol) } : null,
        worst_trade: worstTrade ? { asset_name: worstTrade.asset_name, pnl_percent: parseFloat(worstTrade.pnl_percent), pnl_sol: parseFloat(worstTrade.pnl_sol) } : null,
        streak: { count: streak, type: streakType || 'none' }
      },
      open_positions: openPositions,
      balance_history: balanceHistory
    });

  } catch (err) {
    console.error('Wallet stats error:', err);
    return res.status(500).json({ error: 'Could not fetch wallet stats' });
  }
};
