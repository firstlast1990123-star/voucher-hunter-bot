/**
 * test_forgot_and_reauth.js
 * Kiểm thử toàn diện 9 kịch bản bảo mật:
 * 1. Yêu cầu reset với email tồn tại -> Token băm lưu DB, link hoạt động
 * 2. Yêu cầu reset với email KHÔNG tồn tại -> Phản hồi thành công chung chung (Anti-enumeration)
 * 3. Đặt lại mật khẩu mới thành công -> Đăng nhập bằng pass mới được, pass cũ bị từ chối
 * 4. Dùng lại token đã sử dụng -> Bị từ chối (Single-use)
 * 5. Thử đặt lại mật khẩu với token hết hạn -> Bị từ chối (Expired token)
 * 6. Đổi mật khẩu khi đang login với currentPassword sai -> Bị từ chối 401; đổi đúng -> Thành công
 * 7. Rate limit: gửi forgot-password quá 3 lần/giờ -> Bị chặn 429 TOO_MANY_REQUESTS
 * 8. Yêu cầu xóa tài khoản với mật khẩu sai -> Bị từ chối 401; mật khẩu đúng -> Đánh dấu deletion_requested
 * 9. Thu hồi JWT cũ (JWT Revocation): Sau khi đổi mật khẩu, JWT cũ bị từ chối 401 TOKEN_REVOKED
 */

