import { logEvent } from '../utils/logger';
import { isSsrfTarget } from '../utils/ssrf';

/** Timeout (ms) for outbound market-data fetches. */
const SPOTTER_FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS ?? '10000', 10);

function spotterFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPOTTER_FETCH_TIMEOUT_MS);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

export class Spotter {
  /**
   * Fetches the configured signal feed URL and returns up to two parsed
   * observation objects.  Only called after the SSRF guard has passed.
   */
  private async _fetchSignalFeed(
    url: string,
    ts: number,
    now: string,
  ): Promise<{ obs1: any; obs2: any } | null> {
    try {
      const feedRes = await spotterFetch(url);
      const feedData = await feedRes.json();
      const items: any[] = Array.isArray(feedData)
        ? feedData
        : (feedData.observations ?? feedData.items ?? feedData.signals ?? []);

      const obs1 = items.length > 0
        ? {
            id: `obs_${ts}_1`,
            type: items[0].type ?? 'signal',
            asset: items[0].asset,
            price: items[0].price != null ? String(items[0].price) : undefined,
            content: items[0].content,
            source: items[0].source ?? url,
            timestamp: items[0].timestamp ?? now,
          }
        : null;

      const obs2 = items.length > 1
        ? {
            id: `obs_${ts}_2`,
            type: items[1].type ?? 'signal',
            asset: items[1].asset,
            price: items[1].price != null ? String(items[1].price) : undefined,
            content: items[1].content,
            source: items[1].source ?? url,
            timestamp: items[1].timestamp ?? now,
          }
        : null;

      return { obs1, obs2 };
    } catch {
      console.warn("Failed to fetch signal feed from SIGNAL_FEED_URL, using simulated observations.");
      return null;
    }
  }

  /**
   * Scans for incoming data (Integrates real price data and simulation)
   */
  async scan() {
    // Single timestamp for all IDs generated in this scan cycle
    const ts = Date.now();
    const now = new Date(ts).toISOString();

    let btcPrice = "N/A";
    try {
      const btcRes = await spotterFetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      const btcData = await btcRes.json();
      btcPrice = btcData.price;
    } catch (_err) {
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
      const ethRes = await spotterFetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true');
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
    } catch (_err) {
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
      if (isSsrfTarget(signalFeedUrl)) {
        console.warn('[Spotter] SIGNAL_FEED_URL targets a private/loopback address or is malformed — skipping fetch, using simulated observations.');
      } else {
        const fetched = await this._fetchSignalFeed(signalFeedUrl, ts, now);
        if (fetched?.obs1) signalObs1 = fetched.obs1;
        if (fetched?.obs2) signalObs2 = fetched.obs2;
      }
    }

    // Combine real data and signal observations
    const data = [
      { id: `obs_${ts}_btc`, type: 'market_data', asset: 'BTC', price: btcPrice, source: 'Binance_API', timestamp: now },
      signalObs1,
      signalObs2,
      ethObs
    ];

    logEvent('observe', { count: data.length, assets: data.map((o: any) => o.asset).filter(Boolean) });

    return data;
  }
}
