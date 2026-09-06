const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { MongoClient } = require('mongodb');

async function runTest() {
    console.log("=== BẮT ĐẦU TEST BẢO MẬT API /api/scan (KHÔNG TIN CLIENT MEMBERSHIP) ===");
    
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    const db = client.db(process.env.DB_NAME || 'voucher_db');
    
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
            discount_value: 50000,
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
        
        // TEST 1: User Free cố tình giả mạo membership: "vip" trong body
        console.log("1. Test User Free gửi body { membership: 'vip', user_id: free_id }...");
        const res1 = await fetch('http://localhost:3000/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopee_link: testShopeeLink,
                membership: "vip", // CỐ TÌNH FAKE VIP
                user_id: testFreeId
            })
        });
        const data1 = await res1.json();
        const hasEarlyVoucher1 = (data1.vouchers || []).some(v => v.code === testCode);
        assert.strictEqual(hasEarlyVoucher1, false, "User Free KHÔNG ĐƯỢC PHÉP thấy mã mới phát hiện < 15 phút!");
        assert.ok(data1.new_vouchers_hidden_count >= 1, "Phải báo có voucher bị ẩn");
        console.log("✅ TEST 1 PASSED: Hệ thống đã chặn đứng nỗ lực fake membership: 'vip' từ client.");

        // TEST 2: Không gửi user_id nhưng gửi membership: "vip"
        console.log("2. Test ẩn danh gửi body { membership: 'vip' }...");
        const res2 = await fetch('http://localhost:3000/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopee_link: testShopeeLink,
                membership: "vip" // FAKE VIP không có user_id
            })
        });
        const data2 = await res2.json();
        const hasEarlyVoucher2 = (data2.vouchers || []).some(v => v.code === testCode);
        assert.strictEqual(hasEarlyVoucher2, false, "Ẩn danh KHÔNG ĐƯỢC PHÉP thấy mã mới!");
        console.log("✅ TEST 2 PASSED: Ẩn danh không thể bypass kiểm tra VIP.");

        // TEST 3: User VIP thật
        console.log("3. Test User VIP thật gửi user_id...");
        const res3 = await fetch('http://localhost:3000/api/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopee_link: testShopeeLink,
                user_id: testVipId
            })
        });
        const data3 = await res3.json();
        const hasEarlyVoucher3 = (data3.vouchers || []).some(v => v.code === testCode);
        assert.strictEqual(hasEarlyVoucher3, true, "User VIP thật PHẢI thấy mã mới ngay lập tức!");
        assert.strictEqual(data3.new_vouchers_hidden_count, 0, "User VIP không bị ẩn mã nào");
        console.log("✅ TEST 3 PASSED: User VIP thật được hiển thị đầy đủ mã Early Access.");

        console.log("\n🎉 TẤT CẢ TEST BẢO MẬT SCAN API ĐÃ HOÀN TOÀN THÀNH CÔNG!");

    } finally {
        await db.collection('live_vouchers').deleteOne({ code: testCode });
        await db.collection('users').deleteMany({ _id: { $in: [testFreeId, testVipId] } });
        await client.close();
        console.log("🧹 Đã dọn dẹp sạch bản ghi test trong MongoDB.");
    }
}

runTest().catch(err => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});

