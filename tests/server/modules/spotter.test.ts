import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Spotter } from '../../../server/modules/spotter';

describe('Spotter', () => {
  let spotter: Spotter;

  beforeEach(() => {
    spotter = new Spotter();
    delete process.env.SIGNAL_FEED_URL;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.SIGNAL_FEED_URL;
  });

  // ---------------------------------------------------------------------------
  // Basic structure
  // ---------------------------------------------------------------------------
  it('returns an array of 4 observations', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ price: '50000' })
    } as any);
    const data = await spotter.scan();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(4);
  });

  it('each observation includes id, type, source, and timestamp', async () => {
    vi.mocked(fetch).mockResolvedValue({
      json: vi.fn().mockResolvedValue({ price: '50000' })
    } as any);
    const data = await spotter.scan();
    data.forEach((obs: any) => {
      expect(obs.id).toBeDefined();
      expect(obs.type).toBeDefined();
      expect(obs.source).toBeDefined();
      expect(obs.timestamp).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // BTC price fetch — success
  // ---------------------------------------------------------------------------
  it('uses real BTC price when Binance responds', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)  // BTC
      .mockResolvedValue({ json: async () => ({}) } as any);                      // ETH

    const data = await spotter.scan();
    const btcObs = data.find((o: any) => o.asset === 'BTC');
    expect(btcObs?.price).toBe('67000');
    expect(btcObs?.source).toBe('Binance_API');
  });

  // ---------------------------------------------------------------------------
  // BTC price fetch — failure fallback
  // ---------------------------------------------------------------------------
  it('falls back to "N/A" price when Binance fetch fails', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('network'))  // BTC fails
      .mockResolvedValue({ json: async () => ({}) } as any);

    const data = await spotter.scan();
    const btcObs = data.find((o: any) => o.asset === 'BTC');
    expect(btcObs?.price).toBe('N/A');
  });

  // ---------------------------------------------------------------------------
  // ETH data — success with positive change
  // ---------------------------------------------------------------------------
  it('sets ETH direction to "up" when 24h change is positive', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)  // BTC
      .mockResolvedValueOnce({                                                   // ETH
        json: async () => ({ ethereum: { usd: 3500, usd_24h_change: 2.5 } })
      } as any);

    const data = await spotter.scan();
    const ethObs = data.find((o: any) => o.asset === 'ETH');
    expect(ethObs?.direction).toBe('up');
    expect(ethObs?.price).toBe('3500');
    expect(ethObs?.source).toBe('CoinGecko_API');
  });

  // ---------------------------------------------------------------------------
  // ETH data — success with negative change
  // ---------------------------------------------------------------------------
  it('sets ETH direction to "down" when 24h change is negative', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)
      .mockResolvedValueOnce({
        json: async () => ({ ethereum: { usd: 3000, usd_24h_change: -1.2 } })
      } as any);

    const data = await spotter.scan();
    const ethObs = data.find((o: any) => o.asset === 'ETH');
    expect(ethObs?.direction).toBe('down');
  });

  // ---------------------------------------------------------------------------
  // ETH data — success with zero change
  // ---------------------------------------------------------------------------
  it('sets ETH direction to "up" when 24h change is exactly zero', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)
      .mockResolvedValueOnce({
        json: async () => ({ ethereum: { usd: 3000, usd_24h_change: 0 } })
      } as any);

    const data = await spotter.scan();
    const ethObs = data.find((o: any) => o.asset === 'ETH');
    expect(ethObs?.direction).toBe('up');
  });

  // ---------------------------------------------------------------------------
  // ETH data — null price/change
  // ---------------------------------------------------------------------------
  it('omits price and sets direction "unknown" when ETH response is missing fields', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)
      .mockResolvedValueOnce({
        json: async () => ({ ethereum: {} })  // no usd or usd_24h_change
      } as any);

    const data = await spotter.scan();
    const ethObs = data.find((o: any) => o.asset === 'ETH');
    expect(ethObs?.direction).toBe('unknown');
    expect(ethObs?.price).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // ETH data — failure fallback
  // ---------------------------------------------------------------------------
  it('falls back to simulated ETH observation when CoinGecko fetch fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)
      .mockRejectedValueOnce(new Error('CoinGecko down'));

    const data = await spotter.scan();
    const ethObs = data.find((o: any) => o.asset === 'ETH');
    expect(ethObs?.source).toBe('simulated');
    expect(ethObs?.direction).toBe('unknown');
  });

  // ---------------------------------------------------------------------------
  // Signal feed — SIGNAL_FEED_URL is set, fetch returns array
  // ---------------------------------------------------------------------------
  it('overrides default signal obs with items from SIGNAL_FEED_URL (array response)', async () => {
    process.env.SIGNAL_FEED_URL = 'https://signals.example.com/feed';

    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)  // BTC
      .mockResolvedValueOnce({                                                   // ETH
        json: async () => ({ ethereum: { usd: 3500, usd_24h_change: 1 } })
      } as any)
      .mockResolvedValueOnce({                                                   // signal feed
        json: async () => ([
          { type: 'nft_drop', asset: 'BAYC', price: 20, source: 'feed_source', content: 'drop happening' },
          { type: 'airdrop', asset: 'ARB', source: 'feed_source2', content: 'claim now' },
        ])
      } as any);

    const data = await spotter.scan();
    expect(data[1].type).toBe('nft_drop');
    expect(data[1].source).toBe('feed_source');
    expect(data[2].type).toBe('airdrop');
  });

  // ---------------------------------------------------------------------------
  // Signal feed — response uses .observations key
  // ---------------------------------------------------------------------------
  it('reads items from .observations property when feed response is not an array', async () => {
    process.env.SIGNAL_FEED_URL = 'https://signals.example.com/feed';

    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)
      .mockResolvedValueOnce({
        json: async () => ({ ethereum: { usd: 3500, usd_24h_change: 1 } })
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({
          observations: [
            { type: 'signal', asset: 'SOL', source: 'obs_feed' }
          ]
        })
      } as any);

    const data = await spotter.scan();
    expect(data[1].asset).toBe('SOL');
    expect(data[1].source).toBe('obs_feed');
  });

  // ---------------------------------------------------------------------------
  // Signal feed — empty items list
  // ---------------------------------------------------------------------------
  it('keeps default signal obs when feed returns empty items', async () => {
    process.env.SIGNAL_FEED_URL = 'https://signals.example.com/feed';

    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)
      .mockResolvedValueOnce({
        json: async () => ({ ethereum: { usd: 3500, usd_24h_change: 1 } })
      } as any)
      .mockResolvedValueOnce({ json: async () => ([]) } as any);

    const data = await spotter.scan();
    // obs[1] is signalObs1 — still the default airdrop
    expect(data[1].type).toBe('airdrop');
  });

  // ---------------------------------------------------------------------------
  // Signal feed — fetch failure
  // ---------------------------------------------------------------------------
  it('falls back to simulated signal obs when SIGNAL_FEED_URL fetch fails', async () => {
    process.env.SIGNAL_FEED_URL = 'https://bad.example.com';

    vi.mocked(fetch)
      .mockResolvedValueOnce({ json: async () => ({ price: '67000' }) } as any)
      .mockResolvedValueOnce({
        json: async () => ({ ethereum: { usd: 3500, usd_24h_change: 1 } })
      } as any)
      .mockRejectedValueOnce(new Error('feed down'));

    const data = await spotter.scan();
    // Still 4 observations — default simulated ones
    expect(data).toHaveLength(4);
    expect(data[1].source).toBe('agent_123');
  });
});