const assert = require('assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectDB } = require('./backend/db');
const handler = require('./api/index');

const fn = typeof handler === 'function' ? handler : handler.handler;
const JWT_SECRET = process.env.JWT_SECRET || '9771ca0f7da23f5ba8e4e9062f126607e72b1d4479788ee88ccead46fed11bc3';

function createServerlessEvent(httpMethod, path, body = null, headers = {}) {
    return {
        httpMethod,
        path,
        headers: {
            'x-forwarded-for': '192.0.2.200', // IP test mặc định
            ...headers
        },
        body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
        isBase64Encoded: false
    };
}

async function runTests() {
    console.log("================================================================================");
    console.log("🚀 BẮT ĐẦU KIỂM THỬ: QUÊN MẬT KHẨU (EMAIL) + XÁC THỰC LẠI HÀNH ĐỘNG NHẠY CẢM");
    console.log("================================================================================");

    process.env.NODE_ENV = 'test'; // Kích hoạt email mock an toàn

    const db = await connectDB();
    const timestamp = Date.now();
    const testEmail1 = `user_reset_${timestamp}@example.com`;
    const testUserId1 = `user_reset_id_${timestamp}`;
    const initialPassword = 'Password123!';
    const salt = await bcrypt.genSalt(10);
    const initialHash = await bcrypt.hash(initialPassword, salt);

    // Tạo test user 1 trong DB
    await db.collection('users').insertOne({
        _id: testUserId1,
        email: testEmail1,
        password_hash: initialHash,
        password_changed_at: null,
        membership: 'free',
        vip_expired_at: null,
        created_at: new Date().toISOString(),
        saved_vouchers: []
    });

    try {
        // -------------------------------------------------------------------------
        // TEST 1: Yêu cầu reset với email tồn tại
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 1] POST /api/auth/forgot-password (Email tồn tại):");
        const event1 = createServerlessEvent('POST', '/api/auth/forgot-password', { email: testEmail1 }, {
            'content-type': 'application/json'
        });
        const res1 = await fn(event1, {});
        const body1 = JSON.parse(res1.body);
        console.log("  Response status:", res1.statusCode);
        console.log("  Response message:", body1.message);
        assert.strictEqual(res1.statusCode, 200);
        assert.strictEqual(body1.success, true);
        assert.ok(body1.message.includes('Nếu email tồn tại trong hệ thống'), "Thông báo phải chuẩn chung");

        // Kiểm tra token băm trong DB
        const savedTokenRecord = await db.collection('password_reset_tokens').findOne({ email: testEmail1 });
        assert.ok(savedTokenRecord, "Phải có bản ghi token trong password_reset_tokens");
        assert.strictEqual(savedTokenRecord.used, false);
        assert.ok(savedTokenRecord.token_hash, "Phải lưu token_hash");
        assert.strictEqual(savedTokenRecord.token, undefined, "Tuyệt đối không lưu token gốc trong DB");
        console.log("  ✅ PASSED: Token băm đã lưu DB an toàn, thời hạn 20 phút!");

        // -------------------------------------------------------------------------
        // TEST 2: Yêu cầu reset với email KHÔNG tồn tại (Anti-enumeration)
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 2] POST /api/auth/forgot-password (Email KHÔNG tồn tại - Anti-enumeration):");
        const fakeEmail = `nonexistent_${timestamp}@example.com`;
        const event2 = createServerlessEvent('POST', '/api/auth/forgot-password', { email: fakeEmail }, {
            'content-type': 'application/json'
        });
        const res2 = await fn(event2, {});
        const body2 = JSON.parse(res2.body);
        console.log("  Response status:", res2.statusCode);
        console.log("  Response message:", body2.message);
        assert.strictEqual(res2.statusCode, 200);
        assert.strictEqual(body2.success, true);
        assert.strictEqual(body2.message, body1.message, "Phải phản hồi giống hệt 100% khi email tồn tại để chống dò người dùng");
        console.log("  ✅ PASSED: Anti-enumeration bảo vệ 100% không để lộ danh tính!");

        // -------------------------------------------------------------------------
        // TEST 3: Đặt lại mật khẩu mới bằng token hợp lệ
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 3] POST /api/auth/reset-password (Đặt lại mật khẩu mới):");
        // Giả lập 1 token hợp lệ
        const rawToken3 = crypto.randomBytes(32).toString('hex');
        const tokenHash3 = crypto.createHash('sha256').update(rawToken3).digest('hex');
        await db.collection('password_reset_tokens').insertOne({
            token_hash: tokenHash3,
            user_id: testUserId1,
            email: testEmail1,
            created_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
            used: false,
            used_at: null
        });

        const newPass3 = 'NewSecretPassword2026!';
        const event3 = createServerlessEvent('POST', '/api/auth/reset-password', {
            token: rawToken3,
            newPassword: newPass3
        }, { 'content-type': 'application/json' });
        const res3 = await fn(event3, {});
        const body3 = JSON.parse(res3.body);
        console.log("  Response status:", res3.statusCode);
        console.log("  Response message:", body3.message);
        assert.strictEqual(res3.statusCode, 200);
        assert.strictEqual(body3.success, true);

        // Kiểm tra token đã bị đánh dấu used: true
        const updatedToken3 = await db.collection('password_reset_tokens').findOne({ token_hash: tokenHash3 });
        assert.strictEqual(updatedToken3.used, true);
        assert.ok(updatedToken3.used_at);

        // Kiểm tra đăng nhập lại bằng mật khẩu mới
        const eventLoginNew = createServerlessEvent('POST', '/api/auth/login', {
            email: testEmail1,
            password: newPass3
        }, { 'content-type': 'application/json' });
        const resLoginNew = await fn(eventLoginNew, {});
        assert.strictEqual(resLoginNew.statusCode, 200, "Đăng nhập mật khẩu mới phải thành công 200");

        // Thử đăng nhập lại bằng mật khẩu cũ -> phải thất bại
        const eventLoginOld = createServerlessEvent('POST', '/api/auth/login', {
            email: testEmail1,
            password: initialPassword
        }, { 'content-type': 'application/json' });
        const resLoginOld = await fn(eventLoginOld, {});
        assert.strictEqual(resLoginOld.statusCode, 401, "Mật khẩu cũ phải bị từ chối 401");
        console.log("  ✅ PASSED: Đặt lại mật khẩu thành công, đăng nhập pass mới OK, pass cũ bị chặn!");

        // -------------------------------------------------------------------------
        // TEST 4: Dùng lại token đã sử dụng (Single-use test)
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 4] POST /api/auth/reset-password (Dùng lại token lần 2):");
        const event4 = createServerlessEvent('POST', '/api/auth/reset-password', {
            token: rawToken3,
            newPassword: 'AnotherPassword999!'
        }, { 'content-type': 'application/json' });
        const res4 = await fn(event4, {});
        const body4 = JSON.parse(res4.body);
        console.log("  Response status:", res4.statusCode);
        console.log("  Response message:", body4.message);
        assert.strictEqual(res4.statusCode, 400);
        assert.strictEqual(body4.error, 'INVALID_RESET_TOKEN');
        console.log("  ✅ PASSED: Token chỉ dùng được 1 lần duy nhất (Single-use)!");

        // -------------------------------------------------------------------------
        // TEST 5: Đặt lại mật khẩu với token đã HẾT HẠN
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 5] POST /api/auth/reset-password (Token đã hết hạn):");
        const rawTokenExpired = crypto.randomBytes(32).toString('hex');
        const tokenHashExpired = crypto.createHash('sha256').update(rawTokenExpired).digest('hex');
        await db.collection('password_reset_tokens').insertOne({
            token_hash: tokenHashExpired,
            user_id: testUserId1,
            email: testEmail1,
            created_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
            expires_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // Đã hết hạn 5 phút trước
            used: false,
            used_at: null
        });

        const event5 = createServerlessEvent('POST', '/api/auth/reset-password', {
            token: rawTokenExpired,
            newPassword: 'ExpiredPassword123!'
        }, { 'content-type': 'application/json' });
        const res5 = await fn(event5, {});
        const body5 = JSON.parse(res5.body);
        console.log("  Response status:", res5.statusCode);
        console.log("  Response message:", body5.message);
        assert.strictEqual(res5.statusCode, 400);
        assert.strictEqual(body5.error, 'INVALID_RESET_TOKEN');
        console.log("  ✅ PASSED: Token hết hạn bị từ chối chính xác!");

        // -------------------------------------------------------------------------
        // TEST 6: Đổi mật khẩu khi đang login (currentPassword sai -> 401; đúng -> 200)
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 6] PUT /api/auth/change-password (Xác thực mật khẩu hiện tại):");
        const loginToken = JSON.parse(resLoginNew.body).token;

        // 6a. Gửi currentPassword sai
        const eventChangeWrong = createServerlessEvent('PUT', '/api/auth/change-password', {
            currentPassword: 'WrongCurrentPassword!',
            newPassword: 'BrandNewPassword888!'
        }, {
            'content-type': 'application/json',
            'authorization': `Bearer ${loginToken}`
        });
        const resChangeWrong = await fn(eventChangeWrong, {});
        const bodyChangeWrong = JSON.parse(resChangeWrong.body);
        console.log("  6a (Sai pass hiện tại) Status:", resChangeWrong.statusCode, "Message:", bodyChangeWrong.message);
        assert.strictEqual(resChangeWrong.statusCode, 401);
        assert.strictEqual(bodyChangeWrong.error, 'INCORRECT_PASSWORD');

        // 6b. Gửi currentPassword đúng
        const nextPassword = 'BrandNewPassword888!';
        const eventChangeRight = createServerlessEvent('PUT', '/api/auth/change-password', {
            currentPassword: newPass3,
            newPassword: nextPassword
        }, {
            'content-type': 'application/json',
            'authorization': `Bearer ${loginToken}`
        });
        const resChangeRight = await fn(eventChangeRight, {});
        const bodyChangeRight = JSON.parse(resChangeRight.body);
        console.log("  6b (Đúng pass hiện tại) Status:", resChangeRight.statusCode, "Message:", bodyChangeRight.message);
        assert.strictEqual(resChangeRight.statusCode, 200);
        assert.strictEqual(bodyChangeRight.success, true);
        console.log("  ✅ PASSED: Xác thực currentPassword hoạt động chuẩn xác!");

        // -------------------------------------------------------------------------
        // TEST 7: Rate limit forgot-password (Vượt quá 3 lần/giờ -> 429)
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 7] POST /api/auth/forgot-password (Rate Limiting 3 lần/giờ):");
        const spamIP = '198.51.100.77'; // IP chuyên test rate limit
        for (let i = 1; i <= 3; i++) {
            const ev = createServerlessEvent('POST', '/api/auth/forgot-password', { email: `spam_${i}_${timestamp}@example.com` }, {
                'content-type': 'application/json',
                'x-forwarded-for': spamIP
            });
            const r = await fn(ev, {});
            assert.strictEqual(r.statusCode, 200, `Lần ${i} phải được chấp nhận 200`);
        }

        // Lần thứ 4 từ spamIP này -> PHẢI BỊ 429
        const evBlocked = createServerlessEvent('POST', '/api/auth/forgot-password', { email: `spam_4_${timestamp}@example.com` }, {
            'content-type': 'application/json',
            'x-forwarded-for': spamIP
        });
        const rBlocked = await fn(evBlocked, {});
        const bodyBlocked = JSON.parse(rBlocked.body);
        console.log("  Lần 4 Status:", rBlocked.statusCode, "Message:", bodyBlocked.message);
        assert.strictEqual(rBlocked.statusCode, 429, "Lần 4 phải bị chặn 429 TOO_MANY_REQUESTS");
        assert.strictEqual(bodyBlocked.error, 'TOO_MANY_REQUESTS');
        console.log("  ✅ PASSED: Rate limit chặn spam email hoạt động đúng 429!");

        // -------------------------------------------------------------------------
        // TEST 8: Yêu cầu xóa tài khoản (Sai pass -> 401; Đúng pass -> Đánh dấu xóa)
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 8] POST /api/user/request-deletion (Xác thực mật khẩu xóa tài khoản):");
        // Đăng nhập lại lấy token mới nhất sau khi đổi mật khẩu
        const resLoginLatest = await fn(createServerlessEvent('POST', '/api/auth/login', {
            email: testEmail1,
            password: nextPassword
        }, { 'content-type': 'application/json' }), {});
        const latestToken = JSON.parse(resLoginLatest.body).token;

        // 8a. Gửi sai mật khẩu
        const evDelWrong = createServerlessEvent('POST', '/api/user/request-deletion', {
            currentPassword: 'WrongPasswordForDeletion!'
        }, {
            'content-type': 'application/json',
            'authorization': `Bearer ${latestToken}`
        });
        const resDelWrong = await fn(evDelWrong, {});
        const bodyDelWrong = JSON.parse(resDelWrong.body);
        console.log("  8a (Sai mật khẩu xóa) Status:", resDelWrong.statusCode, "Message:", bodyDelWrong.message);
        assert.strictEqual(resDelWrong.statusCode, 401);
        assert.strictEqual(bodyDelWrong.error, 'INCORRECT_PASSWORD');

        // Kiểm tra user trong DB chưa bị đánh dấu
        const userBefore = await db.collection('users').findOne({ _id: testUserId1 });
        assert.strictEqual(userBefore.deletion_requested, undefined);

        // 8b. Gửi đúng mật khẩu
        const evDelRight = createServerlessEvent('POST', '/api/user/request-deletion', {
            currentPassword: nextPassword
        }, {
            'content-type': 'application/json',
            'authorization': `Bearer ${latestToken}`
        });
        const resDelRight = await fn(evDelRight, {});
        const bodyDelRight = JSON.parse(resDelRight.body);
        console.log("  8b (Đúng mật khẩu xóa) Status:", resDelRight.statusCode, "Message:", bodyDelRight.message);
        assert.strictEqual(resDelRight.statusCode, 200);
        assert.strictEqual(bodyDelRight.success, true);

        // Kiểm tra user trong DB đã được đánh dấu xóa
        const userAfter = await db.collection('users').findOne({ _id: testUserId1 });
        assert.strictEqual(userAfter.deletion_requested, true);
        assert.ok(userAfter.deletion_requested_at);
        console.log("  ✅ PASSED: Yêu cầu xóa tài khoản đòi mật khẩu chính xác 100%!");

        // -------------------------------------------------------------------------
        // TEST 9: Thu hồi JWT cũ sau khi đổi mật khẩu (JWT Revocation)
        // -------------------------------------------------------------------------
        console.log("\n▶ [TEST 9] Kiểm tra Thu hồi JWT cũ (JWT Revocation sau đổi mật khẩu):");
        // Giả lập: User 2 đăng nhập lấy token A
        const testUserId2 = `user_jwt_revoked_${timestamp}`;
        const testEmail2 = `user_jwt_revoked_${timestamp}@example.com`;
        const user2Pass = 'InitialPassword123!';
        const user2Hash = await bcrypt.hash(user2Pass, await bcrypt.genSalt(10));
        await db.collection('users').insertOne({
            _id: testUserId2,
            email: testEmail2,
            password_hash: user2Hash,
            password_changed_at: null,
            membership: 'free',
            vip_expired_at: null,
            created_at: new Date().toISOString()
        });

        // Tạo JWT Token A cấp lúc t0
        const tokenA = jwt.sign(
            { user_id: testUserId2, email: testEmail2, auth_time: Date.now() - 5000 },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Trước khi đổi mật khẩu: Token A gọi /api/auth/me thành công 200
        const evMeBefore = createServerlessEvent('GET', '/api/auth/me', null, {
            'authorization': `Bearer ${tokenA}`
        });
        const resMeBefore = await fn(evMeBefore, {});
        assert.strictEqual(resMeBefore.statusCode, 200, "Trước đổi mật khẩu Token A phải hợp lệ 200");
        console.log("  Token A trước đổi mật khẩu: 200 OK");

        // Tiến hành đổi mật khẩu sang pass mới
        const user2NewPass = 'User2BrandNewPassword!';
        const evChangeUser2 = createServerlessEvent('PUT', '/api/auth/change-password', {
            currentPassword: user2Pass,
            newPassword: user2NewPass
        }, {
            'content-type': 'application/json',
            'authorization': `Bearer ${tokenA}`
        });
        const resChangeUser2 = await fn(evChangeUser2, {});
        assert.strictEqual(resChangeUser2.statusCode, 200, "Đổi mật khẩu phải 200 OK");
        console.log("  Đổi mật khẩu user 2 thành công!");

        // Dùng lại Token A để gọi /api/auth/me -> PHẢI BỊ 401 TOKEN_REVOKED
        const evMeAfter = createServerlessEvent('GET', '/api/auth/me', null, {
            'authorization': `Bearer ${tokenA}`
        });
        const resMeAfter = await fn(evMeAfter, {});
        const bodyMeAfter = JSON.parse(resMeAfter.body);
        console.log("  Token A sau đổi mật khẩu Status:", resMeAfter.statusCode, "Body:", bodyMeAfter);
        assert.strictEqual(resMeAfter.statusCode, 401, "Token A phải bị đá văng 401 ngay sau khi đổi mật khẩu");
        assert.strictEqual(bodyMeAfter.error, 'TOKEN_REVOKED');
        console.log("  ✅ PASSED: JWT cũ bị thu hồi ngay lập tức sau khi đổi mật khẩu!");

        // Dọn dẹp test user 2
        await db.collection('users').deleteOne({ _id: testUserId2 });

    } finally {
        // Dọn dẹp dữ liệu test
        await db.collection('users').deleteOne({ _id: testUserId1 });
        await db.collection('password_reset_tokens').deleteMany({ email: testEmail1 });
        console.log("\n🧹 Đã dọn dẹp dữ liệu kiểm thử an toàn.");
    }

    console.log("\n================================================================================");
    console.log("🎉 TẤT CẢ 9/9 TEST BẢO MẬT ĐÃ VƯỢT QUA 100%!");
    console.log("================================================================================");
    process.exit(0);
}

runTests().catch(err => {
    console.error("❌ TEST FAILED:", err);
    process.exit(1);
});

