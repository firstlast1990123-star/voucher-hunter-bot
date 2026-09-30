const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { MongoClient } = require('mongodb');
const jwt = require('jsonwebtoken');

const app = require('../backend/server-app');
const { connectDB } = require('../backend/db');

async function runTest() {
    console.log("=== BẮT ĐẦU TEST BẢO MẬT API /api/scan (KHÔNG TIN CLIENT MEMBERSHIP) ===");
    
    await connectDB();
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'voucher_db');
    
    let server;
    let baseUrl;
    await new Promise((resolve) => {
        server = app.listen(0, () => {
            baseUrl = `http://localhost:${server.address().port}`;
            resolve();
        });
    });
    
    const testFreeId = `test_free_${Date.now()}`;
    const testVipId = `test_vip_${Date.now()}`;
    const testCode = `EARLY_ACCESS_${Date.now()}`;
    
    const now = new Date();
    
    try {
        // Tạo 1 voucher mới tinh được publish cách đây 1 phút (thuộc diện Early Access < 15 phút)
        await db.collection('live_vouchers').insertOne({
            code: testCode,
            merchant: "Shopee",
            title: "Mã VIP Mới Ra Lò",
            discount_type: "fixed",
            discount_value: 9999999,
            published_at: new Date(now.getTime() - 60000).toISOString(),
            status: "live",
            landing_url: "https://shopee.vn"
        });
        
        // Tạo user Free
        await db.collection('users').insertOne({
            _id: testFreeId,
            email: 'free@example.com',
            membership: 'free',
            vip_expired_at: null
        });
        
        // Tạo user VIP còn hạn
        await db.collection('users').insertOne({
            _id: testVipId,
            email: 'vip@example.com',
            membership: 'vip',
            vip_expired_at: new Date(now.getTime() + 30 * 86400 * 1000).toISOString()
        });
        
        const testShopeeLink = `https://shopee.vn/test-product-${Date.now()}-i.12345.67890`;
        
        const freeToken = jwt.sign({ user_id: testFreeId }, process.env.JWT_SECRET);
        const vipToken = jwt.sign({ user_id: testVipId }, process.env.JWT_SECRET);

        // TEST 1: Khách vãng lai chưa đăng nhập -> BỊ CHẶN 401 UNAUTHORIZED
        console.log("1. Test khách vãng lai chưa đăng nhập gọi /api/scan...");
        const res1 = await fetch(`${baseUrl}/api/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopee_link: testShopeeLink,
                membership: "vip",
                user_id: testFreeId
            })
        });
        assert.strictEqual(res1.status, 401, "Khách vãng lai chưa đăng nhập PHẢI bị chặn 401!");
        const data1 = await res1.json();
        assert.strictEqual(data1.error, "UNAUTHORIZED", "Phải trả về mã lỗi UNAUTHORIZED");
        console.log("✅ TEST 1 PASSED: Khách vãng lai bị chặn 401 thành công, bắt buộc phải đăng nhập.");

        // TEST 2: User Free đã đăng nhập cố tình fake body membership: 'vip' -> Vẫn chỉ nhận quyền Free
        console.log("2. Test User Free đã đăng nhập gửi kèm Bearer token + fake membership: 'vip' trong body...");
        const res2 = await fetch(`${baseUrl}/api/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freeToken}`
            },
            body: JSON.stringify({
                shopee_link: testShopeeLink,
                membership: "vip" // Cố tình fake VIP trong body
            })
        });
        assert.strictEqual(res2.status, 200, "User Free đã đăng nhập PHẢI dùng được scanner 200 OK!");
        const data2 = await res2.json();
        const hasEarlyVoucher2 = (data2.vouchers || []).some(v => v.code === testCode);
        assert.strictEqual(hasEarlyVoucher2, false, "User Free KHÔNG ĐƯỢC PHÉP thấy mã mới phát hiện < 15 phút!");
        assert.ok(data2.new_vouchers_hidden_count >= 1, "Phải báo có voucher bị ẩn cho Free user");
        console.log("✅ TEST 2 PASSED: User Free fake body bị lờ đi, phân quyền dựa trên DB/Token.");

        // TEST 3: User VIP thật với JWT Bearer token
        console.log("3. Test User VIP thật gửi Bearer token...");
        const res3 = await fetch(`${baseUrl}/api/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${vipToken}`
            },
            body: JSON.stringify({
                shopee_link: testShopeeLink
            })
        });
        const data3 = await res3.json();
        const hasEarlyVoucher3 = (data3.vouchers || []).some(v => v.code === testCode);
        assert.strictEqual(hasEarlyVoucher3, true, "User VIP thật PHẢI thấy mã mới ngay lập tức!");
        assert.strictEqual(data3.new_vouchers_hidden_count, 0, "User VIP không bị ẩn mã nào");
        console.log("✅ TEST 3 PASSED: User VIP thật với Bearer token được hiển thị đầy đủ mã Early Access.");

        // TEST 4: User Free gửi kèm fake user_id của VIP trong body kèm Token Free -> Token quyết định, không tin body
        console.log("4. Test User Free gửi user_id của VIP trong body kèm Token Free...");
        const res4 = await fetch(`${baseUrl}/api/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${freeToken}`
            },
            body: JSON.stringify({
                shopee_link: testShopeeLink,
                user_id: testVipId
            })
        });
        assert.strictEqual(res4.status, 200);
        const data4 = await res4.json();
        const hasEarlyVoucher4 = (data4.vouchers || []).some(v => v.code === testCode);
        assert.strictEqual(hasEarlyVoucher4, false, "Gửi user_id trong body KHÔNG ĐƯỢC tin, token Free vẫn là Free!");
        assert.ok(data4.new_vouchers_hidden_count >= 1, "Phải báo có voucher bị ẩn");
        console.log("✅ TEST 4 PASSED: Body user_id hoàn toàn bị bỏ qua, hệ thống chỉ tin JWT Token.");

        console.log("\n🎉 TẤT CẢ TEST BẢO MẬT SCAN API ĐÃ HOÀN TOÀN THÀNH CÔNG!");

    } finally {
        await db.collection('live_vouchers').deleteOne({ code: testCode });
        await db.collection('users').deleteMany({ _id: { $in: [testFreeId, testVipId] } });
        if (server) await new Promise(r => server.close(r));
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

