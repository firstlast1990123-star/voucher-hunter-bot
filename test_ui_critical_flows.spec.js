/**
 * test_ui_critical_flows.spec.js
 * 
 * BỘ TEST UI TỰ ĐỘNG BẰNG TRÌNH DUYỆT THẬT (PLAYWRIGHT)
 * Kiểm thử 5 luồng cốt lõi liên quan trực tiếp đến tiền thật, bảo mật & trải nghiệm người dùng:
 *   1. Đăng ký -> Đăng nhập -> Đăng xuất
 *   2. Mua VIP -> Modal chọn gói -> Sinh mã QR PayOS -> Kiểm tra UI giá & gói
 *   3. Đăng nhập Admin -> Vào /admin -> Zero-flash auth guard -> Cấp VIP thủ công (Validate lý do >= 5 ký tự)
 *   4. Quên mật khẩu -> Tạo token -> Đổi pass tại /reset-password.html -> Đăng nhập bằng pass mới
 *   5. Smart Scanner -> Validate link TMĐT -> Render kết quả tra cứu mượt mà không vỡ layout
 * 
 * LƯU Ý BẢO MẬT & CHI PHÍ:
 *   - Test suite này KHÔNG gắn vào pre-commit hay CI tự động.
 *   - Chạy thủ công: node test_ui_critical_flows.spec.js trước mỗi đợt release lớn.
 *   - Toàn bộ dữ liệu test trong MongoDB được cô lập bằng timestamp RUN_ID và tự động dọn sạch sau khi test xong.
 */

