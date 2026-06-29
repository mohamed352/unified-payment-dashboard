const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'SA';

// Tiny fallback map for well-known test BINs so we are not fully dependent on external APIs.
const KNOWN_BINS = {
  '411111': 'US',
  '401200': 'US',
  '424242': 'US',
  '400005': 'US',
  '555555': 'US',
  '510510': 'US',
  '378282': 'US',
  '484783': 'SA',
  '446404': 'SA',
  '440647': 'SA',
  '440795': 'SA',
  '457998': 'SA',
  '968201': 'SA',
  '968203': 'SA',
};

async function detectCountryFromBin(bin) {
  // 1. Try a free BIN lookup service.
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`https://lookup.binlist.net/${bin}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);
    if (response.ok) {
      const data = await response.json();
      const country = data?.country?.alpha2;
      if (country) return country;
    }
  } catch (err) {
    console.warn('[BIN] lookup.binlist.net failed:', err.message);
  }

  // 2. Known local map.
  if (KNOWN_BINS[bin]) return KNOWN_BINS[bin];
  for (const prefix of Object.keys(KNOWN_BINS)) {
    if (bin.startsWith(prefix)) return KNOWN_BINS[prefix];
  }

  // 3. Default.
  return DEFAULT_COUNTRY;
}

function getBin(cardNumber) {
  const cleaned = String(cardNumber).replace(/\D/g, '');
  return cleaned.slice(0, 6);
}

module.exports = { detectCountryFromBin, getBin };
