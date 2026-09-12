/**
 * test_vip_order_validation.js
 * Kiểm thử chi tiết việc sửa lỗi "value" must be of type object và thông báo lỗi thân thiện tiếng Việt
 */

const assert = require('assert');
const jwt = require('jsonwebtoken');
const handler = require('./api/index');

const { connectDB } = require('./backend/db');

const JWT_SECRET = process.env.JWT_SECRET || '9771ca0f7da23f5ba8e4e9062f126607e72b1d4479788ee88ccead46fed11bc3';
const fn = typeof handler === 'function' ? handler : handler.handler;

function createServerlessEvent(httpMethod, path, body = null, headers = {}) {
    return {
        httpMethod,
        path,
        headers: {
            'x-forwarded-for': '192.0.2.100',
            ...headers
        },
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
        isBase64Encoded: false
    };
}

async function runTests() {
    console.log("================================================================================");
    console.log("🧪 BẮT ĐẦU TEST SỬA LỖI VALUE MUST BE OF TYPE OBJECT VÀ VALIDATION MESSAGES");
    console.log("================================================================================");

    const db = await connectDB();
    const testUserId = `test_user_vip_modal_${Date.now()}`;
    await db.collection('users').insertOne({
        _id: testUserId,
        email: 'test_vip_modal@example.com',
        membership: 'free',
        vip_expired_at: null,
        created_at: new Date().toISOString()
    });

    const testToken = jwt.sign({ user_id: testUserId }, JWT_SECRET, { expiresIn: '1h' });

    try {

    // -------------------------------------------------------------------------
    // TEST 1: Gửi đúng chuẩn Content-Type: application/json và plan: vip_weekly
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 1] POST /api/payment/create-vip-order (plan: vip_weekly + Content-Type: application/json):");
    const event1 = createServerlessEvent('POST', '/api/payment/create-vip-order', { plan: 'vip_weekly' }, {
        'authorization': `Bearer ${testToken}`,
        'content-type': 'application/json'
    });
    const res1 = await fn(event1, {});
    console.log("  Response status:", res1.statusCode);
    const body1 = JSON.parse(res1.body);
    console.log("  Response body:", body1);
    assert.strictEqual(res1.statusCode, 200);
    assert.strictEqual(body1.success, true);
    assert.ok(body1.orderCode, "Phải có orderCode");
    assert.ok(body1.qrCode, "Phải có qrCode");
    console.log("  ✅ PASSED: Tạo mã QR gói Tuần thành công 100%!");

    // -------------------------------------------------------------------------
    // TEST 2: Gửi đúng chuẩn Content-Type: application/json và plan: vip_monthly
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 2] POST /api/payment/create-vip-order (plan: vip_monthly + Content-Type: application/json):");
    const event2 = createServerlessEvent('POST', '/api/payment/create-vip-order', { plan: 'vip_monthly' }, {
        'authorization': `Bearer ${testToken}`,
        'content-type': 'application/json'
    });
    const res2 = await fn(event2, {});
    const body2 = JSON.parse(res2.body);
    assert.strictEqual(res2.statusCode, 200);
    assert.strictEqual(body2.success, true);
    assert.ok(body2.orderCode, "Phải có orderCode");
    assert.ok(body2.qrCode, "Phải có qrCode");
    console.log("  ✅ PASSED: Tạo mã QR gói Tháng thành công 100%!");

    // -------------------------------------------------------------------------
    // TEST 3: Giả lập trường hợp KHÔNG có header Content-Type (Body gửi dạng chuỗi JSON thô)
    // Phải được backend parse phòng thủ thành công thay vì văng lỗi type object!
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 3] POST /api/payment/create-vip-order (Không có Content-Type header):");
    const event3 = {
        httpMethod: 'POST',
        path: '/api/payment/create-vip-order',
        headers: {
            'authorization': `Bearer ${testToken}`
            // Cố tình không có Content-Type: application/json
        },
        body: JSON.stringify({ plan: 'vip_weekly' }),
        isBase64Encoded: false
    };
    const res3 = await fn(event3, {});
    const body3 = JSON.parse(res3.body);
    console.log("  Response status:", res3.statusCode);
    console.log("  Response body:", body3);
    assert.strictEqual(res3.statusCode, 200);
    assert.strictEqual(body3.success, true);
    console.log("  ✅ PASSED: Backend tự động parse chuỗi JSON an toàn ngay cả khi thiếu Content-Type!");

    // -------------------------------------------------------------------------
    // TEST 4: Gửi body rỗng {} -> Trả về thông báo tiếng Việt thân thiện
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 4] POST /api/payment/create-vip-order (Body rỗng {}):");
    const event4 = createServerlessEvent('POST', '/api/payment/create-vip-order', {}, {
        'authorization': `Bearer ${testToken}`,
        'content-type': 'application/json'
    });
    const res4 = await fn(event4, {});
    const body4 = JSON.parse(res4.body);
    console.log("  Response status:", res4.statusCode);
    console.log("  Response message:", body4.message);
    assert.strictEqual(res4.statusCode, 400);
    assert.strictEqual(body4.error, 'VALIDATION_ERROR');
    assert.strictEqual(body4.message, 'Vui lòng chọn gói VIP (Gói Tuần hoặc Gói Tháng).');
    assert.ok(!body4.message.includes('must be of type object'), "Không được lộ lỗi kỹ thuật Joi thô");
    console.log("  ✅ PASSED: Trả về thông báo tiếng Việt thân thiện khi thiếu plan!");

    // -------------------------------------------------------------------------
    // TEST 5: Gửi body không phải object (null / chuỗi thô sai định dạng)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 5] POST /api/payment/create-vip-order (Body không phải object):");
    const event5 = {
        httpMethod: 'POST',
        path: '/api/payment/create-vip-order',
        headers: {
            'authorization': `Bearer ${testToken}`,
            'content-type': 'application/json'
        },
        body: 'invalid-non-json-string',
        isBase64Encoded: false
    };
    const res5 = await fn(event5, {});
    const body5 = JSON.parse(res5.body);
    console.log("  Response status:", res5.statusCode);
    console.log("  Response message:", body5.message);
    assert.strictEqual(res5.statusCode, 400);
    assert.ok(!body5.message.includes('must be of type object'), "Tuyệt đối không lộ value must be of type object");
    console.log("  ✅ PASSED: Không còn lộ lỗi thô 'value must be of type object'!");

    // -------------------------------------------------------------------------
    // TEST 6: Gửi plan không hợp lệ (vip_yearly hoặc hacked_plan)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 6] POST /api/payment/create-vip-order (Gói không hợp lệ):");
    const event6 = createServerlessEvent('POST', '/api/payment/create-vip-order', { plan: 'vip_yearly' }, {
        'authorization': `Bearer ${testToken}`,
        'content-type': 'application/json'
    });
    const res6 = await fn(event6, {});
    const body6 = JSON.parse(res6.body);
    console.log("  Response status:", res6.statusCode);
    console.log("  Response message:", body6.message);
    assert.strictEqual(res6.statusCode, 400);
    assert.strictEqual(body6.error, 'VALIDATION_ERROR');
    assert.strictEqual(body6.message, 'Gói VIP không hợp lệ. Vui lòng chọn Gói Tuần hoặc Gói Tháng.');
    console.log("  ✅ PASSED: Chặn đúng gói không hợp lệ kèm thông báo tiếng Việt!");

    console.log("\n================================================================================");
    console.log("🎉 TẤT CẢ TEST ĐÃ VƯỢT QUA 100%!");
    console.log("================================================================================");
    } finally {
        await db.collection('users').deleteOne({ _id: testUserId });
        await db.collection('payment_orders').deleteMany({ user_id: testUserId });
    }
    process.exit(0);
}

runTests().catch(err => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});
