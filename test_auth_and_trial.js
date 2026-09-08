/**
 * test_auth_and_trial.js
 * Comprehensive automated test suite for Authentication & VIP Trial (Server-side Single Source of Truth)
 */

const assert = require('assert');
const { connectDB } = require('./backend/db');
const { getEffectiveMembership, getTrialRemainingSeconds } = require('./backend/authUtils');
const voucherValidatorCore = require('./backend/authUtils'); // same logic

const BASE_URL = 'http://localhost:3000';

async function runTests() {
    console.log("==================================================================");
    console.log("🚀 BẮT ĐẦU KIỂM THỬ AUTHENTICATION & VIP TRIAL 2 TIẾNG (SERVER-SIDE)");
    console.log("==================================================================");

    const db = await connectDB();
    const testTimestamp = Date.now();
    const testEmail = `test_user_${testTimestamp}@example.com`;
    const testPassword = 'SecurePassword123!';
    let authToken = null;
    let testUserId = null;

    try {
        // ==================================================================
        // 1. TEST ĐĂNG KÝ (VALIDATION & CONSENT NGHỊ ĐỊNH 13)
        // ==================================================================
        console.log("\n[1] TEST ĐĂNG KÝ (/api/auth/register)");

        // 1.1 Thiếu consent
        const resNoConsent = await fetch(`${BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: testPassword, consent_accepted: false })
        });
        assert.strictEqual(resNoConsent.status, 400, "Thiếu consent phải trả về 400");
        const dataNoConsent = await resNoConsent.json();
        assert.strictEqual(dataNoConsent.error, 'CONSENT_REQUIRED');
        console.log("  ✅ 1.1 Chặn thành công khi chưa đồng ý Nghị định 13 (400 CONSENT_REQUIRED)");

        // 1.2 Mật khẩu yếu (< 8 ký tự)
        const resWeakPass = await fetch(`${BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: '123', consent_accepted: true })
        });
        assert.strictEqual(resWeakPass.status, 400, "Mật khẩu < 8 ký tự phải trả về 400");
        console.log("  ✅ 1.2 Chặn thành công mật khẩu ngắn < 8 ký tự (400 WEAK_PASSWORD)");

        // 1.3 Đăng ký thành công
        const resRegSuccess = await fetch(`${BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail,
                password: testPassword,
                consent_accepted: true,
                allow_marketing: true
            })
        });
        assert.strictEqual(resRegSuccess.status, 201, "Đăng ký hợp lệ phải trả về 201 Created");
        const dataReg = await resRegSuccess.json();
        assert.strictEqual(dataReg.success, true);
        assert.ok(dataReg.token, "Phải trả về JWT Token");
        assert.strictEqual(dataReg.user.email, testEmail);
        assert.strictEqual(dataReg.user.membership, 'vip', "User mới phải nhận VIP Trial");
        assert.strictEqual(dataReg.user.is_trial, true);

        authToken = dataReg.token;
        testUserId = dataReg.user.id;
        console.log("  ✅ 1.3 Đăng ký thành công, nhận JWT Token và trạng thái VIP Trial.");

        // 1.4 Kiểm tra MongoDB lưu hash bcrypt (KHÔNG BAO GIỜ LƯU PLAINTEXT)
        const savedUserInDb = await db.collection('users').findOne({ _id: testUserId });
        assert.ok(savedUserInDb, "User phải được lưu trong MongoDB");
        assert.ok(savedUserInDb.password_hash.startsWith('$2a$') || savedUserInDb.password_hash.startsWith('$2b$'),
            "password_hash phải là hash Bcrypt (bắt đầu $2a$ hoặc $2b$)");
        assert.notStrictEqual(savedUserInDb.password_hash, testPassword, "Tuyệt đối không lưu plaintext password");
        assert.ok(savedUserInDb.created_at, "Phải có created_at");
        assert.ok(savedUserInDb.trial_started_at, "Phải có trial_started_at");
        assert.strictEqual(savedUserInDb.trial_used, false, "trial_used mặc định phải là false");
        console.log(`  ✅ 1.4 Xác nhận MongoDB lưu bcrypt hash (${savedUserInDb.password_hash.slice(0, 15)}...), không lưu plaintext.`);

        // 1.5 Đăng ký trùng email
        const resDuplicate = await fetch(`${BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: testEmail.toUpperCase(), // Test case-insensitive
                password: testPassword,
                consent_accepted: true
            })
        });
        assert.strictEqual(resDuplicate.status, 409, "Email trùng phải trả về 409 Conflict");
        console.log("  ✅ 1.5 Chặn thành công đăng ký trùng email (case-insensitive).");

        // ==================================================================
        // 2. TEST ĐĂNG NHẬP & RATE LIMITING
        // ==================================================================
        console.log("\n[2] TEST ĐĂNG NHẬP (/api/auth/login)");

        // 2.1 Đăng nhập sai mật khẩu -> Thông báo chung chung
        const resWrongPass = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: 'WrongPassword999!' })
        });
        assert.strictEqual(resWrongPass.status, 401);
        const dataWrongPass = await resWrongPass.json();
        assert.strictEqual(dataWrongPass.message, 'Email hoặc mật khẩu không đúng.',
            "Thông báo lỗi phải chung chung tránh lộ thông tin email");
        console.log("  ✅ 2.1 Sai mật khẩu trả về 401 với thông báo chung chuẩn bảo mật.");

        // 2.2 Đăng nhập email không tồn tại -> Thông báo chung chung hệt như sai mật khẩu
        const resWrongEmail = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'nonexistent_user_9999@example.com', password: 'AnyPassword123!' })
        });
        assert.strictEqual(resWrongEmail.status, 401);
        const dataWrongEmail = await resWrongEmail.json();
        assert.strictEqual(dataWrongEmail.message, 'Email hoặc mật khẩu không đúng.',
            "Email không tồn tại cũng phải trả thông báo giống hệt để chống enumeration");
        console.log("  ✅ 2.2 Email không tồn tại trả về thông báo lỗi hệt như sai mật khẩu.");

        // 2.3 Đăng nhập đúng
        const resLoginSuccess = await fetch(`${BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: testEmail, password: testPassword })
        });
        assert.strictEqual(resLoginSuccess.status, 200);
        const dataLogin = await resLoginSuccess.json();
        assert.ok(dataLogin.token, "Đăng nhập đúng phải trả về token");
        assert.strictEqual(dataLogin.user.membership, 'vip');
        console.log("  ✅ 2.3 Đăng nhập thành công trả về JWT token hợp lệ.");

        // 2.4 Kiểm tra endpoint /api/auth/me với token
        const resMe = await fetch(`${BASE_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        assert.strictEqual(resMe.status, 200);
        const dataMe = await resMe.json();
        assert.strictEqual(dataMe.user.email, testEmail);
        console.log("  ✅ 2.4 Endpoint /api/auth/me xác thực thành công qua Bearer token.");

        // ==================================================================
        // 3. TEST NGUỒN CHÂN LÝ DUY NHẤT: getEffectiveMembership (VIP TRIAL)
        // ==================================================================
        console.log("\n[3] TEST NGUỒN CHÂN LÝ DUY NHẤT getEffectiveMembership()");

        const now = new Date();

        // 3.1 User vừa tạo (0 giờ) -> VIP
        const user0h = {
            membership: 'free',
            trial_started_at: now.toISOString(),
            trial_used: false
        };
        assert.strictEqual(getEffectiveMembership(user0h), 'vip', "0h phải là VIP");
        console.log("  ✅ 3.1 User mới tạo (0h trôi qua) -> getEffectiveMembership = 'vip'.");

        // 3.2 User trôi qua 1 tiếng 30 phút (còn 30 phút) -> VIP
        const past1h30 = new Date(now.getTime() - 90 * 60 * 1000).toISOString();
        const user1h30 = {
            membership: 'free',
            trial_started_at: past1h30,
            trial_used: false
        };
        assert.strictEqual(getEffectiveMembership(user1h30), 'vip', "1.5h phải là VIP");
        assert.ok(getTrialRemainingSeconds(user1h30) > 0, "Số giây còn lại phải > 0");
        console.log("  ✅ 3.2 User ở mốc 1.5h (còn 30p) -> getEffectiveMembership = 'vip'.");

        // 3.3 User trôi qua 2 tiếng 5 phút (hết hạn trial) -> Free
        const past2h5m = new Date(now.getTime() - 125 * 60 * 1000).toISOString();
        const user2h5m = {
            membership: 'free',
            trial_started_at: past2h5m,
            trial_used: false
        };
        assert.strictEqual(getEffectiveMembership(user2h5m), 'free', "2h5m phải về 'free'");
        assert.strictEqual(getTrialRemainingSeconds(user2h5m), 0, "Hết hạn trial remaining = 0");
        console.log("  ✅ 3.3 User ở mốc 2h5m (quá 2 tiếng) -> Tự động trở về 'free'.");

        // 3.4 User còn thời gian (<2h) nhưng trial_used = true -> Free
        const userTrialUsed = {
            membership: 'free',
            trial_started_at: now.toISOString(),
            trial_used: true
        };
        assert.strictEqual(getEffectiveMembership(userTrialUsed), 'free', "trial_used = true phải về 'free'");
        console.log("  ✅ 3.4 User có cờ trial_used = true -> Ngăn chặn tái sử dụng trial ('free').");

        // 3.5 User VIP trả phí (có vip_expired_at trong tương lai) -> VIP
        const futureVip = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const userPaidVip = {
            membership: 'vip',
            vip_expired_at: futureVip,
            trial_used: true
        };
        assert.strictEqual(getEffectiveMembership(userPaidVip), 'vip', "VIP trả phí luôn là 'vip'");
        console.log("  ✅ 3.5 User VIP trả phí -> Luôn ưu tiên quyền 'vip' cao nhất.");

        // ==================================================================
        // 4. TEST BẢO MẬT CÁC API VỚI MIDDLEWARE authenticateToken
        // ==================================================================
        console.log("\n[4] TEST BẢO MẬT CÁC ENDPOINT VỚI authenticateToken");

        // 4.1 Gọi /api/vouchers/my-storage không có token -> Bị chặn 401
        const resStorageNoAuth = await fetch(`${BASE_URL}/api/vouchers/my-storage`);
        assert.strictEqual(resStorageNoAuth.status, 401, "Không có token phải trả 401 Unauthorized");
        console.log("  ✅ 4.1 /api/vouchers/my-storage chặn đúng 401 khi không gửi Token.");

        // 4.2 Gọi /api/vouchers/my-storage có Bearer token -> 200 OK
        const resStorageWithAuth = await fetch(`${BASE_URL}/api/vouchers/my-storage`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        assert.strictEqual(resStorageWithAuth.status, 200, "Có token hợp lệ phải trả 200 OK");
        console.log("  ✅ 4.2 /api/vouchers/my-storage thành công 200 OK khi có Bearer Token.");

        // 4.3 Gọi /api/payment/create-vip-order không có token -> Bị chặn 401
        const resOrderNoAuth = await fetch(`${BASE_URL}/api/payment/create-vip-order`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan: 'vip_monthly' })
        });
        assert.strictEqual(resOrderNoAuth.status, 401);
        console.log("  ✅ 4.3 /api/payment/create-vip-order chặn đúng 401 khi không gửi Token.");

        // 4.4 Gọi /api/user/export-my-data có Bearer token -> 200 OK (không cần ?user_id=)
        const resExport = await fetch(`${BASE_URL}/api/user/export-my-data`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        assert.strictEqual(resExport.status, 200);
        const dataExport = await resExport.json();
        assert.strictEqual(dataExport.data.profile.email, testEmail);
        assert.strictEqual(dataExport.data.profile.password_hash, undefined, "export-my-data không được lộ password_hash");
        console.log("  ✅ 4.4 /api/user/export-my-data nhận diện đúng user từ JWT và giấu password_hash.");

        // ==================================================================
        // 5. TEST API /api/scan VỚI USER TRIAL VS KHÁCH VÃNG LAI
        // ==================================================================
        console.log("\n[5] TEST PHÂN QUYỀN /api/scan");

        // Tạo 1 voucher Early Access (< 15 phút) trong live_vouchers
        const testVoucherCode = `TEST_VIP_${testTimestamp}`;
        await db.collection('live_vouchers').insertOne({
            code: testVoucherCode,
            title: "Mã VIP Siêu Cấp 500K",
            discount_type: "fixed",
            discount_value: 500000,
            merchant: "Shopee",
            status: "live",
            published_at: new Date().toISOString() // Mới tạo -> Thuộc diện Early Access
        });

        const scanUrl = `https://shopee.vn/product-test-item-i.123.${testTimestamp}`;

        // 5.1 Khách vãng lai (không token) quét mã -> mã mới bị ẩn
        const resScanGuest = await fetch(`${BASE_URL}/api/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ shopee_link: scanUrl })
        });
        assert.strictEqual(resScanGuest.status, 200);
        const dataScanGuest = await resScanGuest.json();
        assert.ok(dataScanGuest.new_vouchers_hidden_count >= 1, "Khách vãng lai phải bị ẩn mã Early Access");
        console.log("  ✅ 5.1 Khách vãng lai không token -> Mã Early Access bị ẩn (phân quyền Free).");

        // 5.2 User đang trong VIP Trial gửi Bearer token quét mã -> Thấy toàn bộ, 0 mã bị ẩn
        const resScanTrial = await fetch(`${BASE_URL}/api/scan`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ shopee_link: scanUrl })
        });
        assert.strictEqual(resScanTrial.status, 200);
        const dataScanTrial = await resScanTrial.json();
        assert.strictEqual(dataScanTrial.new_vouchers_hidden_count, 0, "User VIP Trial phải được xem ngay (0 mã ẩn)");
        console.log("  ✅ 5.2 User VIP Trial có Token -> Xem đầy đủ mã Early Access (0 mã bị ẩn).");

        // 5.3 Cố tình gửi fake user_id hoặc fake membership trong body -> Bị bỏ qua hoàn toàn
        const resScanFake = await fetch(`${BASE_URL}/api/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                shopee_link: `https://shopee.vn/fake-test-${testTimestamp}`,
                membership: 'vip',
                user_id: 'fake_vip_id'
            })
        });
        assert.strictEqual(resScanFake.status, 200);
        const dataScanFake = await resScanFake.json();
        assert.ok(dataScanFake.new_vouchers_hidden_count >= 1, "Body fake membership/user_id phải bị lờ đi");
        console.log("  ✅ 5.3 Client cố fake membership/user_id trong body hoàn toàn bị vô hiệu hóa.");

        // ==================================================================
        // 6. TEST RATE LIMITING CHO /api/auth/login (5 lần thử)
        // ==================================================================
        console.log("\n[6] TEST RATE LIMITING CHO /api/auth/login");

        let wasRateLimited = false;
        // Thử liên tiếp 5 lần sai nữa (trước đó đã có 2 lần sai ở mục 2)
        for (let i = 1; i <= 6; i++) {
            const res = await fetch(`${BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: testEmail, password: `WrongAttempt_${i}` })
            });
            if (res.status === 429) {
                wasRateLimited = true;
                const errData = await res.json();
                assert.strictEqual(errData.error, 'TOO_MANY_REQUESTS');
                console.log(`  ✅ Đã kích hoạt 429 TOO_MANY_REQUESTS ở lần thử thứ ${i + 2}.`);
                break;
            }
        }
        assert.ok(wasRateLimited, "Phải kích hoạt Rate Limiting 429 sau quá 5 lần thử sai");
        console.log("  ✅ 6.1 Rate Limiting chống Brute-force hoạt động chính xác (HTTP 429).");

        console.log("\n==================================================================");
        console.log("🎉 TẤT CẢ CÁC BƯỚC KIỂM THỬ AUTH & VIP TRIAL ĐÃ THÀNH CÔNG 100%!");
        console.log("==================================================================");

    } finally {
        // Dọn dẹp dữ liệu test trong database
        console.log("\n🧹 Dọn dẹp dữ liệu test trong database...");
        if (testUserId) {
            await db.collection('users').deleteOne({ _id: testUserId });
        }
        await db.collection('live_vouchers').deleteMany({ code: { $regex: `^TEST_VIP_${testTimestamp}` } });
        console.log("✨ Đã dọn dẹp sạch sẽ.");
    }
}

runTests().catch(err => {
    console.error("❌ TEST THẤT BẠI:", err);
    process.exit(1);
});

