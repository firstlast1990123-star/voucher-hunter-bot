const crypto = require('crypto');

const PAYOS_CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY || '06590c9ee8673aebf7c219a73f3caebf202e846b995dc20f22681c6a6bb70318';

function verifyWebhookSignature(webhookBody, checksumKey) {
  if (!webhookBody || !webhookBody.signature || !webhookBody.data) return false;
  
  const data = webhookBody.data;
  const sortedKeys = Object.keys(data).sort();
  const signatureData = sortedKeys
    .map(key => `${key}=${data[key] !== null && data[key] !== undefined ? data[key] : ''}`)
    .join('&');

  const calculatedSignature = crypto
    .createHmac('sha256', checksumKey)
    .update(signatureData)
    .digest('hex');

  return calculatedSignature === webhookBody.signature;
}

exports.handler = async (event, context) => {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const payload = JSON.parse(event.body || '{}');

    // Confirm PayOS Webhook configuration test
    if (payload.data && payload.data.orderCode === 123) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, message: 'Webhook test received' })
      };
    }

    const isValid = verifyWebhookSignature(payload, PAYOS_CHECKSUM_KEY);

    if (isValid && payload.data && payload.code === '00') {
      console.log(`[PayOS Webhook] Payment confirmed for orderCode ${payload.data.orderCode}`);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, orderCode: payload.data.orderCode, status: 'PAID' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Webhook processed' })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
