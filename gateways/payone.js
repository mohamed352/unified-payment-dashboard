const crypto = require('crypto');

const MERCHANT_ID = process.env.PAYONE_MERCHANT_ID;
const AUTH_TOKEN = process.env.PAYONE_AUTH_TOKEN;
const PAYMENT_URL = process.env.PAYONE_PAYMENT_URL;
const VERSION = process.env.PAYONE_VERSION || '2.0';
const ITEM_ID = process.env.PAYONE_ITEM_ID || '1';
const CURRENCY_ISO = process.env.PAYONE_CURRENCY_ISO || '682';
const CHANNEL = process.env.PAYONE_CHANNEL || '0';
const THEME_ID = process.env.PAYONE_THEME_ID || 'default';

function buildSecureHash(hashData) {
  const sortedKeys = Object.keys(hashData).sort();
  let hashString = AUTH_TOKEN;
  for (const key of sortedKeys) {
    hashString += hashData[key];
  }
  return crypto.createHash('sha256').update(hashString).digest('hex');
}

function getConfigError() {
  if (!MERCHANT_ID || !AUTH_TOKEN || !PAYMENT_URL) {
    return 'Payone direct-post credentials are not configured.';
  }
  return null;
}

function initiate(session, baseUrl) {
  const configError = getConfigError();
  if (configError) {
    return { status: 'error', gateway: 'payone', message: configError };
  }

  const { amount, card, customer, reference } = session;
  const transactionId = reference;
  const amountInSmallestUnit = Math.round(parseFloat(amount) * 100);
  const responseBackUrl = `${baseUrl}/api/callback/payone?sessionId=${session.id}`;
  const description = `Order ${reference}`;

  const hashData = {
    TransactionID: transactionId,
    MerchantID: MERCHANT_ID,
    Amount: String(amountInSmallestUnit),
    CurrencyISOCode: String(CURRENCY_ISO),
    MessageID: '1',
    Quantity: '1',
    Channel: String(CHANNEL),
    ThemeID: THEME_ID,
    ResponseBackURL: responseBackUrl,
    Version: VERSION,
    ItemID: ITEM_ID,
    PaymentDescription: encodeURIComponent(description),
    GenerateToken: 'no',
    PaymentMethod: '1',
  };

  const secureHash = buildSecureHash(hashData);

  const fields = {
    TransactionID: transactionId,
    MerchantID: MERCHANT_ID,
    Amount: String(amountInSmallestUnit),
    CurrencyISOCode: String(CURRENCY_ISO),
    MessageID: '1',
    Quantity: '1',
    Channel: String(CHANNEL),
    ThemeID: THEME_ID,
    ItemID: ITEM_ID,
    ResponseBackURL: responseBackUrl,
    Version: VERSION,
    PaymentDescription: description,
    GenerateToken: 'no',
    PaymentMethod: '1',
    AllowToken: 'no',
    CardNumber: card.number,
    ExpiryDateYear: String(card.expYear).slice(-2),
    ExpiryDateMonth: String(card.expMonth).padStart(2, '0'),
    SecurityCode: card.cvv,
    CardHolderName: card.holder || customer.fullName,
    RedirectURL: PAYMENT_URL,
    SecureHash: secureHash,
  };

  return {
    status: 'submit',
    gateway: 'payone',
    action: PAYMENT_URL,
    method: 'POST',
    fields,
  };
}

function handleCallback(body) {
  const statusCode = body?.Response_StatusCode;
  const success = statusCode === '00000';
  const transactionRef = body?.Response_TransactionID || body?.Response_TransactionId;

  return {
    status: success ? 'success' : 'failed',
    gateway: 'payone',
    transactionRef,
    message: body?.Response_StatusDescription || body?.Response_GatewayStatusDescription,
    raw: body,
  };
}

module.exports = { initiate, handleCallback };
