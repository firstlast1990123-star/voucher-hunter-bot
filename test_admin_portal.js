const assert = require('assert');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const jwt = require('jsonwebtoken');
const { connectDB, getDB } = require('./backend/db');
const app = require('./backend/server-app');

const JWT_SECRET = process.env.JWT_SECRET || '9771ca0f7da23f5ba8e4e9062f126607e72b1d4479788ee88ccead46fed11bc3';
const ADMIN_EMAIL = 'firstlast1990123@gmail.com';
const NORMAL_EMAIL = 'normal_user_test@example.com';
const TARGET_USER_EMAIL = 'vip_target_test@example.com';

let server;
let baseUrl;

async function request(urlPath, options = {}) {
    const res = await fetch(`${baseUrl}${urlPath}`, {
        method: options.method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body: data };
}

async function runTests() {
    console.log('='.repeat(80));
    console.log('🚀 BẮT ĐẦU TEST TOÀN DIỆN TRANG ADMIN QUẢN TRỊ VOUCHER & BẢO MẬT');
    console.log('='.repeat(80));

    await connectDB();
    const db = getDB();

    // Dọn dẹp dữ liệu test cũ nếu có
    await db.collection('users').deleteMany({
        email: { $in: [ADMIN_EMAIL, NORMAL_EMAIL, TARGET_USER_EMAIL] }
    });
    await db.collection('live_vouchers').deleteMany({ code: /^TEST_ADMIN_/ });
    await db.collection('pending_vouchers').deleteMany({ code: /^TEST_ADMIN_/ });

    // Tạo các user thử nghiệm
    const adminUser = {
        _id: 'user_test_admin_001',
        email: ADMIN_EMAIL,
        password_hash: 'mock_hash',
        membership: 'vip',
        created_at: new Date().toISOString()
    };
    const normalUser = {
        _id: 'user_test_normal_002',
        email: NORMAL_EMAIL,
        password_hash: 'mock_hash',
        membership: 'free',
        created_at: new Date().toISOString()
    };
    const targetUser = {
        _id: 'user_test_target_003',
        email: TARGET_USER_EMAIL,
        password_hash: 'mock_hash',
        membership: 'free',
        current_plan: null,
        vip_expired_at: null,
        created_at: new Date().toISOString()
    };

    await db.collection('users').insertMany([adminUser, normalUser, targetUser]);

    // Tạo JWT Tokens
    const adminToken = jwt.sign({ user_id: adminUser._id, email: adminUser.email }, JWT_SECRET, { expiresIn: '1h' });
    const normalToken = jwt.sign({ user_id: normalUser._id, email: normalUser.email }, JWT_SECRET, { expiresIn: '1h' });

    // Khởi động server test trên port ngẫu nhiên
    await new Promise((resolve) => {
        server = app.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://localhost:${port}`;
            console.log(`📡 Test server running at ${baseUrl}`);
            resolve();
        });
    });

    try {
        // -------------------------------------------------------------
        // TEST 1: Request không có Token -> 401 UNAUTHORIZED
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 1] Gọi /api/admin/check khi CHƯA đăng nhập (Không có JWT):');
        const res1 = await request('/api/admin/check');
        console.log(`  Status: ${res1.status}, Error: ${res1.body?.error}`);
        assert.strictEqual(res1.status, 401, 'Phải trả về 401 khi không có JWT');
        assert.strictEqual(res1.body?.error, 'UNAUTHORIZED');
        console.log('  ✅ PASSED: Chặn 401 thành công với request chưa đăng nhập!');

        // -------------------------------------------------------------
        // TEST 2: Tài khoản THƯỜNG (không có trong ADMIN_EMAILS) -> 403 FORBIDDEN
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 2] Gọi /api/admin/check bằng tài khoản THƯỜNG (Email không trong ADMIN_EMAILS):');
        const res2 = await request('/api/admin/check', {
            headers: { 'Authorization': `Bearer ${normalToken}` }
        });
        console.log(`  Status: ${res2.status}, Error: ${res2.body?.error}`);
        assert.strictEqual(res2.status, 403, 'Phải trả về 403 khi email không phải admin');
        assert.strictEqual(res2.body?.error, 'FORBIDDEN');
        console.log('  ✅ PASSED: Chặn 403 FORBIDDEN thành công đối với tài khoản thường!');

        // -------------------------------------------------------------
        // TEST 3: Tài khoản thường thử truy cập các API admin khác
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 3] Thử gọi các API admin khác bằng token của tài khoản thường:');
        const [dashRes, vouchRes, grantRes] = await Promise.all([
            request('/api/admin/dashboard', { headers: { 'Authorization': `Bearer ${normalToken}` } }),
            request('/api/admin/vouchers', { headers: { 'Authorization': `Bearer ${normalToken}` } }),
            request('/api/admin/users/grant-vip', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${normalToken}` },
                body: { email: TARGET_USER_EMAIL, plan: 'vip_weekly', reason: 'Test exploit' }
            })
        ]);
        assert.strictEqual(dashRes.status, 403);
        assert.strictEqual(vouchRes.status, 403);
        assert.strictEqual(grantRes.status, 403);
        console.log('  ✅ PASSED: Tất cả các route /api/admin/* đều chặn 403 tuyệt đối với user thường!');

        // -------------------------------------------------------------
        // TEST 4: Tài khoản ADMIN thật -> 200 OK
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 4] Gọi /api/admin/check bằng tài khoản ADMIN thật:');
        const res4 = await request('/api/admin/check', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        console.log(`  Status: ${res4.status}, admin_email: ${res4.body?.admin_email}`);
        assert.strictEqual(res4.status, 200);
        assert.strictEqual(res4.body?.success, true);
        assert.strictEqual(res4.body?.admin_email, ADMIN_EMAIL);
        console.log('  ✅ PASSED: Xác thực Admin thành công 200 OK!');

        // -------------------------------------------------------------
        // TEST 5: GET /api/admin/dashboard
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 5] Lấy dữ liệu Dashboard & Bot health:');
        const res5 = await request('/api/admin/dashboard', {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(res5.status, 200);
        assert.ok(res5.body.bots, 'Phải có trường bots');
        assert.ok(res5.body.stats, 'Phải có trường stats');
        console.log('  Stats trả về:', res5.body.stats);
        console.log('  ✅ PASSED: Dashboard trả về đầy đủ số liệu thống kê & bot health!');

        // -------------------------------------------------------------
        // TEST 6: Thao tác Voucher (Thêm -> Sửa -> Duyệt -> Xóa)
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 6] Quản lý Voucher (Thêm pending -> Sửa -> Duyệt lên Live -> Xóa):');
        const testCode = 'TEST_ADMIN_VOUCHER_999';
        // 6a: Thêm vào pending
        const addRes = await request('/api/admin/vouchers', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: {
                merchant: 'Shopee',
                voucher_type: 'code',
                code: testCode,
                title: 'Giảm 50K đơn từ 200K (Admin test)',
                discount_type: 'fixed',
                discount_value: 50000,
                min_order_value: 200000,
                valid_to: new Date(Date.now() + 86400000 * 5).toISOString(),
                landing_url: 'https://shopee.vn/m/ma-giam-gia',
                target: 'pending'
            }
        });
        assert.strictEqual(addRes.status, 201, 'Thêm voucher mới phải trả về 201');
        const pendingInDb = await db.collection('pending_vouchers').findOne({ code: testCode });
        assert.ok(pendingInDb, 'Voucher phải nằm trong pending_vouchers');
        console.log('  6a: Thêm pending voucher thành công.');

        // 6b: Sửa voucher
        const editRes = await request(`/api/admin/vouchers/${testCode}?type=pending`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: {
                title: 'Giảm 70K đơn từ 200K (Đã sửa)',
                discount_value: 70000
            }
        });
        assert.strictEqual(editRes.status, 200);
        const updatedPending = await db.collection('pending_vouchers').findOne({ code: testCode });
        assert.strictEqual(updatedPending.discount_value, 70000);
        console.log('  6b: Sửa voucher trong pending_vouchers thành công.');

        // 6c: Duyệt tay voucher lên live_vouchers
        const approveRes = await request(`/api/admin/vouchers/approve/${testCode}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(approveRes.status, 200);
        const liveDoc = await db.collection('live_vouchers').findOne({ code: testCode });
        assert.ok(liveDoc, 'Voucher phải được đẩy sang live_vouchers');
        assert.strictEqual(liveDoc.status, 'live');
        const pendingAfter = await db.collection('pending_vouchers').findOne({ code: testCode });
        assert.strictEqual(pendingAfter, null, 'Voucher phải bị xóa khỏi pending_vouchers sau khi duyệt');
        console.log('  6c: Duyệt tay đẩy lên live_vouchers thành công.');

        // 6d: Xóa voucher khỏi live_vouchers
        const delRes = await request(`/api/admin/vouchers/${testCode}?type=live`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(delRes.status, 200);
        const liveAfter = await db.collection('live_vouchers').findOne({ code: testCode });
        assert.strictEqual(liveAfter, null, 'Voucher phải bị xóa khỏi live_vouchers');
        console.log('  6d: Xóa voucher thành công.');
        console.log('  ✅ PASSED: Toàn bộ quy trình Thêm -> Sửa -> Duyệt -> Xóa voucher hoạt động chính xác 100%!');

        // -------------------------------------------------------------
        // TEST 7: Validate "Lý do" khi cấp VIP thủ công
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 7] Kiểm tra validation khi Cấp VIP thủ công (Bỏ trống hoặc quá ngắn):');
        // 7a: Thiếu lý do
        const noReasonRes = await request('/api/admin/users/grant-vip', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { email: TARGET_USER_EMAIL, plan: 'vip_weekly', reason: '' }
        });
        assert.strictEqual(noReasonRes.status, 400);
        console.log('  7a: Bỏ trống lý do -> Chặn 400 OK:', noReasonRes.body?.message);

        // 7b: Lý do quá ngắn (< 5 ký tự)
        const shortReasonRes = await request('/api/admin/users/grant-vip', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { email: TARGET_USER_EMAIL, plan: 'vip_weekly', reason: 'ok' }
        });
        assert.strictEqual(shortReasonRes.status, 400);
        console.log('  7b: Lý do < 5 ký tự -> Chặn 400 OK:', shortReasonRes.body?.message);
        console.log('  ✅ PASSED: Bắt buộc lý do tối thiểu 5 ký tự bảo vệ chống cấp gian lận!');

        // -------------------------------------------------------------
        // TEST 8: Cấp VIP thủ công cho tài khoản Free
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 8] Cấp VIP Tuần (7 ngày) thủ công cho tài khoản Free:');
        const reason1 = 'Đã đối chiếu ảnh chuyển khoản khớp giao dịch PayOS #102938';
        const grantRes1 = await request('/api/admin/users/grant-vip', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { email: TARGET_USER_EMAIL, plan: 'vip_weekly', reason: reason1 }
        });
        assert.strictEqual(grantRes1.status, 200);
        assert.strictEqual(grantRes1.body?.user?.membership, 'vip');
        assert.strictEqual(grantRes1.body?.user?.current_plan, 'vip_weekly');

        const userAfterGrant1 = await db.collection('users').findOne({ email: TARGET_USER_EMAIL });
        assert.strictEqual(userAfterGrant1.membership, 'vip');
        assert.strictEqual(userAfterGrant1.current_plan, 'vip_weekly');
        assert.ok(userAfterGrant1.vip_expired_at, 'Phải có vip_expired_at');
        assert.strictEqual(userAfterGrant1.manual_vip_grants.length, 1);
        assert.strictEqual(userAfterGrant1.manual_vip_grants[0].reason, reason1);
        assert.strictEqual(userAfterGrant1.manual_vip_grants[0].admin_email, ADMIN_EMAIL);
        assert.strictEqual(userAfterGrant1.manual_vip_grants[0].plan, 'vip_weekly');
        console.log(`  Hạn VIP mới: ${userAfterGrant1.vip_expired_at}`);
        console.log('  ✅ PASSED: Cấp VIP Tuần và ghi nhận Audit Log vào manual_vip_grants thành công!');

        // -------------------------------------------------------------
        // TEST 9: Cấp VIP cộng dồn khi user đang còn hạn
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 9] Cấp tiếp VIP Tháng (30 ngày) cho user ĐANG CÒN HẠN (Cộng dồn):');
        const previousExpiry = new Date(userAfterGrant1.vip_expired_at);
        const reason2 = 'Bổ sung thêm 30 ngày theo thỏa thuận khiếu nại đối chiếu PayOS';
        const grantRes2 = await request('/api/admin/users/grant-vip', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${adminToken}` },
            body: { email: TARGET_USER_EMAIL, plan: 'vip_monthly', reason: reason2 }
        });
        assert.strictEqual(grantRes2.status, 200);

        const userAfterGrant2 = await db.collection('users').findOne({ email: TARGET_USER_EMAIL });
        const newExpiry = new Date(userAfterGrant2.vip_expired_at);
        // Hạn mới phải bằng hạn cũ + 30 ngày (cho phép sai số 1-2 giây)
        const diffDays = Math.round((newExpiry.getTime() - previousExpiry.getTime()) / (1000 * 60 * 60 * 24));
        console.log(`  Hạn cũ: ${previousExpiry.toISOString()} -> Hạn mới: ${newExpiry.toISOString()} (Thêm đúng ${diffDays} ngày)`);
        assert.strictEqual(diffDays, 30, 'Phải cộng dồn thêm đúng 30 ngày vào hạn cũ');
        assert.strictEqual(userAfterGrant2.manual_vip_grants.length, 2, 'Phải có 2 bản ghi log');
        assert.strictEqual(userAfterGrant2.manual_vip_grants[1].reason, reason2);
        console.log('  ✅ PASSED: Tính năng cộng dồn hạn VIP qua calculateVipExpiry() hoạt động chính xác 100%!');

        // -------------------------------------------------------------
        // TEST 10: Xem chi tiết User & Lịch sử đơn hàng (GET /api/admin/users/:email/details)
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 10] Tra cứu chi tiết user kèm đơn hàng:');
        // Tạo đơn hàng mẫu cho target user
        await db.collection('payment_orders').insertOne({
            _id: 987654321,
            user_id: targetUser._id,
            plan: 'vip_weekly',
            amount: 10000,
            status: 'paid',
            created_at: new Date().toISOString(),
            paid_at: new Date().toISOString()
        });

        const detailRes = await request(`/api/admin/users/${encodeURIComponent(TARGET_USER_EMAIL)}/details`, {
            headers: { 'Authorization': `Bearer ${adminToken}` }
        });
        assert.strictEqual(detailRes.status, 200);
        assert.strictEqual(detailRes.body.user.email, TARGET_USER_EMAIL);
        assert.strictEqual(detailRes.body.user.password_hash, undefined, 'Tuyệt đối KHÔNG ĐƯỢC để lộ password_hash');
        assert.strictEqual(detailRes.body.orders.length, 1);
        assert.strictEqual(detailRes.body.orders[0]._id, 987654321);
        console.log('  User detail trả về không có password_hash, có 1 đơn hàng để đối chiếu PayOS.');
        console.log('  ✅ PASSED: Tra cứu chi tiết user và bảo mật mật khẩu thành công!');

        // -------------------------------------------------------------
        // TEST 11: Route phục vụ admin.html
        // -------------------------------------------------------------
        console.log('\n▶ [TEST 11] Kiểm tra route /admin trả về file HTML có lớp bảo vệ auth-guard:');
        const htmlRes = await fetch(`${baseUrl}/admin`);
        assert.strictEqual(htmlRes.status, 200);
        const htmlText = await htmlRes.text();
        assert.ok(htmlText.includes('id="auth-guard"'), 'admin.html phải có thẻ auth-guard');
        assert.ok(htmlText.includes('ADMIN PORTAL'), 'admin.html phải có text ADMIN PORTAL');
        console.log('  ✅ PASSED: /admin phục vụ giao diện HTML chuẩn kèm zero-flash auth guard!');

    } finally {
        // Dọn dẹp dữ liệu test
        await db.collection('users').deleteMany({
            email: { $in: [ADMIN_EMAIL, NORMAL_EMAIL, TARGET_USER_EMAIL] }
        });
        await db.collection('live_vouchers').deleteMany({ code: /^TEST_ADMIN_/ });
        await db.collection('pending_vouchers').deleteMany({ code: /^TEST_ADMIN_/ });
        await db.collection('payment_orders').deleteMany({ _id: 987654321 });

        if (server) {
            server.close();
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log('🎉 TẤT CẢ 11/11 BÀI TEST ADMIN PORTAL & BẢO MẬT ĐÃ VƯỢT QUA 100%!');
    console.log('='.repeat(80));
}

runTests().then(() => {
    process.exit(0);
}).catch((err) => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