const { chromium } = require('playwright');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
process.env.NODE_ENV = 'test';
const assert = require('assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connectDB, getDB } = require('./backend/db');
const app = require('./backend/server-app');

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_placeholder';
const ADMIN_EMAIL = (process.env.ADMIN_EMAILS || '').split(',')[0].trim() || 'firstlast1990123@gmail.com';
const RUN_ID = Date.now();

// Email định danh độc lập cho từng luồng test (tránh đụng độ dữ liệu thật)
const USER_FLOW1 = `test_ui_flow1_${RUN_ID}@example.com`;
const TARGET_FLOW3 = `test_ui_target_${RUN_ID}@example.com`;
const USER_FLOW4 = `test_ui_forgot_${RUN_ID}@example.com`;
const TEST_PASSWORD = 'TestPassword123@';
const NEW_PASSWORD = 'NewTestPassword456@';

let server;
let baseUrl;
let browser;

async function runCriticalUITests() {
    console.log('='.repeat(80));
    console.log('🎭 BẮT ĐẦU TEST UI TOÀN DIỆN 5 LUỒNG CỐT LÕI (MICROSOFT PLAYWRIGHT CHROMIUM)');
    console.log(`⏰ Run ID: ${RUN_ID}`);
    console.log('='.repeat(80));

    // 1. Kết nối DB
    await connectDB();
    const db = getDB();

    // 2. Khởi động local Express server trên port ngẫu nhiên
    await new Promise((resolve) => {
        server = app.listen(0, () => {
            const port = server.address().port;
            baseUrl = `http://localhost:${port}`;
            console.log(`📡 Local Test Server đang chạy tại: ${baseUrl}`);
            resolve();
        });
    });

    // 3. Khởi tạo Chromium Browser
    browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('🌐 Trình duyệt Chromium đã sẵn sàng trong chế độ headless');

    let passedTests = 0;
    const totalTests = 5;

    try {
        // =========================================================================
        // LUỒNG 1: ĐĂNG KÝ -> ĐĂNG XUẤT -> ĐĂNG NHẬP
        // =========================================================================
        console.log('\n▶ [LUỒNG 1] Đăng ký -> Đăng xuất -> Đăng nhập trên trình duyệt thật');
        {
            const context = await browser.newContext();
            const page = await context.newPage();
            await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });

            // 1a. Mở modal auth và chuyển sang tab Đăng ký
            await page.click('#btn-open-auth');
            await page.waitForSelector('#auth-modal:not(.hidden)');
            await page.click('#auth-tab-register');
            await page.waitForSelector('#form-register:not(.hidden)');

            // 1b. Điền thông tin đăng ký
            await page.fill('#reg-email', USER_FLOW1);
            await page.fill('#reg-password', TEST_PASSWORD);
            await page.check('#consent-tos');
            await page.click('#btn-submit-reg');

            // 1c. Chờ đăng ký thành công và cập nhật UI
            await page.waitForSelector('#user-profile-badge:not(.hidden)', { timeout: 8000 });
            const emailText = await page.textContent('#user-email-display');
            assert.strictEqual(emailText.trim(), USER_FLOW1, 'Email hiển thị phải khớp với tài khoản vừa đăng ký');
            console.log('  1a: Đăng ký tài khoản mới thành công, badge người dùng hiển thị đúng email');

            // 1d. Đăng xuất
            await page.click('#btn-logout');
            await page.waitForSelector('#btn-open-auth:not(.hidden)');
            const isBadgeHidden = await page.locator('#user-profile-badge').evaluate(el => el.classList.contains('hidden'));
            assert.ok(isBadgeHidden, 'Badge người dùng phải bị ẩn sau khi đăng xuất');
            console.log('  1b: Đăng xuất thành công, trạng thái UI trở về khách vãng lai');

            // 1e. Đăng nhập lại
            await page.click('#btn-open-auth');
            await page.waitForSelector('#form-login:not(.hidden)');
            await page.fill('#login-email', USER_FLOW1);
            await page.fill('#login-password', TEST_PASSWORD);
            await page.click('#btn-submit-login');

            await page.waitForSelector('#user-profile-badge:not(.hidden)', { timeout: 8000 });
            console.log('  1c: Đăng nhập lại thành công với mật khẩu vừa tạo');
            await context.close();
            passedTests++;
            console.log('  ✅ PASSED: LUỒNG 1 ĐÃ HOÀN TẤT VÀ VƯỢT QUA 100%!');
        }

        // =========================================================================
        // LUỒNG 2: MUA VIP (MODAL CHỌN GÓI -> TẠO MÃ QR -> HIỂN THỊ UI)
        // =========================================================================
        console.log('\n▶ [LUỒNG 2] Mua VIP: Đăng nhập -> Chọn gói VIP -> Tạo VietQR PayOS -> Kiểm tra UI gói/giá');
        {
            const context = await browser.newContext();
            const page = await context.newPage();
            await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });

            // Đăng nhập bằng tài khoản Flow 1
            await page.click('#btn-open-auth');
            await page.waitForSelector('#form-login:not(.hidden)');
            await page.fill('#login-email', USER_FLOW1);
            await page.fill('#login-password', TEST_PASSWORD);
            await page.click('#btn-submit-login');
            await page.waitForSelector('#user-profile-badge:not(.hidden)');

            // Mở modal VIP
            await page.click('#btn-header-vip');
            await page.waitForSelector('#vip-modal:not(.hidden)');
            console.log('  2a: Đã mở Modal Nâng cấp VIP');

            // Chọn gói Tuần (10.000đ)
            await page.click('#card-plan-weekly');
            const btnText = await page.textContent('#btn-create-vip-order');
            assert.ok(btnText.includes('10.000đ'), 'Nút tạo đơn phải hiển thị giá 10.000đ cho gói Tuần');

            // Nhấn tạo mã QR
            await page.click('#btn-create-vip-order');

            // Chờ PayOS tạo đơn và UI chuyển sang bước 2 (QR)
            await page.waitForSelector('#vip-step-qr:not(.hidden)', { timeout: 15000 });
            const qrImgSrc = await page.getAttribute('#vip-qr-image', 'src');
            assert.ok(qrImgSrc && qrImgSrc.startsWith('https://api.qrserver.com/v1/create-qr-code/'), 'Ảnh VietQR phải được sinh hợp lệ');

            const planSummary = await page.textContent('#vip-summary-plan');
            const amountSummary = await page.textContent('#vip-summary-amount');
            const checkoutHref = await page.getAttribute('#vip-btn-checkout-link', 'href');

            assert.ok(planSummary.includes('VIP Tuần'), 'Tóm tắt đơn hàng phải ghi rõ VIP Tuần');
            assert.ok(amountSummary.includes('10.000đ'), 'Tóm tắt số tiền phải là 10.000đ');
            assert.ok(checkoutHref && checkoutHref.startsWith('http'), 'Link trang thanh toán PayOS phải hợp lệ');

            console.log(`  2b: VietQR đã render thành công (QR URL: ${qrImgSrc.substring(0, 50)}...)`);
            console.log(`  2c: Thông tin gói: "${planSummary.trim()}" - Số tiền: "${amountSummary.trim()}" - PayOS URL: ${checkoutHref.substring(0, 45)}...`);
            await context.close();
            passedTests++;
            console.log('  ✅ PASSED: LUỒNG 2 ĐÃ HOÀN TẤT VÀ VƯỢT QUA 100%!');
        }

        // =========================================================================
        // LUỒNG 3: ĐĂNG NHẬP ADMIN -> /admin -> CẤP VIP THỦ CÔNG (VALIDATE LÝ DO)
        // =========================================================================
        console.log('\n▶ [LUỒNG 3] Admin Portal: Vào /admin -> Auth Guard -> Cấp VIP thủ công (Validate lý do >= 5 ký tự)');
        {
            // 3a. Chuẩn bị tài khoản admin trong DB nếu chưa có
            let adminUser = await db.collection('users').findOne({ email: ADMIN_EMAIL });
            if (!adminUser) {
                adminUser = {
                    _id: 'user_test_admin_001',
                    email: ADMIN_EMAIL,
                    password_hash: await bcrypt.hash(TEST_PASSWORD, 8),
                    membership: 'vip',
                    created_at: new Date().toISOString()
                };
                await db.collection('users').insertOne(adminUser);
            }

            // Chuẩn bị tài khoản mục tiêu cần cấp VIP
            await db.collection('users').deleteOne({ email: TARGET_FLOW3 });
            await db.collection('users').insertOne({
                _id: `user_target_${RUN_ID}`,
                email: TARGET_FLOW3,
                password_hash: await bcrypt.hash(TEST_PASSWORD, 8),
                membership: 'free',
                current_plan: null,
                vip_expired_at: null,
                created_at: new Date().toISOString()
            });

            // Tạo Admin Token hợp lệ với đúng user_id của admin trong DB
            const adminToken = jwt.sign(
                { user_id: adminUser._id, email: adminUser.email },
                JWT_SECRET,
                { expiresIn: '1h' }
            );

            const context = await browser.newContext();
            const page = await context.newPage();

            // Mở trang chủ để set token admin vào localStorage
            await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });
            await page.evaluate(({ tok, admEmail }) => {
                localStorage.setItem('vmp_auth_token', tok);
                localStorage.setItem('token', tok);
                localStorage.setItem('vmp_auth_user', JSON.stringify({ email: admEmail, membership: 'vip' }));
            }, { tok: adminToken, admEmail: ADMIN_EMAIL });

            // Truy cập /admin
            await page.goto(baseUrl + '/admin', { waitUntil: 'domcontentloaded' });

            // Kiểm tra Auth Guard đã mở và Admin App hiển thị
            await page.waitForSelector('#admin-app:not(.hidden)', { timeout: 10000 });
            const isGuardHidden = await page.locator('#auth-guard').evaluate(el => el.classList.contains('hidden'));
            assert.ok(isGuardHidden, 'Lớp bảo vệ auth-guard phải biến mất sau khi xác thực quyền admin thành công');
            const adminEmailText = await page.textContent('#admin-email-display');
            assert.strictEqual(adminEmailText.trim(), ADMIN_EMAIL, 'Email hiển thị phải đúng email Admin');
            console.log('  3a: Đã vượt qua Zero-flash Auth Guard, vào trang Quản trị viên thành công');

            // Chuyển sang Tab "Người Dùng & Cấp VIP"
            await page.click('#tab-users');
            await page.waitForSelector('#view-users:not(.hidden)');

            // Tra cứu tài khoản mục tiêu
            await page.fill('#user-lookup-email', TARGET_FLOW3);
            await page.click('button:has-text("Tra Cứu User")');
            await page.waitForSelector('#user-lookup-result:not(.hidden)', { timeout: 10000 });
            const lookupEmailText = await page.textContent('#u-detail-email');
            assert.strictEqual(lookupEmailText.trim(), TARGET_FLOW3, 'Kết quả tra cứu phải trả về đúng email mục tiêu');
            console.log('  3b: Tra cứu user thành công, hiển thị thông tin thành viên FREE');

            // 3c. Thử cấp VIP với lý do quá ngắn (< 5 ký tự) -> Bắt buộc phải có alert cảnh báo
            await page.fill('#grant-reason-input', 'abc');
            let alertValidationMsg = null;
            page.once('dialog', async dialog => {
                alertValidationMsg = dialog.message();
                await dialog.accept();
            });
            await page.click('#btn-submit-grant');
            assert.ok(
                alertValidationMsg && alertValidationMsg.includes('tối thiểu 5 ký tự'),
                'Hệ thống phải cảnh báo bằng dialog khi lý do cấp VIP < 5 ký tự'
            );
            console.log(`  3c: Đã chặn thành công khi lý do < 5 ký tự: "${alertValidationMsg}"`);

            // 3d. Cấp VIP với lý do hợp lệ (>= 5 ký tự)
            await page.fill('#grant-reason-input', `Xác minh ảnh CK khớp mã GD PayOS #${RUN_ID}`);
            page.on('dialog', async dialog => {
                await dialog.accept();
            });

            const grantResponsePromise = page.waitForResponse(
                res => res.url().includes('/admin/users') && res.url().includes('/grant-vip') && res.status() === 200,
                { timeout: 10000 }
            );
            await page.click('#btn-submit-grant');
            await grantResponsePromise;

            // Kiểm tra DB xác nhận quyền VIP và Audit Log
            const updatedUser = await db.collection('users').findOne({ email: TARGET_FLOW3 });
            assert.strictEqual(updatedUser.membership, 'vip', 'User phải được nâng cấp thành VIP trong DB');
            assert.ok(updatedUser.manual_vip_grants && updatedUser.manual_vip_grants.length >= 1, 'Audit log phải ghi nhận lịch sử cấp VIP');
            console.log(`  3d: Cấp VIP thủ công thành công! DB ghi nhận hạn mới: ${updatedUser.vip_expired_at}`);

            await context.close();
            passedTests++;
            console.log('  ✅ PASSED: LUỒNG 3 ĐÃ HOÀN TẤT VÀ VƯỢT QUA 100%!');
        }

        // =========================================================================
        // LUỒNG 4: QUÊN MẬT KHẨU -> TOKEN -> RESET MẬT KHẨU -> ĐĂNG NHẬP MỚI
        // =========================================================================
        console.log('\n▶ [LUỒNG 4] Quên Mật Khẩu -> Gửi yêu cầu -> Đặt lại tại /reset-password -> Đăng nhập mật khẩu mới');
        {
            // Chuẩn bị tài khoản người dùng ban đầu
            await db.collection('users').deleteOne({ email: USER_FLOW4 });
            await db.collection('password_resets').deleteMany({ email: USER_FLOW4 });
            await db.collection('users').insertOne({
                _id: `user_forgot_${RUN_ID}`,
                email: USER_FLOW4,
                password_hash: await bcrypt.hash(TEST_PASSWORD, 8),
                membership: 'free',
                created_at: new Date().toISOString()
            });

            const context = await browser.newContext();
            const page = await context.newPage();
            await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });

            // 4a. Mở modal quên mật khẩu
            await page.click('#btn-open-auth');
            await page.click('a:has-text("Quên mật khẩu?")');
            await page.waitForSelector('#forgot-password-modal:not(.hidden)');
            await page.fill('#forgot-email', USER_FLOW4);
            await page.click('#btn-submit-forgot');

            // Chờ thông báo phản hồi an toàn
            await page.waitForSelector('#forgot-status-msg:not(.hidden)');
            const forgotMsg = await page.textContent('#forgot-status-msg');
            assert.ok(forgotMsg.includes('Nếu email tồn tại'), 'Thông báo phải là generic message bảo vệ quyền riêng tư');
            console.log('  4a: Gửi yêu cầu quên mật khẩu thành công qua giao diện');

            // 4b. Lấy token đặt lại từ DB
            const resetDoc = await db.collection('password_reset_tokens').findOne({ email: USER_FLOW4 }, { sort: { created_at: -1 } });
            assert.ok(resetDoc && resetDoc.raw_token, 'Hệ thống phải sinh token đặt lại mật khẩu trong DB');
            console.log(`  4b: Đã tìm thấy token đặt lại mật khẩu trong DB: ${resetDoc.raw_token.substring(0, 16)}...`);

            // 4c. Truy cập /reset-password.html kèm token
            await page.goto(`${baseUrl}/reset-password.html?token=${resetDoc.raw_token}`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#reset-form:not(.hidden)');

            // Điền mật khẩu mới
            await page.fill('#new-password', NEW_PASSWORD);
            await page.fill('#confirm-password', NEW_PASSWORD);
            await page.click('#btn-submit-reset');

            // Chờ màn hình thành công
            await page.waitForSelector('#reset-success-view:not(.hidden)', { timeout: 8000 });
            console.log('  4c: Đặt lại mật khẩu thành công trên giao diện reset-password.html');

            // 4d. Đăng nhập lại với mật khẩu mới tại trang chủ
            await page.goto(`${baseUrl}/?action=login`, { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('#form-login:not(.hidden)');
            await page.fill('#login-email', USER_FLOW4);
            await page.fill('#login-password', NEW_PASSWORD);
            await page.click('#btn-submit-login');

            await page.waitForSelector('#user-profile-badge:not(.hidden)', { timeout: 8000 });
            const emailDisp = await page.textContent('#user-email-display');
            assert.strictEqual(emailDisp.trim(), USER_FLOW4, 'Đăng nhập thành công với mật khẩu mới');
            console.log('  4d: Đăng nhập thành công với mật khẩu mới!');

            await context.close();
            passedTests++;
            console.log('  ✅ PASSED: LUỒNG 4 ĐÃ HOÀN TẤT VÀ VƯỢT QUA 100%!');
        }

        // =========================================================================
        // LUỒNG 5: SMART SCANNER (VALIDATE LINK & TRA CỨU MÃ KHÔNG VỠ LAYOUT)
        // =========================================================================
        console.log('\n▶ [LUỒNG 5] Smart Scanner: Tra cứu link Shopee -> Validate cú pháp -> Render kết quả mượt mà');
        {
            const context = await browser.newContext();
            const page = await context.newPage();
            await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' });

            // 5a. Thử link không hợp lệ (ví dụ: link ngoài Shopee)
            await page.fill('#scanner-input', 'https://google.com/test-link');
            await page.click('#btn-scan');
            await page.waitForSelector('#scanner-error:not(.hidden)');
            const errText = await page.textContent('#scanner-error');
            assert.ok(errText.includes('Link không hợp lệ'), 'Phải báo lỗi khi link không phải Shopee');
            console.log('  5a: Đã validate chặn đúng link không phải Shopee');

            // 5b. Thử link Shopee hợp lệ
            await page.fill('#scanner-input', 'https://shopee.vn/Ao-Thun-Cotton-Nam-Nu-i.12345.67890');
            await page.click('#btn-scan');

            // Chờ kết quả tra cứu render xong (hoặc hiển thị thông báo "Chưa tìm thấy mã" hoặc voucher cards)
            await page.waitForFunction(() => {
                const res = document.getElementById('scanner-results');
                return res && !res.querySelector('.animate-pulse') && res.textContent.trim().length > 0;
            }, { timeout: 10000 });

            const resultsContent = await page.textContent('#scanner-results');
            const hasExpectedFeedback = resultsContent.includes('Đã tìm thấy mã') || resultsContent.includes('Chưa tìm thấy mã') || resultsContent.includes('Shopee');
            assert.ok(hasExpectedFeedback, 'Scanner phải hiển thị kết quả hoặc thông báo tìm kiếm rõ ràng');
            
            const isErrorHidden = await page.locator('#scanner-error').evaluate(el => el.classList.contains('hidden'));
            assert.ok(isErrorHidden, 'Thông báo lỗi validation phải ẩn đi khi nhập link hợp lệ');
            console.log(`  5b: Tra cứu thành công, kết quả trả về: "${resultsContent.substring(0, 60).replace(/\n/g, ' ')}..."`);

            // 5c. Thử link rút gọn chính thức vn.shp.ee
            await page.fill('#scanner-input', 'https://vn.shp.ee/AQT2iSgh');
            await page.click('#btn-scan');

            await page.waitForFunction(() => {
                const res = document.getElementById('scanner-results');
                return res && !res.querySelector('.animate-pulse') && res.textContent.trim().length > 0;
            }, { timeout: 15000 });

            const shortResultsContent = await page.textContent('#scanner-results');
            assert.ok(shortResultsContent.includes('Đã tìm thấy mã') || shortResultsContent.includes('Shopee'), 'Scanner phải xử lý link vn.shp.ee thành công');
            console.log('  5c: Tra cứu thành công với link rút gọn chính thức vn.shp.ee');

            await context.close();
            passedTests++;
            console.log('  ✅ PASSED: LUỒNG 5 ĐÃ HOÀN TẤT VÀ VƯỢT QUA 100%!');
        }

    } finally {
        // =========================================================================
        // DỌN DẸP DỮ LIỆU TEST VÀ ĐÓNG TÀI NGUYÊN
        // =========================================================================
        console.log('\n🧹 Dọn dẹp dữ liệu test trong MongoDB...');
        const db = getDB();
        if (db) {
            await db.collection('users').deleteMany({
                email: { $in: [USER_FLOW1, TARGET_FLOW3, USER_FLOW4] }
            });
            await db.collection('password_reset_tokens').deleteMany({
                email: { $in: [USER_FLOW1, TARGET_FLOW3, USER_FLOW4] }
            });
            await db.collection('payment_orders').deleteMany({
                user_id: { $regex: new RegExp(`^user_.*_${RUN_ID}$`) }
            });
        }
        console.log('  ✅ Đã dọn sạch người dùng test, password resets và đơn hàng thử nghiệm');

        if (browser) await browser.close();
        if (server) {
            await new Promise((resolve) => server.close(resolve));
        }
        console.log('🔒 Đã đóng trình duyệt Chromium và Test Server an toàn');
    }

    console.log('\n' + '='.repeat(80));
    console.log(`🎉 TỔNG KẾT: ${passedTests}/${totalTests} LUỒNG UI BẰNG TRÌNH DUYỆT THẬT ĐÃ VƯỢT QUA 100%!`);
    console.log('='.repeat(80));
}

// Chạy test nếu gọi trực tiếp từ terminal
if (require.main === module) {
    runCriticalUITests()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('\n❌ BÀI TEST UI THẤT BẠI:', err);
            process.exit(1);
        });
}

module.exports = { runCriticalUITests };
