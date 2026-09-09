const crypto = require('crypto');
const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { MongoClient } = require('mongodb');

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

async function runTest() {
    console.log("=== BẮT ĐẦU TEST GIẢ LẬP WEBHOOK PAYOS KÍCH HOẠT VIP ===");
    
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'voucher_db');
    
    const checksumKey = process.env.PAYOS_CHECKSUM_KEY || '06590c9ee8673aebf7c219a73f3caebf202e846b995dc20f22681c6a6bb70318';
    
    const testUserId = `test_user_webhook_${Date.now()}`;
    const testOrderCode1 = Math.floor(100000000 + Math.random() * 900000000);
    const testOrderCode2 = testOrderCode1 + 1;
    
    try {
        // 1. Tạo user Free ban đầu
        await db.collection('users').insertOne({
            _id: testUserId,
            email: 'test_vip@example.com',
            membership: 'free',
            vip_expired_at: null
        });
        console.log(`1. Đã tạo user test Free: ${testUserId}`);
        
        // 2. Tạo đơn hàng 1: Gói tháng (vip_monthly)
        await db.collection('payment_orders').insertOne({
            _id: testOrderCode1,
            user_id: testUserId,
            amount: 17000,
            plan: 'vip_monthly',
            status: 'pending',
            created_at: new Date().toISOString(),
            paid_at: null
        });
        console.log(`2. Đã tạo đơn hàng pending: orderCode = ${testOrderCode1} (plan: vip_monthly)`);
        
        // 3. Giả lập webhook gửi từ PayOS cho đơn 1
        const webhookData1 = {
            orderCode: testOrderCode1,
            amount: 17000,
            description: 'VIP Tháng',
            accountNumber: '123456789',
            reference: 'REF001',
            transactionDateTime: new Date().toISOString(),
            currency: 'VND',
            paymentLinkId: 'link001',
            code: '00',
            desc: 'success'
        };
        const signature1 = generatePayOSSignature(webhookData1, checksumKey);
        
        const payload1 = {
            code: '00',
            desc: 'success',
            data: webhookData1,
            signature: signature1
        };
        
        console.log("3. Gửi webhook xác nhận thanh toán thành công đến server Express...");
        const res1 = await fetch('http://localhost:3000/api/payment/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload1)
        });
        const json1 = await res1.json();
        console.log("Server response:", json1);
        assert.strictEqual(json1.success, true, "Webhook phải trả về success: true");
        
        // 4. Kiểm tra Database sau khi kích hoạt đơn 1
        const orderAfter1 = await db.collection('payment_orders').findOne({ _id: testOrderCode1 });
        assert.strictEqual(orderAfter1.status, 'paid', "Order status phải đổi thành 'paid'");
        assert.ok(orderAfter1.paid_at, "Order phải có paid_at");
        
        const userAfter1 = await db.collection('users').findOne({ _id: testUserId });
        assert.strictEqual(userAfter1.membership, 'vip', "User membership phải đổi thành 'vip'");
        assert.ok(userAfter1.vip_expired_at, "User phải có vip_expired_at");
        
        const expiry1 = new Date(userAfter1.vip_expired_at);
        const expectedExpiry1 = new Date(Date.now() + 30 * 86400 * 1000);
        const diffMinutes1 = Math.abs((expiry1 - expectedExpiry1) / 60000);
        assert.ok(diffMinutes1 < 5, "Hạn VIP tháng phải là ~30 ngày tới");
        console.log(`✅ TEST BƯỚC 1 PASSED: User đã lên VIP, hết hạn: ${userAfter1.vip_expired_at}`);
        
        // 5. TEST CỘNG DỒN THỜI HẠN: Mua tiếp gói tuần (vip_weekly)
        console.log("\n--- TEST CỘNG DỒN THỜI HẠN ---");
        await db.collection('payment_orders').insertOne({
            _id: testOrderCode2,
            user_id: testUserId,
            amount: 10000,
            plan: 'vip_weekly',
            status: 'pending',
            created_at: new Date().toISOString(),
            paid_at: null
        });
        
        const webhookData2 = {
            orderCode: testOrderCode2,
            amount: 10000,
            description: 'VIP Tuan',
            accountNumber: '123456789',
            reference: 'REF002',
            transactionDateTime: new Date().toISOString(),
            currency: 'VND',
            paymentLinkId: 'link002',
            code: '00',
            desc: 'success'
        };
        const signature2 = generatePayOSSignature(webhookData2, checksumKey);
        
        await fetch('http://localhost:3000/api/payment/webhook', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                code: '00',
                desc: 'success',
                data: webhookData2,
                signature: signature2
            })
        });
        
        const userAfter2 = await db.collection('users').findOne({ _id: testUserId });
        const expiry2 = new Date(userAfter2.vip_expired_at);
        const diffDays = Math.round((expiry2 - expiry1) / (86400 * 1000));
        assert.strictEqual(diffDays, 7, "Thời hạn mới phải được cộng thêm chính xác 7 ngày vào hạn cũ!");
        console.log(`✅ TEST BƯỚC 2 PASSED: Thời hạn được cộng dồn chuẩn xác (+7 ngày): ${userAfter2.vip_expired_at}`);
        
        console.log("\n🎉 TẤT CẢ TEST WEBHOOK PAYOS VÀ KÍCH HOẠT VIP ĐÃ HOÀN TOÀN THÀNH CÔNG!");
        
    } finally {
        // Dọn dẹp dữ liệu test
        await db.collection('payment_orders').deleteMany({ _id: { $in: [testOrderCode1, testOrderCode2] } });
        await db.collection('users').deleteOne({ _id: testUserId });
        await client.close();
        console.log("🧹 Đã dọn dẹp sạch bản ghi test trong MongoDB.");
    }
}

runTest().then(() => {
    process.exit(0);
}).catch(err => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});

