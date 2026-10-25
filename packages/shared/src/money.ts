/** Sanctioned loan / credit limit per vehicle, in rupees. */
export const RC_LIMIT_PER_VEHICLE = 500_000;

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function words(n: number): string {
  if (n <= 0) return '';
  const rest = (r: number) => (r > 0 ? ` ${words(r)}` : '');
  if (n >= 10_000_000) return `${words(Math.floor(n / 10_000_000))} Crore${rest(n % 10_000_000)}`;
  if (n >= 100_000) return `${words(Math.floor(n / 100_000))} Lakh${rest(n % 100_000)}`;
  if (n >= 1_000) return `${words(Math.floor(n / 1_000))} Thousand${rest(n % 1_000)}`;
  if (n >= 100) return `${ONES[Math.floor(n / 100)] ?? ''} Hundred${rest(n % 100)}`;
  if (n >= 20) return `${TENS[Math.floor(n / 10)] ?? ''}${n % 10 ? ` ${ONES[n % 10] ?? ''}` : ''}`;
  return ONES[n] ?? '';
}

/** A whole-rupee amount in words, Indian style (lakh / crore): "Five Lakh Rupees Only". */
export function rupeesInWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '';
  const n = Math.floor(amount);
  return n === 0 ? 'Zero Rupees Only' : `${words(n)} Rupees Only`;
}

/**
 * Limits derived from the number of vehicles financed: the sanctioned loan limit and the credit
 * limit are both vehicles × {@link RC_LIMIT_PER_VEHICLE}. Returns nulls when the count is not a
 * whole number of at least zero. The server recomputes this on every save; it never trusts a
 * client-supplied figure.
 */
export function rcLimitsFromVehicles(vehicles: number | null | undefined): {
  sanctionLoanLimit: number | null;
  creditLimitFigures: number | null;
  creditLimitWords: string | null;
} {
  if (vehicles == null || !Number.isInteger(vehicles) || vehicles < 0) {
    return { sanctionLoanLimit: null, creditLimitFigures: null, creditLimitWords: null };
  }
  const amount = vehicles * RC_LIMIT_PER_VEHICLE;
  return {
    sanctionLoanLimit: amount,
    creditLimitFigures: amount,
    creditLimitWords: rupeesInWords(amount),
  };
}
