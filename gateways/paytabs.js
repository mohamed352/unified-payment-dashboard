const PROFILE_ID = process.env.PAYTABS_PROFILE_ID;
const SERVER_KEY = process.env.PAYTABS_SERVER_KEY;
const REGION = (process.env.PAYTABS_REGION || 'sa').toLowerCase();

const REGION_BASE_URLS = {
  sa: 'https://secure.paytabs.sa',
  egypt: 'https://secure-egypt.paytabs.com',
  uae: 'https://secure-uae.paytabs.com',
  global: 'https://secure-global.paytabs.com',
};

const BASE_URL = REGION_BASE_URLS[REGION] || REGION_BASE_URLS.sa;

function getConfigError() {
  if (!PROFILE_ID || !SERVER_KEY) {
    return 'PayTabs profile/server key are not configured.';
  }
  return null;
}

function isSuccessful(paymentResult) {
  if (!paymentResult) return false;
  const status = String(paymentResult.response_status || '').toUpperCase();
  return status === 'A' || status === 'P';
}

async function initiate(session, baseUrl) {
  const configError = getConfigError();
  if (configError) {
    return { status: 'error', gateway: 'paytabs', message: configError };
  }

  const { amount, card, customer, reference } = session;
  const numericAmount = parseFloat(amount);

  const requestBody = {
    profile_id: PROFILE_ID,
    tran_type: 'sale',
    tran_class: 'ecom',
    cart_id: reference,
    cart_description: `Order ${reference}`,
    cart_currency: 'SAR',
    cart_amount: numericAmount,
    return: `${baseUrl}/api/callback/paytabs?sessionId=${session.id}`,
    callback: `${baseUrl}/api/callback/paytabs`,
    customer_details: {
      name: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      street1: customer.street,
      city: customer.city,
      state: customer.state,
      country: session.country || 'SA',
      zip: customer.zip,
      ip: session.clientIp || '127.0.0.1',
    },
    shipping_details: {
      name: customer.fullName,
      email: customer.email,
      phone: customer.phone,
      street1: customer.street,
      city: customer.city,
      state: customer.state,
      country: session.country || 'SA',
      zip: customer.zip,
      ip: session.clientIp || '127.0.0.1',
    },
    hide_shipping: true,
    paypage_lang: 'en',
    card_details: {
      pan: card.number,
      cvv: card.cvv,
      expiry_month: parseInt(card.expMonth, 10),
      expiry_year: parseInt(card.expYear, 10),
    },
  };

  try {
    const response = await fetch(`${BASE_URL}/payment/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: SERVER_KEY,
      },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    let data = {};
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    if (!response.ok || data.status === 'error') {
      return {
        status: 'failed',
        gateway: 'paytabs',
        message: data.message || data.error || `PayTabs HTTP ${response.status}`,
        raw: data,
      };
    }

    if (data.redirect_url) {
      return {
        status: 'redirect',
        gateway: 'paytabs',
        redirectUrl: data.redirect_url,
        transactionRef: data.tran_ref,
        raw: data,
      };
    }

    if (isSuccessful(data.payment_result)) {
      return {
        status: 'success',
        gateway: 'paytabs',
        transactionRef: data.tran_ref,
        raw: data,
      };
    }

    return {
      status: 'failed',
      gateway: 'paytabs',
      message: data.payment_result?.response_message || 'Payment declined by PayTabs.',
      raw: data,
    };
  } catch (err) {
    return { status: 'error', gateway: 'paytabs', message: err.message };
  }
}

async function handleCallback(queryOrBody, session) {
  // Prefer the server-to-server POST callback body if available.
  const body = queryOrBody || {};
  const paymentResult = body.payment_result;

  if (paymentResult) {
    return {
      status: isSuccessful(paymentResult) ? 'success' : 'failed',
      gateway: 'paytabs',
      transactionRef: body.tran_ref,
      message: paymentResult.response_message,
      raw: body,
    };
  }

  // Otherwise query PayTabs for the latest status using stored tran_ref.
  const tranRef = session?.gatewayRefs?.paytabs;
  if (!tranRef) {
    return { status: 'failed', gateway: 'paytabs', message: 'Missing PayTabs transaction reference.' };
  }

  try {
    const response = await fetch(`${BASE_URL}/payment/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: SERVER_KEY,
      },
      body: JSON.stringify({ profile_id: PROFILE_ID, tran_ref: tranRef }),
    });

    const data = await response.json();
    if (!response.ok || data.status === 'error') {
      return { status: 'failed', gateway: 'paytabs', message: data.message || 'Status query failed.', raw: data };
    }

    return {
      status: isSuccessful(data.payment_result) ? 'success' : 'failed',
      gateway: 'paytabs',
      transactionRef: data.tran_ref,
      message: data.payment_result?.response_message,
      raw: data,
    };
  } catch (err) {
    return { status: 'error', gateway: 'paytabs', message: err.message };
  }
}

module.exports = { initiate, handleCallback };
