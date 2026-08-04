export interface TierPoint {
  views: number;
  price: number;
}

export const DEFAULT_TIERS: TierPoint[] = [
  { views: 100000, price: 430000 },
  { views: 200000, price: 780000 },
  { views: 500000, price: 1830000 },
  { views: 1000000, price: 3330000 },
  { views: 2000000, price: 6405000 },
  { views: 5000000, price: 15000000 },
  { views: 10000000, price: 28500000 },
  { views: 20000000, price: 54000000 },
  { views: 40000000, price: 100000000 },
];

export function computePriceForViews(tiers: TierPoint[], views: number): number {
  if (tiers.length === 0) return 0;
  if (views <= tiers[0].views) return tiers[0].price;
  for (let i = 1; i < tiers.length; i++) {
    const prev = tiers[i - 1];
    const curr = tiers[i];
    if (views <= curr.views) {
      const t = (views - prev.views) / (curr.views - prev.views);
      return Math.round(prev.price + (curr.price - prev.price) * t);
    }
  }
  const prev = tiers[tiers.length - 2];
  const last = tiers[tiers.length - 1];
  const slope = (last.price - prev.price) / (last.views - prev.views);
  return Math.round(last.price + (views - last.views) * slope);
}
