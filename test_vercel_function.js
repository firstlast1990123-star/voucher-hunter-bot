/**
 * test_vercel_function.js
 * Kiểm thử mô phỏng Vercel Function invocation qua serverless-http (api/index.js)
 */

const assert = require('assert');
const crypto = require('crypto');
const handler = require('./api/index');

function generatePayOSSignature(data, checksumKey) {
    const sortedKeys = Object.keys(data).sort();
    const signatureData = sortedKeys
        .map(key => `${key}=${data[key] !== null && data[key] !== undefined ? data[key] : ''}`)
        .join('&');

    return crypto
        .createHmac('sha256', checksumKey)
        .update(signatureData)
        .digest('hex');
}

// Helper giả lập event của Serverless Function
function createServerlessEvent(httpMethod, path, body = null, headers = {}) {
    return {
        httpMethod,
        path,
        headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '192.0.2.100',
            ...headers
        },
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
        isBase64Encoded: false
    };
}

async function runVercelTests() {
    console.log("================================================================================");
    console.log("🚀 BẮT ĐẦU KIỂM THỬ VERCEL SERVERLESS FUNCTION (API/INDEX.JS)");
    console.log("================================================================================");

    const fn = typeof handler === 'function' ? handler : handler.handler;

    // -------------------------------------------------------------------------
    // 1. TEST /api/health qua Vercel handler
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 1] GET /api/health:");
    const event1 = createServerlessEvent('GET', '/api/health');
    const res1 = await fn(event1, {});
    assert.strictEqual(res1.statusCode, 200, "Health check qua Vercel handler phải trả về 200");
    const body1 = JSON.parse(res1.body);
    assert.strictEqual(body1.status, 'ok');
    console.log("  ✅ PASSED: Health check qua Vercel api/index.js hoạt động chính xác:", body1);

    // -------------------------------------------------------------------------
    // 2. TEST POST /api/auth/register (Validation & MongoDB connection)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 2] POST /api/auth/register (Thiếu consent -> 400):");
    const event2 = createServerlessEvent('POST', '/api/auth/register', {
        email: 'test_vercel@example.com',
        password: 'password123',
        consent_accepted: false
    });
    const res2 = await fn(event2, {});
    assert.strictEqual(res2.statusCode, 400);
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(body2.error, 'CONSENT_REQUIRED');
    console.log("  ✅ PASSED: Route auth/register hoạt động mượt mà trong Vercel Function:", body2);

    // -------------------------------------------------------------------------
    // 3. TEST /api/payment/webhook (PayOS Webhook GET ping & POST test trên Vercel)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 3a] GET /api/payment/webhook (PayOS connectivity ping):");
    const event3a = createServerlessEvent('GET', '/api/payment/webhook');
    const res3a = await fn(event3a, {});
    assert.strictEqual(res3a.statusCode, 200);
    const body3a = JSON.parse(res3a.body);
    assert.strictEqual(body3a.success, true);
    console.log("  ✅ PASSED: Webhook GET ping trả về 200 OK:", body3a);

    console.log("\n▶ [TEST 3b] POST /api/payment/webhook (Ping không kèm chữ ký -> 200 OK):");
    const event3b = createServerlessEvent('POST', '/api/payment/webhook', {
        ping: true
    });
    const res3b = await fn(event3b, {});
    assert.strictEqual(res3b.statusCode, 200);
    const body3b = JSON.parse(res3b.body);
    assert.strictEqual(body3b.success, true);
    console.log("  ✅ PASSED: POST ping không signature trả về 200 OK:", body3b);

    console.log("\n▶ [TEST 3c] POST /api/payment/webhook (BẢO MẬT: orderCode=123 có signature sai PHẢI bị 400):");
    const event3c = createServerlessEvent('POST', '/api/payment/webhook', {
        code: '00',
        data: { orderCode: 123 },
        signature: 'fake_sig'
    });
    const res3c = await fn(event3c, {});
    assert.strictEqual(res3c.statusCode, 400, "orderCode: 123 với chữ ký giả KHÔNG ĐƯỢC bypass, phải trả về 400");
    const body3c = JSON.parse(res3c.body);
    assert.strictEqual(body3c.error, 'INVALID_SIGNATURE');
    console.log("  ✅ PASSED: orderCode=123 với signature sai bị chặn 400 thành công:", body3c);

    console.log("\n▶ [TEST 3d] POST /api/payment/webhook (BẢO MẬT: orderCode=999999 có signature sai PHẢI bị 400):");
    const event3d = createServerlessEvent('POST', '/api/payment/webhook', {
        code: '00',
        data: { orderCode: 999999 },
        signature: 'fake_sig'
    });
    const res3d = await fn(event3d, {});
    assert.strictEqual(res3d.statusCode, 400);
    const body3d = JSON.parse(res3d.body);
    assert.strictEqual(body3d.error, 'INVALID_SIGNATURE');
    console.log("  ✅ PASSED: orderCode=999999 với signature sai bị chặn 400 thành công:", body3d);

    console.log("\n▶ [TEST 3e] POST /api/payment/webhook (PayOS confirmWebhook test với chữ ký HỢP LỆ -> 200 OK):");
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY || '06590c9ee8673aebf7c219a73f3caebf202e846b995dc20f22681c6a6bb70318';
    const sampleTestData = {
        orderCode: 123,
        amount: 3000,
        description: 'VQRIO123',
        accountNumber: '12345678',
        reference: 'TF230204212323',
        transactionDateTime: '2023-02-04 18:25:00',
        currency: 'VND',
        paymentLinkId: '124c33293c43417ab7879e14c8d9eb18',
        code: '00',
        desc: 'Thành công'
    };
    const validSignature = generatePayOSSignature(sampleTestData, checksumKey);
    const event3e = createServerlessEvent('POST', '/api/payment/webhook', {
        code: '00',
        desc: 'success',
        data: sampleTestData,
        signature: validSignature
    });
    const res3e = await fn(event3e, {});
    assert.strictEqual(res3e.statusCode, 200, "Webhook với chữ ký hợp lệ từ PayOS phải trả về 200");
    const body3e = JSON.parse(res3e.body);
    assert.strictEqual(body3e.success, true);
    console.log("  ✅ PASSED: Webhook PayOS thật/test với chữ ký hợp lệ trả về 200 OK:", body3e);

    // -------------------------------------------------------------------------
    // 4. TEST Route không tồn tại -> 404
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 4] GET /api/nonexistent-route (Fallback 404):");
    const event4 = createServerlessEvent('GET', '/api/nonexistent-route');
    const res4 = await fn(event4, {});
    assert.strictEqual(res4.statusCode, 404);
    const body4 = JSON.parse(res4.body);
    assert.strictEqual(body4.error, 'NOT_FOUND');
    console.log("  ✅ PASSED: 404 handler hoạt động chính xác:", body4);

    console.log("\n================================================================================");
    console.log("🎉 TẤT CẢ TEST MÔ PHỎNG VERCEL FUNCTION ĐÃ THÀNH CÔNG 100%!");
    console.log("================================================================================");
    process.exit(0);
}

runVercelTests().catch(err => {
    console.error("❌ VERCEL FUNCTION TEST FAILED:", err);
    process.exit(1);
});

