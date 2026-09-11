/**
 * test_netlify_function.js
 * Kiểm thử mô phỏng Netlify Function invocation qua serverless-http
 */

const assert = require('assert');
const { handler } = require('./netlify/functions/api');

// Helper giả lập event của Netlify Function
function createNetlifyEvent(httpMethod, path, body = null, headers = {}) {
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

async function runNetlifyTests() {
    console.log("================================================================================");
    console.log("🚀 BẮT ĐẦU KIỂM THỬ NETLIFY SERVERLESS FUNCTION (SERVERLESS-HTTP)");
    console.log("================================================================================");

    // -------------------------------------------------------------------------
    // 1. TEST /health qua đường dẫn rewrite Netlify /.netlify/functions/api/health
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 1] GET /.netlify/functions/api/health (Mô phỏng rewrite từ /api/health):");
    const event1 = createNetlifyEvent('GET', '/.netlify/functions/api/health');
    const res1 = await handler(event1, {});
    assert.strictEqual(res1.statusCode, 200, "Health check qua Netlify handler phải trả về 200");
    const body1 = JSON.parse(res1.body);
    assert.strictEqual(body1.status, 'ok');
    console.log("  ✅ PASSED: Health check qua Netlify handler hoạt động chính xác:", body1);

    // -------------------------------------------------------------------------
    // 2. TEST /health qua đường dẫn /api/health
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 2] GET /api/health (Gọi trực tiếp qua prefix /api):");
    const event2 = createNetlifyEvent('GET', '/api/health');
    const res2 = await handler(event2, {});
    assert.strictEqual(res2.statusCode, 200, "Health check qua /api/health phải trả về 200");
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(body2.status, 'ok');
    console.log("  ✅ PASSED: Health check qua /api/health hoạt động chính xác!");

    // -------------------------------------------------------------------------
    // 3. TEST POST /.netlify/functions/api/auth/register (Validation & Cold start DB)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 3] POST /.netlify/functions/api/auth/register (Thiếu consent -> 400):");
    const event3 = createNetlifyEvent('POST', '/.netlify/functions/api/auth/register', {
        email: 'test_serverless@example.com',
        password: 'password123',
        consent_accepted: false
    });
    const res3 = await handler(event3, {});
    assert.strictEqual(res3.statusCode, 400);
    const body3 = JSON.parse(res3.body);
    assert.strictEqual(body3.error, 'CONSENT_REQUIRED');
    console.log("  ✅ PASSED: Route auth/register hoạt động mượt mà trong Netlify Function:", body3);

    // -------------------------------------------------------------------------
    // 4. TEST /.netlify/functions/api/payment/webhook (PayOS Webhook GET ping & POST test)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 4a] GET /.netlify/functions/api/payment/webhook (PayOS connectivity ping):");
    const event4a = createNetlifyEvent('GET', '/.netlify/functions/api/payment/webhook');
    const res4a = await handler(event4a, {});
    assert.strictEqual(res4a.statusCode, 200);
    const body4a = JSON.parse(res4a.body);
    assert.strictEqual(body4a.success, true);
    console.log("  ✅ PASSED: Webhook GET ping qua Netlify handler trả về 200 OK:", body4a);

    console.log("\n▶ [TEST 4b] POST /.netlify/functions/api/payment/webhook (PayOS Dashboard Test Ping orderCode=123):");
    const event4b = createNetlifyEvent('POST', '/.netlify/functions/api/payment/webhook', {
        code: '00',
        data: { orderCode: 123, description: 'VQRIO123' }
    });
    const res4b = await handler(event4b, {});
    assert.strictEqual(res4b.statusCode, 200);
    const body4b = JSON.parse(res4b.body);
    assert.strictEqual(body4b.success, true);
    console.log("  ✅ PASSED: Webhook test ping qua Netlify handler trả về 200 OK:", body4b);

    console.log("\n▶ [TEST 4c] POST /.netlify/functions/api/payment/webhook (Bảo mật: chữ ký sai trên đơn thực tế):");
    const event4c = createNetlifyEvent('POST', '/.netlify/functions/api/payment/webhook', {
        code: '00',
        data: { orderCode: 999999 },
        signature: 'invalid_signature_test'
    });
    const res4c = await handler(event4c, {});
    assert.strictEqual(res4c.statusCode, 400);
    const body4c = JSON.parse(res4c.body);
    assert.strictEqual(body4c.error, 'INVALID_SIGNATURE');
    console.log("  ✅ PASSED: Webhook bảo vệ chữ ký hoạt động chính xác qua Netlify handler:", body4c);

    // -------------------------------------------------------------------------
    // 5. TEST Route không tồn tại -> 404
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 5] GET /.netlify/functions/api/nonexistent-route (Fallback 404):");
    const event5 = createNetlifyEvent('GET', '/.netlify/functions/api/nonexistent-route');
    const res5 = await handler(event5, {});
    assert.strictEqual(res5.statusCode, 404);
    const body5 = JSON.parse(res5.body);
    assert.strictEqual(body5.error, 'NOT_FOUND');
    console.log("  ✅ PASSED: 404 handler hoạt động chính xác:", body5);

    console.log("\n================================================================================");
    console.log("🎉 TẤT CẢ TEST MÔ PHỎNG NETLIFY FUNCTION ĐÃ THÀNH CÔNG 100%!");
    console.log("================================================================================");
    process.exit(0);
}

runNetlifyTests().catch(err => {
    console.error("❌ NETLIFY FUNCTION TEST FAILED:", err);
    process.exit(1);
});

