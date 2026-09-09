const crypto = require('crypto');
const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');
const { getEffectiveMembership } = require('./backend/authUtils');

const BASE_URL = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'voucher-hunter-jwt-secret-key-2026-very-secure';
const CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY || '06590c9ee8673aebf7c219a73f3caebf202e846b995dc20f22681c6a6bb70318';

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

function createTestToken(userId) {
    return jwt.sign({ user_id: userId }, JWT_SECRET, { expiresIn: '1h' });
}

async function runAllVipPackageTests() {
    console.log("================================================================================");
    console.log("🚀 BẮT ĐẦU KIỂM THỬ TOÀN DIỆN HỆ THỐNG GÓI VIP (TUẦN 10K / THÁNG 17K)");
    console.log("================================================================================");

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'voucher_db');

    const cleanupUserIds = [];
    const cleanupOrderCodes = [];

    try {
        // -------------------------------------------------------------------------
        // KỊCH BẢN 1: Free user mua vip_weekly (10.000đ / 7 ngày)
        // -------------------------------------------------------------------------
        console.log("\n▶ [KỊCH BẢN 1] Free user mua gói vip_weekly (10.000đ / 7 ngày):");
        const userId1 = `user_test_weekly_${Date.now()}`;
        cleanupUserIds.push(userId1);
        await db.collection('users').insertOne({
            _id: userId1,
            email: 'user_weekly@example.com',
            membership: 'free',
            vip_expired_at: null,
            created_at: new Date().toISOString()
        });

        const token1 = createTestToken(userId1);
        const resOrder1 = await fetch(`${BASE_URL}/api/payment/create-vip-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token1}`
            },
            body: JSON.stringify({ plan: 'vip_weekly' })
        });
        const orderData1 = await resOrder1.json();
        assert.strictEqual(resOrder1.status, 200, "Tạo đơn vip_weekly phải trả về HTTP 200");
        assert.ok(orderData1.orderCode, "Phải có orderCode");
        cleanupOrderCodes.push(orderData1.orderCode);

        // Kiểm tra order trong DB trước webhook
        const dbOrder1 = await db.collection('payment_orders').findOne({ _id: orderData1.orderCode });
        assert.strictEqual(dbOrder1.plan, 'vip_weekly', "Plan trong DB phải là 'vip_weekly'");
        assert.strictEqual(dbOrder1.amount, 10000, "Amount trong DB phải là 10.000đ");
        assert.strictEqual(dbOrder1.status, 'pending', "Status ban đầu phải là 'pending'");
        console.log(`  - Đã tạo order #${orderData1.orderCode}: plan=${dbOrder1.plan}, amount=${dbOrder1.amount}đ, status=${dbOrder1.status}`);

        // Giả lập Webhook PayOS gửi về cho đơn 1
        const webhookData1 = {
            orderCode: orderData1.orderCode,
            amount: 10000,
            description: 'VIP Tuan 7 ngay',
            accountNumber: '0987654321',
            reference: 'REF_TEST_WEEKLY',
            transactionDateTime: new Date().toISOString(),
            currency: 'VND',
            paymentLinkId: 'link_test_1',
            code: '00',
            desc: 'success'
        };
        const payload1 = {
            code: '00',
            desc: 'success',
            data: webhookData1,
            signature: generatePayOSSignature(webhookData1, CHECKSUM_KEY)
        };

        const resWebhook1 = await fetch(`${BASE_URL}/api/payment/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload1)
        });
        const webhookResJson1 = await resWebhook1.json();
        assert.strictEqual(webhookResJson1.success, true, "Webhook phải trả về success: true");

        // Kiểm tra User 1 sau webhook
        const userAfter1 = await db.collection('users').findOne({ _id: userId1 });
        assert.strictEqual(userAfter1.membership, 'vip', "User membership phải là 'vip'");
        assert.strictEqual(userAfter1.current_plan, 'vip_weekly', "User current_plan phải là 'vip_weekly'");
        assert.ok(userAfter1.vip_expired_at, "User phải có vip_expired_at");

        const expiryDate1 = new Date(userAfter1.vip_expired_at);
        const expectedExpiry1 = new Date(Date.now() + 7 * 86400 * 1000);
        const diffMinutes1 = Math.abs((expiryDate1 - expectedExpiry1) / 60000);
        assert.ok(diffMinutes1 < 5, `Hạn VIP phải xấp xỉ now + 7 ngày (sai lệch: ${diffMinutes1.toFixed(2)} phút)`);
        assert.strictEqual(getEffectiveMembership(userAfter1), 'vip', "getEffectiveMembership() phải trả về 'vip'");
        console.log(`  ✅ PASSED: User đã lên VIP Tuần, hết hạn: ${userAfter1.vip_expired_at} (current_plan: ${userAfter1.current_plan})`);

        // -------------------------------------------------------------------------
        // KỊCH BẢN 2: Free user mua vip_monthly (17.000đ / 30 ngày)
        // -------------------------------------------------------------------------
        console.log("\n▶ [KỊCH BẢN 2] Free user mua gói vip_monthly (17.000đ / 30 ngày):");
        const userId2 = `user_test_monthly_${Date.now()}`;
        cleanupUserIds.push(userId2);
        await db.collection('users').insertOne({
            _id: userId2,
            email: 'user_monthly@example.com',
            membership: 'free',
            vip_expired_at: null,
            created_at: new Date().toISOString()
        });

        const token2 = createTestToken(userId2);
        const resOrder2 = await fetch(`${BASE_URL}/api/payment/create-vip-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token2}`
            },
            body: JSON.stringify({ plan: 'vip_monthly' })
        });
        const orderData2 = await resOrder2.json();
        assert.strictEqual(resOrder2.status, 200, "Tạo đơn vip_monthly phải trả về HTTP 200");
        cleanupOrderCodes.push(orderData2.orderCode);

        const dbOrder2 = await db.collection('payment_orders').findOne({ _id: orderData2.orderCode });
        assert.strictEqual(dbOrder2.plan, 'vip_monthly', "Plan trong DB phải là 'vip_monthly'");
        assert.strictEqual(dbOrder2.amount, 17000, "Amount trong DB phải là 17.000đ");
        console.log(`  - Đã tạo order #${orderData2.orderCode}: plan=${dbOrder2.plan}, amount=${dbOrder2.amount}đ, status=${dbOrder2.status}`);

        const webhookData2 = {
            orderCode: orderData2.orderCode,
            amount: 17000,
            description: 'VIP Thang 30 ngay',
            accountNumber: '0987654321',
            reference: 'REF_TEST_MONTHLY',
            transactionDateTime: new Date().toISOString(),
            currency: 'VND',
            paymentLinkId: 'link_test_2',
            code: '00',
            desc: 'success'
        };
        const payload2 = {
            code: '00',
            desc: 'success',
            data: webhookData2,
            signature: generatePayOSSignature(webhookData2, CHECKSUM_KEY)
        };

        const resWebhook2 = await fetch(`${BASE_URL}/api/payment/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload2)
        });
        const webhookResJson2 = await resWebhook2.json();
        assert.strictEqual(webhookResJson2.success, true);

        const userAfter2 = await db.collection('users').findOne({ _id: userId2 });
        assert.strictEqual(userAfter2.membership, 'vip');
        assert.strictEqual(userAfter2.current_plan, 'vip_monthly');

        const expiryDate2 = new Date(userAfter2.vip_expired_at);
        const expectedExpiry2 = new Date(Date.now() + 30 * 86400 * 1000);
        const diffMinutes2 = Math.abs((expiryDate2 - expectedExpiry2) / 60000);
        assert.ok(diffMinutes2 < 5, `Hạn VIP phải xấp xỉ now + 30 ngày (sai lệch: ${diffMinutes2.toFixed(2)} phút)`);
        assert.strictEqual(getEffectiveMembership(userAfter2), 'vip');
        console.log(`  ✅ PASSED: User đã lên VIP Tháng, hết hạn: ${userAfter2.vip_expired_at} (current_plan: ${userAfter2.current_plan})`);

        // -------------------------------------------------------------------------
        // KỊCH BẢN 3: User đang VIP (còn 3 ngày) mua tiếp vip_weekly -> Cộng dồn
        // -------------------------------------------------------------------------
        console.log("\n▶ [KỊCH BẢN 3] User đang VIP (còn 3 ngày) mua tiếp vip_weekly (Cộng dồn thời hạn):");
        const userId3 = `user_test_cumulative_${Date.now()}`;
        cleanupUserIds.push(userId3);
        const initialExpiry3 = new Date(Date.now() + 3 * 86400 * 1000); // Còn 3 ngày
        await db.collection('users').insertOne({
            _id: userId3,
            email: 'user_cumulative@example.com',
            membership: 'vip',
            current_plan: 'vip_weekly',
            vip_expired_at: initialExpiry3.toISOString(),
            created_at: new Date().toISOString()
        });
        console.log(`  - Trạng thái ban đầu: User đang VIP, hạn dùng hiện tại: ${initialExpiry3.toISOString()} (còn 3 ngày)`);

        const token3 = createTestToken(userId3);
        const resOrder3 = await fetch(`${BASE_URL}/api/payment/create-vip-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token3}`
            },
            body: JSON.stringify({ plan: 'vip_weekly' })
        });
        const orderData3 = await resOrder3.json();
        cleanupOrderCodes.push(orderData3.orderCode);

        const webhookData3 = {
            orderCode: orderData3.orderCode,
            amount: 10000,
            description: 'VIP Tuan 7 ngay',
            accountNumber: '0987654321',
            reference: 'REF_TEST_CUMULATIVE',
            transactionDateTime: new Date().toISOString(),
            currency: 'VND',
            paymentLinkId: 'link_test_3',
            code: '00',
            desc: 'success'
        };
        const payload3 = {
            code: '00',
            desc: 'success',
            data: webhookData3,
            signature: generatePayOSSignature(webhookData3, CHECKSUM_KEY)
        };

        await fetch(`${BASE_URL}/api/payment/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload3)
        });

        const userAfter3 = await db.collection('users').findOne({ _id: userId3 });
        const newExpiry3 = new Date(userAfter3.vip_expired_at);
        const expectedCumulativeExpiry = new Date(initialExpiry3.getTime() + 7 * 86400 * 1000); // 3 ngày + 7 ngày = 10 ngày
        const diffMinutes3 = Math.abs((newExpiry3 - expectedCumulativeExpiry) / 60000);
        assert.ok(diffMinutes3 < 5, `Hạn VIP mới phải bằng hạn cũ + 7 ngày (sai lệch: ${diffMinutes3.toFixed(2)} phút)`);
        console.log(`  ✅ PASSED: Hạn VIP mới được cộng dồn chính xác: ${userAfter3.vip_expired_at} (~ 10 ngày tới, đúng bằng 3 ngày cũ + 7 ngày mới)`);

        // -------------------------------------------------------------------------
        // KỊCH BẢN 4: Tampering amount từ client (gửi amount: 1đ)
        // -------------------------------------------------------------------------
        console.log("\n▶ [KỊCH BẢN 4] Chống DevTools Tampering: Client cố tình gửi { plan: 'vip_weekly', amount: 1 }:");
        const userId4 = `user_test_tamper_${Date.now()}`;
        cleanupUserIds.push(userId4);
        await db.collection('users').insertOne({
            _id: userId4,
            email: 'user_tamper@example.com',
            membership: 'free',
            created_at: new Date().toISOString()
        });

        const token4 = createTestToken(userId4);
        const resOrder4 = await fetch(`${BASE_URL}/api/payment/create-vip-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token4}`
            },
            body: JSON.stringify({ plan: 'vip_weekly', amount: 1 }) // Cố tình hack 1 VND
        });
        const orderData4 = await resOrder4.json();
        assert.strictEqual(resOrder4.status, 200, "Request tạo đơn thành công");
        cleanupOrderCodes.push(orderData4.orderCode);

        const dbOrder4 = await db.collection('payment_orders').findOne({ _id: orderData4.orderCode });
        console.log(`  - Client gửi amount: 1đ`);
        console.log(`  - Server ghi nhận trong DB order #${orderData4.orderCode}: amount = ${dbOrder4.amount}đ`);
        assert.strictEqual(dbOrder4.amount, 10000, "Server PHẢI bỏ qua amount: 1 từ client và set đúng 10.000đ");
        console.log(`  ✅ PASSED: Server tự động bỏ qua client amount (1đ) và áp dụng chuẩn 10.000đ từ VIP_PLANS!`);

        // -------------------------------------------------------------------------
        // KỊCH BẢN 5: Validate plan không hợp lệ (vip_yearly hoặc hacked_plan)
        // -------------------------------------------------------------------------
        console.log("\n▶ [KỊCH BẢN 5] Validate gói không hợp lệ (vip_yearly đã dọn dẹp hoặc chuỗi rác):");
        const token5 = token1;
        
        // Test 5a: Gửi vip_yearly (đã dọn sạch)
        const resInvalidYearly = await fetch(`${BASE_URL}/api/payment/create-vip-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token5}`
            },
            body: JSON.stringify({ plan: 'vip_yearly' })
        });
        const invalidYearlyJson = await resInvalidYearly.json();
        console.log(`  - Thử plan 'vip_yearly': HTTP status = ${resInvalidYearly.status}, error = ${JSON.stringify(invalidYearlyJson)}`);
        assert.strictEqual(resInvalidYearly.status, 400, "Gửi vip_yearly phải bị từ chối với HTTP 400");

        // Test 5b: Gửi hacked_plan
        const resInvalidHacked = await fetch(`${BASE_URL}/api/payment/create-vip-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token5}`
            },
            body: JSON.stringify({ plan: 'hacked_super_vip' })
        });
        const invalidHackedJson = await resInvalidHacked.json();
        console.log(`  - Thử plan 'hacked_super_vip': HTTP status = ${resInvalidHacked.status}, error = ${JSON.stringify(invalidHackedJson)}`);
        assert.strictEqual(resInvalidHacked.status, 400, "Gửi invalid plan phải bị từ chối với HTTP 400");
        console.log(`  ✅ PASSED: Server từ chối nghiêm ngặt các gói không hợp lệ với HTTP 400 Bad Request!`);

        // -------------------------------------------------------------------------
        // KỊCH BẢN 6: Webhook nhận data đơn hàng cũ không có trường 'plan' -> Fallback
        // -------------------------------------------------------------------------
        console.log("\n▶ [KỊCH BẢN 6] Tương thích ngược: Webhook xử lý đơn hàng cũ thiếu field 'plan':");
        const userId6 = `user_test_legacy_${Date.now()}`;
        const legacyOrderCode = Number(String(Date.now()).slice(-9) + Math.floor(Math.random() * 100));
        cleanupUserIds.push(userId6);
        cleanupOrderCodes.push(legacyOrderCode);

        await db.collection('users').insertOne({
            _id: userId6,
            email: 'user_legacy@example.com',
            membership: 'free',
            vip_expired_at: null,
            created_at: new Date().toISOString()
        });

        // Tạo đơn hàng cũ không có field `plan`
        await db.collection('payment_orders').insertOne({
            _id: legacyOrderCode,
            user_id: userId6,
            amount: 10000,
            status: "pending",
            created_at: new Date().toISOString(),
            paid_at: null
            // KHÔNG CÓ TRƯỜNG `plan`
        });
        console.log(`  - Đã chèn đơn hàng legacy #${legacyOrderCode} không có field 'plan'`);

        const webhookData6 = {
            orderCode: legacyOrderCode,
            amount: 10000,
            description: 'VOUCHERMAX VIP',
            accountNumber: '0987654321',
            reference: 'REF_TEST_LEGACY',
            transactionDateTime: new Date().toISOString(),
            currency: 'VND',
            paymentLinkId: 'link_test_6',
            code: '00',
            desc: 'success'
        };
        const payload6 = {
            code: '00',
            desc: 'success',
            data: webhookData6,
            signature: generatePayOSSignature(webhookData6, CHECKSUM_KEY)
        };

        const resWebhook6 = await fetch(`${BASE_URL}/api/payment/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload6)
        });
        const webhookResJson6 = await resWebhook6.json();
        assert.strictEqual(resWebhook6.status, 200, "Webhook đơn cũ phải xử lý thành công HTTP 200");
        assert.strictEqual(webhookResJson6.success, true);

        const userAfter6 = await db.collection('users').findOne({ _id: userId6 });
        assert.strictEqual(userAfter6.membership, 'vip', "User membership phải lên 'vip'");
        assert.strictEqual(userAfter6.current_plan, 'vip_weekly', "User current_plan fallback phải là 'vip_weekly'");

        const expiryDate6 = new Date(userAfter6.vip_expired_at);
        const expectedExpiry6 = new Date(Date.now() + 7 * 86400 * 1000);
        const diffMinutes6 = Math.abs((expiryDate6 - expectedExpiry6) / 60000);
        assert.ok(diffMinutes6 < 5, `Fallback phải cấp đúng 7 ngày (sai lệch: ${diffMinutes6.toFixed(2)} phút)`);
        console.log(`  ✅ PASSED: Webhook xử lý trơn tru đơn cũ, tự động fallback về Gói Tuần (+7 ngày), không crash/null error!`);

        // -------------------------------------------------------------------------
        // KỊCH BẢN 7: Bảo mật Endpoint GET /order-status/:orderCode (Quyền sở hữu)
        // -------------------------------------------------------------------------
        console.log("\n▶ [KỊCH BẢN 7] Bảo mật quyền sở hữu đơn hàng (User A vs User B):");
        const userA_Id = `user_owner_A_${Date.now()}`;
        const userB_Id = `user_attacker_B_${Date.now()}`;
        cleanupUserIds.push(userA_Id, userB_Id);

        await db.collection('users').insertMany([
            { _id: userA_Id, email: 'owner_a@example.com', membership: 'free', created_at: new Date().toISOString() },
            { _id: userB_Id, email: 'attacker_b@example.com', membership: 'free', created_at: new Date().toISOString() }
        ]);

        const tokenA = createTestToken(userA_Id);
        const tokenB = createTestToken(userB_Id);

        // User A tạo một đơn hàng
        const resOrderA = await fetch(`${BASE_URL}/api/payment/create-vip-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenA}` },
            body: JSON.stringify({ plan: 'vip_weekly' })
        });
        const orderDataA = await resOrderA.json();
        assert.strictEqual(resOrderA.status, 200);
        cleanupOrderCodes.push(orderDataA.orderCode);
        console.log(`  - User A (${userA_Id}) đã tạo đơn hàng #${orderDataA.orderCode}`);

        // 7.1 User A (chính chủ) tra cứu đơn của mình -> Thành công 200 OK
        const resCheckA = await fetch(`${BASE_URL}/api/payment/order-status/${orderDataA.orderCode}`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        const checkDataA = await resCheckA.json();
        assert.strictEqual(resCheckA.status, 200, "Chính chủ User A phải xem được đơn hàng của mình");
        assert.strictEqual(checkDataA.success, true);
        assert.strictEqual(checkDataA.status, 'pending');
        assert.strictEqual(checkDataA.plan, 'vip_weekly');
        console.log(`  ✅ 7.1 Chính chủ User A tra cứu đơn thành công: HTTP 200 (status: ${checkDataA.status}, plan: ${checkDataA.plan})`);

        // 7.2 User B (người lạ / attacker) cố tình thử orderCode của User A -> Bị từ chối HTTP 403 FORBIDDEN
        const resCheckB = await fetch(`${BASE_URL}/api/payment/order-status/${orderDataA.orderCode}`, {
            headers: { 'Authorization': `Bearer ${tokenB}` }
        });
        const checkDataB = await resCheckB.json();
        assert.strictEqual(resCheckB.status, 403, "User B không được xem đơn của User A, phải trả về HTTP 403");
        assert.strictEqual(checkDataB.error, 'FORBIDDEN');
        console.log(`  ✅ 7.2 User B cố tình truy cập đơn của User A bị chặn đứng: HTTP 403 FORBIDDEN (${checkDataB.message})`);

        // 7.3 Khách vãng lai (không gửi token) gọi API -> Bị từ chối HTTP 401
        const resCheckGuest = await fetch(`${BASE_URL}/api/payment/order-status/${orderDataA.orderCode}`);
        assert.strictEqual(resCheckGuest.status, 401, "Khách không token phải bị chặn 401");
        console.log(`  ✅ 7.3 Khách vãng lai không token bị chặn: HTTP 401 UNAUTHORIZED`);

        // 7.4 Tra cứu orderCode không tồn tại -> Trả về HTTP 404 NOT FOUND
        const resCheckNotFound = await fetch(`${BASE_URL}/api/payment/order-status/999999999`, {
            headers: { 'Authorization': `Bearer ${tokenA}` }
        });
        assert.strictEqual(resCheckNotFound.status, 404, "Order không tồn tại phải trả về 404");
        console.log(`  ✅ 7.4 Tra cứu mã đơn không tồn tại trả về HTTP 404 ORDER_NOT_FOUND`);

        console.log("\n================================================================================");
        console.log("🎉 TẤT CẢ 7 KỊCH BẢN KIỂM THỬ GÓI VIP & BẢO MẬT ĐÃ VƯỢT QUA 100% THÀNH CÔNG!");
        console.log("================================================================================");

    } finally {
        // Dọn dẹp dữ liệu test
        if (cleanupUserIds.length > 0) {
            await db.collection('users').deleteMany({ _id: { $in: cleanupUserIds } });
        }
        if (cleanupOrderCodes.length > 0) {
            await db.collection('payment_orders').deleteMany({ _id: { $in: cleanupOrderCodes } });
        }
        await client.close();
        console.log("🧹 Đã dọn dẹp sạch sẽ toàn bộ tài liệu test trong MongoDB.");
    }
}

runAllVipPackageTests().catch(err => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});
