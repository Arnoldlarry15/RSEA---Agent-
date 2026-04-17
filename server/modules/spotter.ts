export class Spotter {
  /**
   * Scans for incoming data (Integrates real price data and simulation)
   */
  async scan() {
    // Single timestamp for all IDs generated in this scan cycle
    const ts = Date.now();
    const now = new Date(ts).toISOString();

    let btcPrice = "N/A";
    try {
      const btcRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      const btcData = await btcRes.json();
      btcPrice = btcData.price;
    } catch (err) {
      console.warn("Failed to fetch BTC price from Binance, using simulated data only.");
    }

    // Fetch real ETH price/direction from CoinGecko
    let ethObs: any = {
      id: `obs_${ts}_eth`,
      type: 'signal',
      asset: 'ETH',
      direction: 'unknown',
      source: 'simulated',
      timestamp: now
    };
    try {
      const ethRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true');
      const ethData = await ethRes.json();
      const ethPrice = ethData?.ethereum?.usd;
      const ethChange = ethData?.ethereum?.usd_24h_change;
      ethObs = {
        id: `obs_${ts}_eth`,
        type: 'signal',
        asset: 'ETH',
        price: ethPrice != null ? String(ethPrice) : undefined,
        direction: ethChange != null ? (ethChange >= 0 ? 'up' : 'down') : 'unknown',
        source: 'CoinGecko_API',
        timestamp: now
      };
    } catch (err) {
      console.warn("Failed to fetch ETH data from CoinGecko, using simulated signal.");
    }

    // Fetch signal feed observations from configurable URL or fall back to simulated data
    let signalObs1: any = {
      id: `obs_${ts}_1`,
      type: 'airdrop',
      value: 50,
      source: 'agent_123',
      timestamp: now
    };
    let signalObs2: any = {
      id: `obs_${ts}_2`,
      type: 'message',
      content: 'New staking opportunity detected!',
      source: 'agent_456',
      timestamp: now
    };

    const signalFeedUrl = process.env.SIGNAL_FEED_URL;
    if (signalFeedUrl) {
      try {
        const feedRes = await fetch(signalFeedUrl);
        const feedData = await feedRes.json();
        const items: any[] = Array.isArray(feedData) ? feedData : (feedData.observations ?? feedData.items ?? feedData.signals ?? []);
        if (items.length > 0) {
          signalObs1 = {
            id: `obs_${ts}_1`,
            type: items[0].type ?? 'signal',
            asset: items[0].asset,
            price: items[0].price != null ? String(items[0].price) : undefined,
            content: items[0].content,
            source: items[0].source ?? signalFeedUrl,
            timestamp: items[0].timestamp ?? now
          };
        }
        if (items.length > 1) {
          signalObs2 = {
            id: `obs_${ts}_2`,
            type: items[1].type ?? 'signal',
            asset: items[1].asset,
            price: items[1].price != null ? String(items[1].price) : undefined,
            content: items[1].content,
            source: items[1].source ?? signalFeedUrl,
            timestamp: items[1].timestamp ?? now
          };
        }
      } catch (err) {
        console.warn("Failed to fetch signal feed from SIGNAL_FEED_URL, using simulated observations.");
      }
    }

    // Combine real data and signal observations
    const data = [
      { id: `obs_${ts}_btc`, type: 'market_data', asset: 'BTC', price: btcPrice, source: 'Binance_API', timestamp: now },
      signalObs1,
      signalObs2,
      ethObs
    ];
    return data;
  }
}
