const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PAYOS_CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY || '06590c9ee8673aebf7c219a73f3caebf202e846b995dc20f22681c6a6bb70318';

let cachedDb = null;
async function getDB() {
  if (cachedDb) return cachedDb;
  const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');
  await client.connect();
  cachedDb = client.db(process.env.DB_NAME || 'voucher_db');
  return cachedDb;
}

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
      const orderCode = Number(payload.data.orderCode);
      console.log(`[PayOS Webhook] Payment confirmed for orderCode ${orderCode}`);
      
      try {
        const db = await getDB();
        const order = await db.collection('payment_orders').findOne({ _id: orderCode });
        
        if (order) {
          if (order.status !== 'paid') {
            const now = new Date();
            
            // 1. Cập nhật order thành paid
            await db.collection('payment_orders').updateOne(
              { _id: orderCode },
              { $set: { status: 'paid', paid_at: now.toISOString() } }
            );

            // 2. Cập nhật user thành VIP và cộng dồn thời hạn
            if (order.user_id) {
              const user = await db.collection('users').findOne({ _id: order.user_id });
              let currentVipExpiry = (user && user.vip_expired_at) ? new Date(user.vip_expired_at) : now;
              
              if (isNaN(currentVipExpiry.getTime()) || currentVipExpiry < now) {
                currentVipExpiry = new Date(now);
              }

              let daysToAdd = (order.plan === 'vip_monthly') ? 30 : 7;
              currentVipExpiry.setDate(currentVipExpiry.getDate() + daysToAdd);
              const resolvedPlan = (order.plan === 'vip_monthly') ? 'vip_monthly' : 'vip_weekly';

              await db.collection('users').updateOne(
                { _id: order.user_id },
                {
                  $set: {
                    membership: 'vip',
                    current_plan: resolvedPlan,
                    vip_expired_at: currentVipExpiry.toISOString()
                  }
                },
                { upsert: true }
              );

              console.log(`[PayOS Webhook] Kích hoạt VIP thành công cho user ${order.user_id} đến ${currentVipExpiry.toISOString()}`);
            }
          }
        }
      } catch (dbErr) {
        console.error('[PayOS Webhook] Lỗi cập nhật DB:', dbErr);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, orderCode, status: 'PAID' })
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
