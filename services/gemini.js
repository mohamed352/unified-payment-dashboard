const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-flash-latest';

const FALLBACKS = {
  SA: {
    fullName: 'Ahmed Al-Rashid',
    email: 'ahmed.alrashid@example.com',
    phone: '+966501234567',
    street: 'King Fahd Road, Al Olaya',
    city: 'Riyadh',
    state: 'Riyadh',
    zip: '12221',
  },
  EG: {
    fullName: 'Mohamed Hassan',
    email: 'mohamed.hassan@example.com',
    phone: '+201012345678',
    street: '26th July Street, Zamalek',
    city: 'Cairo',
    state: 'Cairo',
    zip: '11511',
  },
  AE: {
    fullName: 'Khalid Al-Mansoori',
    email: 'khalid.mansoori@example.com',
    phone: '+971501234567',
    street: 'Sheikh Zayed Road, Dubai Marina',
    city: 'Dubai',
    state: 'Dubai',
    zip: '00000',
  },
  US: {
    fullName: 'John Smith',
    email: 'john.smith@example.com',
    phone: '+13125551234',
    street: '123 Main Street',
    city: 'Chicago',
    state: 'Illinois',
    zip: '60601',
  },
  GB: {
    fullName: 'James Brown',
    email: 'james.brown@example.com',
    phone: '+447400123456',
    street: '10 Downing Street',
    city: 'London',
    state: 'England',
    zip: 'SW1A 2AA',
  },
};

function getFallback(countryCode) {
  return FALLBACKS[countryCode] || FALLBACKS.SA;
}

function sanitizeDetails(details) {
  return {
    fullName: details.fullName || details.name || 'Customer Name',
    email: details.email || 'customer@example.com',
    phone: String(details.phone || '').replace(/\s/g, ''),
    street: details.street || details.street1 || 'Main Street',
    city: details.city || 'City',
    state: details.state || details.city || 'State',
    zip: String(details.zip || '00000'),
  };
}

async function generateCustomerDetails(countryCode) {
  if (!GEMINI_API_KEY) {
    console.warn('[Gemini] No API key configured; using fallback customer details.');
    return sanitizeDetails(getFallback(countryCode));
  }

  const prompt = `Generate realistic billing details for an online card payment from country ${countryCode}. The details should look real so the bank fraud filter does not reject the transaction. Return ONLY a valid JSON object with these fields: fullName, email, phone (with country code, no spaces), street, city, state, zip. Do not include any explanation or markdown formatting.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.warn('[Gemini] API error:', response.status, errorText);
      return sanitizeDetails(getFallback(countryCode));
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let jsonText = text.replace(/```json|```/g, '').trim();
    const start = jsonText.indexOf('{');
    const end = jsonText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      jsonText = jsonText.slice(start, end + 1);
    }

    const parsed = JSON.parse(jsonText);
    return sanitizeDetails(parsed);
  } catch (err) {
    console.warn('[Gemini] Generation failed:', err.message);
    return sanitizeDetails(getFallback(countryCode));
  }
}

module.exports = { generateCustomerDetails };
