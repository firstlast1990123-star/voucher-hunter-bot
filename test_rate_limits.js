const assert = require('assert');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const BASE_URL = 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'voucher-hunter-jwt-secret-key-2026-very-secure';

function createTestToken(userId) {
    return jwt.sign({ user_id: userId }, JWT_SECRET, { expiresIn: '1h' });
}

async function runRateLimitTests() {
    console.log("================================================================================");
    console.log("🚀 BẮT ĐẦU KIỂM THỬ RATE LIMITING TẦNG MẠNG (EXPRESS-RATE-LIMIT)");
    console.log("================================================================================");

    const testToken = createTestToken('test_user_rate_limit');

    // -------------------------------------------------------------------------
    // 1. TEST /api/auth/register (Giới hạn: 5 req / 1 giờ theo IP)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 1] Rate Limiter cho /api/auth/register (5 req/giờ):");
    const ipRegister = '198.51.100.1';
    let registerBlocked = false;

    for (let i = 1; i <= 6; i++) {
        const res = await fetch(`${BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': ipRegister
            },
            body: JSON.stringify({ email: `rate_${i}@example.com`, password: 'password123' })
        });

        if (res.status === 429) {
            registerBlocked = true;
            const data = await res.json();
            assert.strictEqual(data.error, 'TOO_MANY_REQUESTS');
            console.log(`  ✅ Đã kích hoạt 429 ở request thứ ${i}:`, data);
            break;
        }
    }
    assert.ok(registerBlocked, "/api/auth/register PHẢI bị chặn 429 ở lần gọi thứ 6");
    console.log("  ✅ PASSED: /api/auth/register kích hoạt 429 thành công sau 5 lần thử!");

    // -------------------------------------------------------------------------
    // 2. TEST /api/auth/login (Giới hạn: 5 req / 15 phút theo IP)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 2] Rate Limiter cho /api/auth/login (5 req/15 phút):");
    const ipLogin = '198.51.100.2';
    let loginBlocked = false;

    for (let i = 1; i <= 6; i++) {
        const res = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': ipLogin
            },
            body: JSON.stringify({ email: 'unknown@example.com', password: `wrong_${i}` })
        });

        if (res.status === 429) {
            loginBlocked = true;
            const data = await res.json();
            assert.strictEqual(data.error, 'TOO_MANY_REQUESTS');
            console.log(`  ✅ Đã kích hoạt 429 ở request thứ ${i}:`, data);
            break;
        }
    }
    assert.ok(loginBlocked, "/api/auth/login PHẢI bị chặn 429 ở lần gọi thứ 6");
    console.log("  ✅ PASSED: /api/auth/login kích hoạt 429 thành công sau 5 lần thử!");

    // -------------------------------------------------------------------------
    // 3. TEST /api/vouchers/report-broken (Giới hạn: 10 req / 1 giờ theo IP)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 3] Rate Limiter cho /api/vouchers/report-broken (10 req/giờ):");
    const ipReport = '198.51.100.3';
    let reportBlocked = false;

    for (let i = 1; i <= 11; i++) {
        const res = await fetch(`${BASE_URL}/api/vouchers/report-broken`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${testToken}`,
                'X-Forwarded-For': ipReport
            },
            body: JSON.stringify({ voucher_code: `VOUCHER_TEST_${i}` })
        });

        if (res.status === 429) {
            reportBlocked = true;
            const data = await res.json();
            assert.strictEqual(data.error, 'TOO_MANY_REQUESTS');
            console.log(`  ✅ Đã kích hoạt 429 ở request thứ ${i}:`, data);
            break;
        }
    }
    assert.ok(reportBlocked, "/api/vouchers/report-broken PHẢI bị chặn 429 ở lần gọi thứ 11");
    console.log("  ✅ PASSED: /api/vouchers/report-broken kích hoạt 429 thành công sau 10 lần thử!");

    // -------------------------------------------------------------------------
    // 4. TEST /api/scan (Giới hạn: 30 req / 1 giờ theo IP)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 4] Rate Limiter cho /api/scan (30 req/giờ):");
    const ipScan = '198.51.100.4';
    let scanBlocked = false;

    for (let i = 1; i <= 31; i++) {
        const res = await fetch(`${BASE_URL}/api/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Forwarded-For': ipScan
            },
            body: JSON.stringify({ shopee_link: 'https://shopee.vn/product-item-test-i.123.456' })
        });

        if (res.status === 429) {
            scanBlocked = true;
            const data = await res.json();
            assert.strictEqual(data.error, 'TOO_MANY_REQUESTS');
            console.log(`  ✅ Đã kích hoạt 429 ở request thứ ${i}:`, data);
            break;
        }
    }
    assert.ok(scanBlocked, "/api/scan PHẢI bị chặn 429 ở lần gọi thứ 31");
    console.log("  ✅ PASSED: /api/scan kích hoạt 429 thành công sau 30 lần thử!");

    // -------------------------------------------------------------------------
    // 5. TEST Lớp Bảo Vệ Nền Toàn Bộ /api/* (Giới hạn: 100 req / 15 phút theo IP)
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 5] Global Rate Limiter cho toàn bộ /api/* (100 req/15 phút):");
    const ipGlobal = '198.51.100.5';
    let globalBlocked = false;

    // Gửi 100 request bình thường
    const batchPromises = [];
    for (let i = 1; i <= 100; i++) {
        batchPromises.push(
            fetch(`${BASE_URL}/api/stats/success-rate`, {
                headers: { 'X-Forwarded-For': ipGlobal }
            })
        );
    }
    await Promise.all(batchPromises);

    // Request thứ 101 phải bị 429
    const resOver = await fetch(`${BASE_URL}/api/stats/success-rate`, {
        headers: { 'X-Forwarded-For': ipGlobal }
    });

    if (resOver.status === 429) {
        globalBlocked = true;
        const data = await resOver.json();
        assert.strictEqual(data.error, 'TOO_MANY_REQUESTS');
        console.log("  ✅ Đã kích hoạt 429 ở request thứ 101:", data);
    }
    assert.ok(globalBlocked, "Toàn bộ /api/* PHẢI bị chặn 429 ở request thứ 101");
    console.log("  ✅ PASSED: Global Rate Limiter bảo vệ nền hoạt động chính xác!");

    // -------------------------------------------------------------------------
    // 6. TEST Miễn trừ Rate Limit cho /health
    // -------------------------------------------------------------------------
    console.log("\n▶ [TEST 6] Miễn trừ Rate Limiter cho endpoint giám sát /health:");
    const ipHealth = '198.51.100.6';
    let healthAllOk = true;

    for (let i = 1; i <= 105; i++) {
        const resHealth = await fetch(`${BASE_URL}/health`, {
            headers: { 'X-Forwarded-For': ipHealth }
        });
        if (resHealth.status !== 200) {
            healthAllOk = false;
            break;
        }
    }
    assert.ok(healthAllOk, "/health không được bị chặn bởi rate limiter");
    console.log("  ✅ PASSED: /health hoạt động tự do và không bị ảnh hưởng bởi rate limiting!");

    console.log("\n================================================================================");
    console.log("🎉 TẤT CẢ CÁC BÀI TEST RATE LIMITING ĐÃ VƯỢT QUA 100% THÀNH CÔNG!");
    console.log("================================================================================");
}

runRateLimitTests().then(() => {
    process.exit(0);
}).catch(err => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});
