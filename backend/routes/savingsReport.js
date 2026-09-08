const express = require('express');
const { getDB } = require('../db');
const { authenticateToken } = require('../middleware');

const router = express.Router();

/**
 * API #3: Tiết kiệm lũy kế
 * GET /api/user/savings-report (Yêu cầu JWT Token)
 */
router.get('/savings-report', authenticateToken, async (req, res) => {
    try {
        const db = getDB();
        const user = req.userContext;
        
        let totalExact = 0;
        let totalEstimated = 0;
        
        if (user.saved_vouchers && user.saved_vouchers.length > 0) {
            const vouchers = await db.collection('live_vouchers').find({
                code: { $in: user.saved_vouchers }
            }).toArray();
            
            vouchers.forEach(v => {
                if (v.discount_type === 'fixed') {
                    totalExact += (v.discount_value || 0);
                } else if (v.discount_type === 'percent') {
                    // Ước tính: % của min_order_value
                    let est = (v.min_order_value || 0) * (v.discount_value || 0) / 100;
                    if (v.discount_max_value && est > v.discount_max_value) {
                        est = v.discount_max_value;
                    }
                    totalEstimated += est;
                }
            });
        }
        
        // Ghi chú tương lai: Nếu có bảng tracking redemption (vd: user_redemptions), 
        // ta sẽ query bảng đó lấy số exact thay vì dựa vào saved_vouchers ước tính.
        
        const responseData = {
            total_saved_exact: totalExact,
            total_saved_estimated: totalEstimated,
            total_saved_display: totalExact + totalEstimated,
            voucher_count: user.saved_vouchers ? user.saved_vouchers.length : 0,
            is_estimated: totalEstimated > 0
        };
        
        res.status(200).json({ success: true, data: responseData });
    } catch (err) {
        console.error("Lỗi lấy savings report:", err);
        res.status(500).json({ error: "SERVER_ERROR", message: "Lỗi nội bộ" });
    }
});

module.exports = router;
