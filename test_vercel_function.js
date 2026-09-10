/**
 * test_vercel_function.js
 * Kiểm thử mô phỏng Vercel Function invocation qua serverless-http (api/index.js)
 */

const assert = require('assert');
const handler = require('./api/index');

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
    // 3. TEST POST /api/payment/webhook (PayOS Webhook trên Vercel)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 3] POST /api/payment/webhook (Xác nhận webhook hoạt động):");
    const event3 = createServerlessEvent('POST', '/api/payment/webhook', {
        code: '00',
        data: { orderCode: 123 },
        signature: 'invalid_signature_test'
    });
    const res3 = await fn(event3, {});
    assert.strictEqual(res3.statusCode, 400);
    const body3 = JSON.parse(res3.body);
    assert.strictEqual(body3.error, 'INVALID_SIGNATURE');
    console.log("  ✅ PASSED: Webhook PayOS được gọi trơn tru qua Vercel function handler:", body3);

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

