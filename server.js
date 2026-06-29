require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');

const { createSession, getSession, updateSession, deleteSession } = require('./services/sessionStore');
const { detectCountryFromBin, getBin } = require('./services/binLookup');
const { generateCustomerDetails } = require('./services/gemini');
const { addPayment } = require('./services/paymentStore');
const orchestrator = require('./gateways');
const payone = require('./gateways/payone');
const paytabs = require('./gateways/paytabs');
const payzaty = require('./gateways/payzaty');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function getBaseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAutoSubmitPage(action, fields) {
  const inputs = Object.entries(fields)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('\n    ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connecting to ${escapeHtml(action)}...</title>
  <meta http-equiv="Cache-Control" content="no-store">
  <style>
    body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0f172a; color: #e2e8f0; font-family: system-ui, -apple-system, sans-serif; }
    .spinner { width: 48px; height: 48px; border: 4px solid rgba(255,255,255,0.1); border-left-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 16px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    p { margin: 0; opacity: 0.8; }
  </style>
</head>
<body onload="document.forms[0].submit()">
  <div class="spinner"></div>
  <p>Connecting to ${escapeHtml(action)} securely...</p>
  <form action="${escapeHtml(fields.RedirectURL || action)}" method="POST" style="display:none">
    ${inputs}
  </form>
</body>
</html>`;
}

function redirectForAction(res, action) {
  if (action.type === 'done') {
    if (action.success) {
      return res.redirect(`/result.html?status=success&gateway=${encodeURIComponent(action.gateway)}`);
    }
    return res.redirect(`/result.html?status=failed&message=${encodeURIComponent(action.message || '')}`);
  }
  if (action.type === 'redirect') {
    return res.redirect(`/redirecting.html?url=${encodeURIComponent(action.url)}&sessionId=${action.sessionId || ''}`);
  }
  if (action.type === 'submit') {
    return res.redirect(action.submitUrl);
  }
  if (action.type === 'otp') {
    return res.redirect(`/otp.html?sessionId=${action.sessionId || ''}&gateway=${encodeURIComponent(action.gateway)}`);
  }
  return res.redirect('/result.html?status=failed');
}

// Start a new payment attempt.
app.post('/api/start-payment', async (req, res) => {
  try {
    const { amount, card } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'A valid amount greater than 0 is required.' });
    }
    if (!card || !card.number || !card.expMonth || !card.expYear || !card.cvv) {
      return res.status(400).json({ error: 'Card number, expiry month/year and CVV are required.' });
    }

    const bin = getBin(card.number);
    const country = await detectCountryFromBin(bin);
    const customer = await generateCustomerDetails(country);
    const reference = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const baseUrl = getBaseUrl(req);

    const sessionData = {
      amount,
      card,
      country,
      customer,
      reference,
      gatewayIndex: 0,
      gatewayRefs: {},
      gatewayResults: {},
      status: 'pending',
      baseUrl,
      clientIp: req.ip || req.connection.remoteAddress || '127.0.0.1',
    };

    const sessionId = await createSession(sessionData);
    sessionData.id = sessionId;
    await updateSession(sessionId, sessionData);

    await addPayment({
      reference,
      amount: parseFloat(amount),
      currency: 'SAR',
      country,
      cardBin: bin,
      cardLast4: card.number.slice(-4),
      cardHolder: card.holder || customer.fullName,
      status: 'pending',
      gateway: null,
      message: null,
      createdAt: new Date().toISOString(),
    });

    const action = await orchestrator.continueSession(sessionData);
    action.sessionId = sessionId;
    await updateSession(sessionId, sessionData);

    res.json(action);
  } catch (err) {
    console.error('[StartPayment] Error:', err.message);
    res.status(500).json({ error: 'Could not start payment. Please try again.' });
  }
});

// Poll session status (used after redirects or long processing).
app.get('/api/session/:sessionId/status', async (req, res) => {
  try {
    const session = await getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    if (session.status === 'success') {
      return res.json({ type: 'done', success: true, gateway: session.successGateway });
    }
    if (session.status === 'failed') {
      return res.json({ type: 'done', success: false });
    }

    return res.json({ type: 'processing', gatewayIndex: session.gatewayIndex });
  } catch (err) {
    console.error('[SessionStatus] Error:', err.message);
    res.status(500).json({ error: 'Could not read session status.' });
  }
});

// Render an auto-submit page for gateways that need a browser POST (Payone direct post).
app.get('/api/auto-submit/:gateway', async (req, res) => {
  try {
    const { gateway } = req.params;
    const { sessionId } = req.query;
    const session = await getSession(sessionId);
    if (!session) {
      return res.status(404).send('Session not found.');
    }

    if (gateway !== 'payone') {
      return res.status(400).send('Auto-submit is only supported for Payone.');
    }

    const result = payone.initiate(session, session.baseUrl);
    if (result.status !== 'submit') {
      return res.status(400).send(`Unexpected Payone result: ${result.status}`);
    }

    res.set('Cache-Control', 'no-store');
    res.send(renderAutoSubmitPage('Payone', result.fields));
  } catch (err) {
    console.error('[AutoSubmit] Error:', err.message);
    res.status(500).send('Could not prepare payment page.');
  }
});

// Payone callback.
app.post('/api/callback/payone', async (req, res) => {
  try {
    const session = await getSession(req.query.sessionId);
    if (!session) {
      return res.status(404).send('Session not found.');
    }

    const callbackResult = payone.handleCallback(req.body);
    const action = await orchestrator.resume(session, 'payone', callbackResult);
    action.sessionId = session.id;
    await updateSession(session.id, session);

    return redirectForAction(res, action);
  } catch (err) {
    console.error('[PayoneCallback] Error:', err.message);
    res.redirect('/result.html?status=failed');
  }
});

// PayTabs return/callback.
app.all('/api/callback/paytabs', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    const session = sessionId ? await getSession(sessionId) : null;
    if (!session) {
      // Webhook without session ID is logged and acknowledged.
      console.log('[PayTabsCallback] Webhook received without session:', req.body);
      return res.status(200).send('OK');
    }

    const data = req.method === 'POST' ? req.body : req.query;
    const callbackResult = await paytabs.handleCallback(data, session);
    const action = await orchestrator.resume(session, 'paytabs', callbackResult);
    action.sessionId = session.id;
    await updateSession(session.id, session);

    if (req.method === 'POST') {
      return res.status(200).send('OK');
    }
    return redirectForAction(res, action);
  } catch (err) {
    console.error('[PayTabsCallback] Error:', err.message);
    res.redirect('/result.html?status=failed');
  }
});

// Payzaty response_url callback.
app.get('/api/callback/payzaty', async (req, res) => {
  try {
    const session = await getSession(req.query.sessionId);
    if (!session) {
      return res.status(404).send('Session not found.');
    }

    const callbackResult = await payzaty.handleCallback(req.query, session);
    const action = await orchestrator.resume(session, 'payzaty', callbackResult);
    action.sessionId = session.id;
    await updateSession(session.id, session);

    return redirectForAction(res, action);
  } catch (err) {
    console.error('[PayzatyCallback] Error:', err.message);
    res.redirect('/result.html?status=failed');
  }
});

// Generic OTP submission fallback.
app.post('/api/submit-otp', async (req, res) => {
  res.status(501).json({ error: 'OTP submission is not implemented for the current gateways.' });
});

// Dashboard routes.
const { getStats, listPayments } = require('./services/paymentStore');

app.get('/dashboard', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/dashboard/stats', async (_req, res) => {
  try {
    const stats = await getStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('[DashboardStats] Error:', err.message);
    res.status(500).json({ error: 'Could not load dashboard stats.' });
  }
});

app.get('/api/dashboard/payments', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const payments = await listPayments(limit);
    res.json({ success: true, payments });
  } catch (err) {
    console.error('[DashboardPayments] Error:', err.message);
    res.status(500).json({ error: 'Could not load payments.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`\n  🚀 Unified Payment server running on port ${PORT}\n`);
  });
}

module.exports = app;
