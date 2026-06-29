const payone = require('./payone');
const paytabs = require('./paytabs');
const payzaty = require('./payzaty');
const { updatePayment } = require('../services/paymentStore');

const GATEWAYS = [
  { name: 'payone', adapter: payone },
  { name: 'paytabs', adapter: paytabs },
  { name: 'payzaty', adapter: payzaty },
];

async function updateRecord(session, updates) {
  if (session?.reference) {
    try {
      await updatePayment(session.reference, updates);
    } catch (err) {
      console.error('[Orchestrator] Failed to update payment record:', err.message);
    }
  }
}

async function continueSession(session) {
  const baseUrl = session.baseUrl;

  while (session.gatewayIndex < GATEWAYS.length) {
    const gw = GATEWAYS[session.gatewayIndex];
    const result = await gw.adapter.initiate(session, baseUrl);

    if (result.transactionRef) {
      session.gatewayRefs = session.gatewayRefs || {};
      session.gatewayRefs[gw.name] = result.transactionRef;
    }

    await updateRecord(session, { gateway: gw.name, message: result.message || null });

    if (result.status === 'success') {
      session.status = 'success';
      session.successGateway = gw.name;
      session.finalResult = result;
      await updateRecord(session, { status: 'success', gateway: gw.name, message: result.message || 'Approved' });
      return { type: 'done', success: true, gateway: gw.name, result };
    }

    if (result.status === 'redirect' || result.status === 'submit' || result.status === 'otp') {
      session.awaitingGateway = session.gatewayIndex;
      await updateRecord(session, { status: 'pending', gateway: gw.name, message: 'Awaiting customer authentication' });
      if (result.status === 'redirect') {
        return { type: 'redirect', gateway: gw.name, url: result.redirectUrl };
      }
      if (result.status === 'submit') {
        return { type: 'submit', gateway: gw.name, submitUrl: `/api/auto-submit/${gw.name}?sessionId=${session.id}` };
      }
      return { type: 'otp', gateway: gw.name };
    }

    // failed or error: record and try next gateway
    session.gatewayResults = session.gatewayResults || {};
    session.gatewayResults[gw.name] = result;
    session.gatewayIndex += 1;
  }

  session.status = 'failed';
  await updateRecord(session, { status: 'failed', message: 'All payment gateways failed. Please try another card.' });
  return { type: 'done', success: false, message: 'All payment gateways failed. Please try another card.' };
}

async function resume(session, gatewayName, callbackResult) {
  const index = GATEWAYS.findIndex((g) => g.name === gatewayName);
  if (index === -1) {
    return { type: 'done', success: false, message: 'Unknown gateway.' };
  }

  session.awaitingGateway = null;
  session.gatewayResults = session.gatewayResults || {};
  session.gatewayResults[gatewayName] = callbackResult;

  await updateRecord(session, { gateway: gatewayName, message: callbackResult.message || null });

  if (callbackResult.status === 'success') {
    session.status = 'success';
    session.successGateway = gatewayName;
    session.finalResult = callbackResult;
    await updateRecord(session, { status: 'success', gateway: gatewayName, message: callbackResult.message || 'Approved' });
    return { type: 'done', success: true, gateway: gatewayName, result: callbackResult };
  }

  // Advance past the failed gateway and continue.
  session.gatewayIndex = index + 1;
  return continueSession(session);
}

module.exports = { continueSession, resume, GATEWAYS };
