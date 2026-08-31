const crypto = require('crypto');

// Credentials provided for PayOS Integration
const PAYOS_CLIENT_ID = process.env.PAYOS_CLIENT_ID || 'b0d73c0a-3a2e-49d1-a60c-4729eb5ecf60';
const PAYOS_API_KEY = process.env.PAYOS_API_KEY || '0cb17d98-fd4b-48e3-9f10-40479f1b504e';
const PAYOS_CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY || '06590c9ee8673aebf7c219a73f3caebf202e846b995dc20f22681c6a6bb70318';

const PAYOS_API_URL = 'https://api-merchant.payos.vn/v2/payment-requests';

/**
 * Generate HMAC SHA256 signature for PayOS request payload
 */
function generatePayOSSignature(data, checksumKey) {
  const sortedKeys = Object.keys(data).sort();
  const signatureData = sortedKeys
    .map(key => `${key}=${data[key]}`)
    .join('&');

  return crypto
    .createHmac('sha256', checksumKey)
    .update(signatureData)
    .digest('hex');
}

exports.handler = async (event, context) => {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  try {
    let reqBody = {};
    if (event.body) {
      try {
        reqBody = JSON.parse(event.body);
      } catch (e) {}
    }

    // Generate unique numeric orderCode (must fit within safe JS integer limit)
    const orderCode = Number(String(Date.now()).slice(-9)) + Math.floor(Math.random() * 1000);
    const amount = 10000;
    
    // Description max 25 characters, alphanumeric & spaces
    const memoId = reqBody.userId || Math.floor(1000 + Math.random() * 9000);
    const description = `VIPPRO ${memoId}`.slice(0, 25);
    
    const host = event.headers.host ? `https://${event.headers.host}` : 'https://vouchermyproxmax.netlify.app';
    const returnUrl = reqBody.returnUrl || `${host}/?payment=success`;
    const cancelUrl = reqBody.cancelUrl || `${host}/?payment=cancelled`;

    const signData = {
      amount,
      cancelUrl,
      description,
      orderCode,
      returnUrl
    };

    const signature = generatePayOSSignature(signData, PAYOS_CHECKSUM_KEY);

    const payload = {
      ...signData,
      signature
    };

    const payosResponse = await fetch(PAYOS_API_URL, {
      method: 'POST',
      headers: {
        'x-client-id': PAYOS_CLIENT_ID,
        'x-api-key': PAYOS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const resData = await payosResponse.json();

    if (resData.code === '00' && resData.data) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          orderCode,
          amount,
          description,
          accountName: resData.data.accountName,
          accountNumber: resData.data.accountNumber,
          bin: resData.data.bin,
          checkoutUrl: resData.data.checkoutUrl,
          qrCode: resData.data.qrCode,
          vietQrUrl: resData.data.qrCode
            ? `https://img.vietqr.io/image/${resData.data.bin}-${resData.data.accountNumber}-compact.png?amount=${amount}&addInfo=${encodeURIComponent(description)}&accountName=${encodeURIComponent(resData.data.accountName)}`
            : null,
          payosData: resData.data
        })
      };
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: resData.desc || 'PayOS Error',
          code: resData.code,
          raw: resData
        })
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
