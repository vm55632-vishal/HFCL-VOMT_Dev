import { RC_LIMIT_PER_VEHICLE, rcLimitsFromVehicles, rupeesInWords } from './money';

describe('rupeesInWords', () => {
  it('uses the Indian lakh / crore system', () => {
    expect(rupeesInWords(500_000)).toBe('Five Lakh Rupees Only');
    expect(rupeesInWords(1_500_000)).toBe('Fifteen Lakh Rupees Only');
    expect(rupeesInWords(12_345_678)).toBe(
      'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only',
    );
    expect(rupeesInWords(10_000_000)).toBe('One Crore Rupees Only');
  });
  it('handles zero and small amounts', () => {
    expect(rupeesInWords(0)).toBe('Zero Rupees Only');
    expect(rupeesInWords(19)).toBe('Nineteen Rupees Only');
    expect(rupeesInWords(100)).toBe('One Hundred Rupees Only');
  });
  it('returns an empty string for invalid input', () => {
    expect(rupeesInWords(-1)).toBe('');
    expect(rupeesInWords(Number.NaN)).toBe('');
  });
});

describe('rcLimitsFromVehicles', () => {
  it('multiplies vehicles by the per-vehicle limit', () => {
    expect(RC_LIMIT_PER_VEHICLE).toBe(500_000);
    expect(rcLimitsFromVehicles(3)).toEqual({
      sanctionLoanLimit: 1_500_000,
      creditLimitFigures: 1_500_000,
      creditLimitWords: 'Fifteen Lakh Rupees Only',
    });
  });
  it('gives nothing for a missing or invalid count', () => {
    const none = { sanctionLoanLimit: null, creditLimitFigures: null, creditLimitWords: null };
    expect(rcLimitsFromVehicles(null)).toEqual(none);
    expect(rcLimitsFromVehicles(undefined)).toEqual(none);
    expect(rcLimitsFromVehicles(-2)).toEqual(none);
    expect(rcLimitsFromVehicles(1.5)).toEqual(none);
  });
});
