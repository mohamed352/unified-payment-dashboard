const form = document.getElementById('paymentForm');
const formCard = document.getElementById('formCard');
const loadingCard = document.getElementById('loadingCard');
const loadingText = document.getElementById('loadingText');
const errorBox = document.getElementById('errorBox');

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add('visible');
  loadingCard.style.display = 'none';
  formCard.style.display = 'block';
}

function showLoading(text) {
  formCard.style.display = 'none';
  loadingCard.style.display = 'block';
  loadingText.textContent = text;
}

function cleanCardNumber(value) {
  return value.replace(/\D/g, '');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('visible');

  const amount = parseFloat(document.getElementById('amount').value);
  if (!amount || amount <= 0) {
    return showError('Please enter a valid amount.');
  }

  const cardNumber = cleanCardNumber(document.getElementById('cardNumber').value);
  const expMonth = document.getElementById('expMonth').value.trim();
  const expYear = document.getElementById('expYear').value.trim();
  const cvv = document.getElementById('cvv').value.trim();
  const holder = document.getElementById('cardHolder').value.trim();

  if (cardNumber.length < 13) return showError('Please enter a valid card number.');
  if (!expMonth || !expYear) return showError('Please enter expiry date.');
  if (!cvv) return showError('Please enter CVV.');

  showLoading('Checking card and starting payment...');

  try {
    const res = await fetch('/api/start-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount,
        card: { number: cardNumber, expMonth, expYear, cvv, holder },
      }),
    });

    const action = await res.json();
    if (!res.ok || action.error) {
      return showError(action.error || 'Payment could not be started.');
    }

    handleAction(action);
  } catch (err) {
    showError('Network error. Please check your connection and try again.');
  }
});

function handleAction(action) {
  if (action.type === 'done') {
    if (action.success) {
      window.location.href = `/result.html?status=success&gateway=${encodeURIComponent(action.gateway)}`;
    } else {
      window.location.href = `/result.html?status=failed&message=${encodeURIComponent(action.message || '')}`;
    }
    return;
  }

  if (action.type === 'redirect') {
    showLoading(`Redirecting to ${action.gateway} for 3-D Secure verification...`);
    window.location.href = action.url;
    return;
  }

  if (action.type === 'submit') {
    showLoading(`Connecting to ${action.gateway}...`);
    window.location.href = action.submitUrl;
    return;
  }

  if (action.type === 'otp') {
    window.location.href = `/otp.html?sessionId=${encodeURIComponent(action.sessionId)}&gateway=${encodeURIComponent(action.gateway)}`;
    return;
  }

  showError('Unexpected response from server. Please try again.');
}
