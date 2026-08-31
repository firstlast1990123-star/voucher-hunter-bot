const { getDB } = require('./db');

/**
 * Middleware phân quyền Membership
 * Gắn thêm req.user_membership vào request object
 */
async function checkMembership(req, res, next) {
    try {
        // Hỗ trợ đọc user_id từ body hoặc query
        const userId = req.body.user_id || req.query.user_id;
        
        if (!userId) {
            return res.status(400).json({ error: "MISSING_USER_ID", message: "Thiếu thông tin user_id" });
        }

        const db = getDB();
        const user = await db.collection('users').findOne({ _id: userId });

        if (!user) {
            return res.status(404).json({ error: "USER_NOT_FOUND", message: "Không tìm thấy người dùng" });
        }

        let actualMembership = user.membership || 'free';

        // Kiểm tra hạn VIP nếu user đang là VIP
        if (actualMembership === 'vip' && user.vip_expired_at) {
            const expiryDate = new Date(user.vip_expired_at);
            const now = new Date();
            
            if (expiryDate < now) {
                // Đã hết hạn VIP -> tự động treat như free
                actualMembership = 'free';
            }
        }

        // Gắn vào request để các API phía sau sử dụng
        req.userContext = {
            id: user._id,
            email: user.email,
            membership: actualMembership,
            saved_vouchers: user.saved_vouchers || []
        };

        next();
    } catch (error) {
        console.error("Lỗi middleware checkMembership:", error);
        res.status(500).json({ error: "SERVER_ERROR", message: "Lỗi hệ thống khi kiểm tra phân quyền" });
    }
}

module.exports = { checkMembership };
