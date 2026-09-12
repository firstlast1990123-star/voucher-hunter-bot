/**
 * backend/emailService.js
 * Dịch vụ gửi email chuyên biệt cho luồng Đặt lại mật khẩu (sử dụng Resend API)
 * CHỈ dùng riêng cho việc gửi link reset mật khẩu, không dùng cho marketing.
 */

const RESEND_API_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Gửi email đặt lại mật khẩu
 * @param {string} toEmail Email người nhận
 * @param {string} rawToken Token reset gốc (chưa băm)
 * @returns {Promise<{success: boolean, id?: string, mock?: boolean, resetUrl?: string}>}
 */
async function sendPasswordResetEmail(toEmail, rawToken) {
    const apiKey = process.env.RESEND_API_KEY;
    const baseUrl = (process.env.APP_BASE_URL || 'https://voucherxmax.vercel.app').replace(/\/+$/, '');
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
    const fromEmail = process.env.EMAIL_FROM || 'Voucher Hunter <onboarding@resend.dev>';

    // Chế độ Test hoặc chưa cấu hình API Key: Mock an toàn không làm gián đoạn hệ thống
    if (!apiKey || process.env.NODE_ENV === 'test') {
        console.log(`ℹ️ [EMAIL MOCK] Gửi link đặt lại mật khẩu tới: ${toEmail}`);
        console.log(`ℹ️ [EMAIL MOCK] Reset URL: ${resetUrl}`);
        return {
            success: true,
            mock: true,
            resetUrl
        };
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f9fafb; }
            .container { max-width: 560px; margin: 30px auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e5e7eb; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
            .header { background: linear-gradient(135deg, #f97316, #ea580c); padding: 24px; text-align: center; color: #ffffff; }
            .content { padding: 32px 24px; }
            .btn { display: inline-block; background-color: #ea580c; color: #ffffff !important; font-weight: bold; text-decoration: none; padding: 12px 28px; border-radius: 8px; margin: 20px 0; font-size: 15px; }
            .footer { background: #f3f4f6; padding: 16px 24px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid #e5e7eb; }
            .token-box { background: #f3f4f6; padding: 12px; border-radius: 6px; font-family: monospace; font-size: 12px; word-break: break-all; margin: 15px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1 style="margin:0; font-size: 22px;">Voucher MyPro XMax</h1>
                <p style="margin: 4px 0 0; font-size: 14px; opacity: 0.9;">Hệ thống Săn & Xác thực Voucher Shopee</p>
            </div>
            <div class="content">
                <p>Xin chào,</p>
                <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản liên kết với email <strong>${toEmail}</strong>.</p>
                <p>Vui lòng bấm vào nút bên dưới để tiến hành tạo mật khẩu mới:</p>
                <div style="text-align: center;">
                    <a href="${resetUrl}" target="_blank" class="btn">Đặt Lại Mật Khẩu</a>
                </div>
                <p style="font-size: 13px; color: #4b5563;">Hoặc sao chép đường dẫn này vào trình duyệt nếu nút bấm không hoạt động:</p>
                <div class="token-box">${resetUrl}</div>
                <p style="font-size: 13px; color: #dc2626; margin-top: 20px;">
                    ⚠️ <strong>Lưu ý bảo mật quan trọng:</strong><br>
                    • Liên kết này chỉ có hiệu lực trong vòng <strong>20 phút</strong> và chỉ sử dụng được <strong>1 lần duy nhất</strong>.<br>
                    • Nếu bạn không thực hiện yêu cầu này, vui lòng bỏ qua email. Mật khẩu hiện tại của bạn vẫn an toàn tuyệt đối.
                </p>
            </div>
            <div class="footer">
                &copy; 2026 Voucher MyPro XMax. All rights reserved.<br>
                Email tự động được gửi từ hệ thống bảo mật tài khoản.
            </div>
        </div>
    </body>
    </html>
    `;

    try {
        const response = await fetch(RESEND_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: fromEmail,
                to: [toEmail],
                subject: 'Đặt lại mật khẩu - Voucher MyPro XMax',
                html: htmlContent
            })
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Lỗi từ Resend API:', data.message || data);
            return { success: false, error: data.message || 'Lỗi gửi email' };
        }

        return {
            success: true,
            id: data.id
        };
    } catch (err) {
        console.error('Lỗi kết nối tới Resend service:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = {
    sendPasswordResetEmail
};

