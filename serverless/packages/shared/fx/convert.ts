export type RatesMap = Map<string, number> & { _fallback?: Record<string, [string, number][]> };

function rateKey(yyyymm: string, currency: string): string {
  return `${yyyymm}|${currency.toUpperCase()}`;
}

export function resolveRate(rates: RatesMap, yyyymm: string, currency: string): number | null {
  const ccy = String(currency || 'USD').toUpperCase();
  if (ccy === 'USD') return 1;

  const direct = rates.get(rateKey(yyyymm, ccy));
  if (direct != null) return direct;

  const fb = rates._fallback?.[ccy];
  if (fb && yyyymm) {
    let best: number | null = null;
    for (const [mm, val] of fb) {
      if (mm <= yyyymm) best = val; else break;
    }
    return best;
  }
  return null;
}

export function convert(
  amount: number | null | undefined,
  fromCcy: string,
  toCcy: string,
  yyyymm: string,
  rates: RatesMap,
): { amount: number | null; rateUsed: { from: string; to: string; fxFrom: number; fxTo: number } | null } {
  if (amount == null) return { amount: null, rateUsed: null };
  const from = String(fromCcy || 'USD').toUpperCase();
  const to = String(toCcy || 'USD').toUpperCase();
  if (from === to) return { amount: Number(amount), rateUsed: { from, to, fxFrom: 1, fxTo: 1 } };

  const fxFrom = resolveRate(rates, yyyymm, from);
  const fxTo = resolveRate(rates, yyyymm, to);
  if (fxFrom == null || fxTo == null) return { amount: null, rateUsed: null };

  const amountUsd = from === 'USD' ? Number(amount) : Number(amount) / Number(fxFrom);
  const amountTo = to === 'USD' ? amountUsd : amountUsd * Number(fxTo);
  return { amount: amountTo, rateUsed: { from, to, fxFrom, fxTo } };
}

export function buildRatesMap(rows: Array<{ yyyymm: string; currency: string; usd_rate: number | string }>): RatesMap {
  const map: RatesMap = new Map();
  const fb: Record<string, [string, number][]> = {};
  for (const r of rows) {
    map.set(rateKey(r.yyyymm, r.currency), Number(r.usd_rate));
    const ccy = String(r.currency).toUpperCase();
    if (!fb[ccy]) fb[ccy] = [];
    fb[ccy].push([r.yyyymm, Number(r.usd_rate)]);
  }
  for (const ccy of Object.keys(fb)) fb[ccy].sort((a, b) => a[0].localeCompare(b[0]));
  map._fallback = fb;
  return map;
}
