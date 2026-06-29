const ACCOUNT_NO = process.env.PAYZATY_ACCOUNT_NO;
const SECRET_KEY = process.env.PAYZATY_SECRET_KEY;
const PAYZATY_ENV = (process.env.PAYZATY_ENV || 'production').toLowerCase();

const PAYZATY_BASE_URL = PAYZATY_ENV === 'sandbox'
  ? 'https://api.sandbox.payzaty.com'
  : 'https://api.payzaty.com';

function getAuthHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-AccountNo': ACCOUNT_NO,
    'X-AccountID': ACCOUNT_NO,
    'X-SecretKey': SECRET_KEY,
  };
}

function getConfigError() {
  if (!ACCOUNT_NO || !SECRET_KEY) {
    return 'Payzaty account/secret key are not configured.';
  }
  return null;
}

function isSuccessful(checkout) {
  if (checkout && typeof checkout.paid === 'boolean') return checkout.paid;
  const status = String(checkout?.status || '').toLowerCase();
  return ['paid', 'captured', 'authorised', 'authorized', 'transferred'].includes(status);
}

async function initiate(session, baseUrl) {
  const configError = getConfigError();
  if (configError) {
    return { status: 'error', gateway: 'payzaty', message: configError };
  }

  const { amount, card, customer, reference } = session;
  const numericAmount = parseFloat(amount);

  const requestBody = {
    amount: numericAmount,
    currency: 'SAR',
    payment_method: 'Card',
    reference,
    customer: {
      name: customer.fullName,
      email: customer.email,
      phone: customer.phone,
    },
    card: {
      name: card.holder || customer.fullName,
      number: card.number,
      expiry: {
        month: String(card.expMonth).padStart(2, '0'),
        year: String(card.expYear),
      },
      cvv: card.cvv,
    },
    response_url: `${baseUrl}/api/callback/payzaty?sessionId=${session.id}`,
    cancel_url: `${baseUrl}/api/callback/payzaty?sessionId=${session.id}&state=cancelled`,
  };

  try {
    const response = await fetch(`${PAYZATY_BASE_URL}/checkout/pay`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    let data = {};
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    if (!response.ok || data.error) {
      return {
        status: 'failed',
        gateway: 'payzaty',
        message: data.error_text || data.error || `Payzaty HTTP ${response.status}`,
        raw: data,
      };
    }

    if (isSuccessful(data)) {
      return {
        status: 'success',
        gateway: 'payzaty',
        transactionRef: data.id || data.checkout_id,
        raw: data,
      };
    }

    if (data.checkout_url || data.redirect_url) {
      return {
        status: 'redirect',
        gateway: 'payzaty',
        redirectUrl: data.checkout_url || data.redirect_url,
        transactionRef: data.id || data.checkout_id,
        raw: data,
      };
    }

    return {
      status: 'failed',
      gateway: 'payzaty',
      message: data.status || 'Payment not completed.',
      raw: data,
    };
  } catch (err) {
    return { status: 'error', gateway: 'payzaty', message: err.message };
  }
}

async function handleCallback(query, session) {
  const checkoutId = query.checkout_id || query.id || session?.gatewayRefs?.payzaty;
  if (!checkoutId) {
    return { status: 'failed', gateway: 'payzaty', message: 'Missing Payzaty checkout id.' };
  }

  try {
    const response = await fetch(`${PAYZATY_BASE_URL}/checkout/${checkoutId}`, {
      method: 'GET',
      headers: getAuthHeaders(),
    });

    const data = await response.json();
    if (!response.ok) {
      return { status: 'failed', gateway: 'payzaty', message: data.error_text || 'Status query failed.', raw: data };
    }

    return {
      status: isSuccessful(data) ? 'success' : 'failed',
      gateway: 'payzaty',
      transactionRef: data.id || checkoutId,
      raw: data,
    };
  } catch (err) {
    return { status: 'error', gateway: 'payzaty', message: err.message };
  }
}

module.exports = { initiate, handleCallback };
