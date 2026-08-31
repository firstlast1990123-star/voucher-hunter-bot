const PAYOS_CLIENT_ID = process.env.PAYOS_CLIENT_ID || 'b0d73c0a-3a2e-49d1-a60c-4729eb5ecf60';
const PAYOS_API_KEY = process.env.PAYOS_API_KEY || '0cb17d98-fd4b-48e3-9f10-40479f1b504e';

const PAYOS_CHECK_URL = 'https://api-merchant.payos.vn/v2/payment-requests';

const handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const orderCode = event.queryStringParameters ? event.queryStringParameters.orderCode : null;

  if (!orderCode) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ success: false, error: 'Missing orderCode parameter' })
    };
  }

  try {
    const response = await fetch(`${PAYOS_CHECK_URL}/${orderCode}`, {
      method: 'GET',
      headers: {
        'x-client-id': PAYOS_CLIENT_ID,
        'x-api-key': PAYOS_API_KEY,
        'Content-Type': 'application/json'
      }
    });

    const resData = await response.json();

    if (resData.code === '00' && resData.data) {
      const isPaid = resData.data.status === 'PAID';
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          status: resData.data.status,
          isPaid,
          orderCode: resData.data.orderCode,
          amount: resData.data.amount,
          amountPaid: resData.data.amountPaid,
          data: resData.data
        })
      };
    } else {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: false,
          status: 'PENDING',
          isPaid: false,
          error: resData.desc || 'Transaction pending'
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

module.exports = async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  };
  const result = await handler(event, {});
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
  }
  res.status(result.statusCode || 200).send(result.body);
};
