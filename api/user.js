const { MongoClient } = require('mongodb');

let cachedDb = null;
async function getDB() {
    if (cachedDb) return cachedDb;
    const client = new MongoClient(process.env.MONGO_URI || 'mongodb://localhost:27017');
    await client.connect();
    cachedDb = client.db(process.env.DB_NAME || 'voucher_hunter');
    return cachedDb;
}

const handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }
    
    // Check path for user routes
    const path = event.path || event.rawPath || '';
    
    if (event.httpMethod === 'POST' && path.includes('/generate-telegram-link-code')) {
        try {
            const body = JSON.parse(event.body || '{}');
            const user_id = body.user_id;
            
            if (!user_id) {
                return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: 'Thiếu user_id' }) };
            }

            const db = await getDB();
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
            
            await db.collection('telegram_link_codes').insertOne({
                _id: code,
                user_id: user_id,
                expires_at: expiresAt,
                used: false
            });

            return {
                statusCode: 200,
                headers,
                body: JSON.stringify({ success: true, code, expires_in_minutes: 10 })
            };
        } catch (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
        }
    }
    
    if (event.httpMethod === 'POST' && path.includes('/register')) {
        try {
            const body = JSON.parse(event.body || '{}');
            const { user_id, consent_accepted, allow_marketing } = body;
            if (!consent_accepted) {
                return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: "Bạn phải đồng ý với Điều khoản sử dụng và Chính sách bảo mật." }) };
            }
            const db = await getDB();
            await db.collection('users').updateOne(
                { _id: user_id },
                { 
                    $set: { 
                        consent_accepted: true,
                        consent_accepted_at: new Date().toISOString(),
                        consent_version: 'v1.0',
                        allow_marketing: !!allow_marketing
                    } 
                },
                { upsert: true }
            );
            return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
        } catch (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
        }
    }

    if (event.httpMethod === 'GET' && path.includes('/export-my-data')) {
        try {
            const user_id = event.queryStringParameters.user_id;
            if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: "Thiếu user_id" }) };
            
            const db = await getDB();
            const user = await db.collection('users').findOne({ _id: user_id }) || {};
            delete user.password_hash;
            
            const saved_vouchers = await db.collection('saved_vouchers').find({ user_id }).toArray();
            const telegram_subs = await db.collection('telegram_subscriptions').find({ user_id }).toArray();
            const payment_orders = await db.collection('payment_orders').find({ user_id }).toArray();
            
            const exportData = { profile: user, saved_vouchers, telegram_subscriptions: telegram_subs, payment_orders };
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: exportData }) };
        } catch (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
        }
    }

    if (event.httpMethod === 'POST' && path.includes('/request-deletion')) {
        try {
            const body = JSON.parse(event.body || '{}');
            const user_id = body.user_id;
            if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ success: false, error: "Thiếu user_id" }) };
            
            const db = await getDB();
            await db.collection('users').updateOne(
                { _id: user_id },
                { 
                    $set: { 
                        deletion_requested: true,
                        deletion_requested_at: new Date().toISOString()
                    } 
                }
            );
            return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: "Yêu cầu xóa tài khoản đã được ghi nhận. Hệ thống sẽ tự động xử lý sau 7 ngày." }) };
        } catch (error) {
            return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
        }
    }
    
    return { statusCode: 404, headers, body: 'Not found' };
};

module.exports = async (req, res) => {
    const event = {
        httpMethod: req.method,
        path: req.url,
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
