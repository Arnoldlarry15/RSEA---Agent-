export class Scorer {
  /**
   * Evaluates thoughts and assigns priority scores
   */
  evaluate(thoughts: any) {
    const scored: any[] = [];
    const opportunities = thoughts.opportunities || [];

    for (const item of opportunities) {
      let score = 0;

      // Rule-based base scoring
      if (item.type === 'airdrop') {
        score += 70;
      } else if (item.type === 'signal') {
        score += 50;
      } else if (item.type === 'market_data') {
        score += 40;
      } else if (item.type === 'message') {
        score += 20;
      }

      // Urgency boost
      if (item.urgency === 'high') {
        score += 20;
      } else if (item.urgency === 'medium') {
        score += 10;
      }

      // Source prestige scoring
      if (item.source?.includes('Binance')) {
        score += 15;
      } else if (item.source === 'alpha_stream') {
        score += 25;
      }

      // Confidence factor
      if (item.confidence) {
        score = (score + item.confidence) / 2;
      }

      scored.push({ ...item, score: Math.min(100, score) });
    }

    return scored;
  }
}
