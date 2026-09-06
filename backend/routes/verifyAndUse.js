const express = require('express');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { getDB } = require('../db');

const router = express.Router();

/**
 * Gọi Python script để verify
 */
function verifyWithPython(code) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '../../verify_wrapper.py');
        const venvPython = path.join(__dirname, '../../.venv/bin/python3');
        const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';
        execFile(pythonBin, [scriptPath, code], (error, stdout, stderr) => {
            if (error && error.code !== 0 && !stdout) {
                console.error("Lỗi chạy python:", stderr);
                return resolve({ valid: false, reason: "Lỗi hệ thống khi kiểm tra mã, vui lòng thử lại" }); // Fail-closed
            }
            try {
                const result = JSON.parse(stdout.trim());
                resolve(result);
            } catch (e) {
                console.error("Lỗi parse JSON từ python:", stdout);
                resolve({ valid: false, reason: "Lỗi hệ thống khi xử lý kết quả kiểm tra" });
            }
        });
    });
}

/**
 * API #1: Verify and Use
 * POST /api/vouchers/verify-and-use
 */
router.post('/verify-and-use', async (req, res) => {
    try {
        const { voucher_code } = req.body;
        if (!voucher_code) {
            return res.status(400).json({ error: "MISSING_CODE" });
        }

        const result = await verifyWithPython(voucher_code);
        
        // Python script đã tự động cập nhật DB (verified_at hoặc xóa)
        const db = getDB();
        
        if (result.valid) {
            // Lấy lại info từ DB để trả cho frontend (đề phòng client cần thêm info)
            const voucher = await db.collection('live_vouchers').findOne({ code: voucher_code });
            return res.status(200).json({ 
                valid: true, 
                code: voucher_code, 
                landing_url: voucher ? voucher.landing_url : null 
            });
        } else {
            // Logic tìm gợi ý thay thế
            // Ta lấy thông tin cũ của voucher đã lưu trong db hoặc từ script báo về (nhưng voucher bị xoá rồi)
            // Tốt nhất là query live_vouchers xem có mã nào cùng merchant = Shopee
            const alternatives = await db.collection('live_vouchers')
                .find({ code: { $ne: voucher_code }, merchant: "Shopee", status: "live" })
                .sort({ verified_at: -1 })
                .limit(3)
                .toArray();
                
            return res.status(200).json({ 
                valid: false, 
                reason: result.reason || "Mã không còn khả dụng",
                suggested_alternatives: alternatives.map(a => ({
                    code: a.code,
                    title: a.title,
                    discount_type: a.discount_type,
                    discount_value: a.discount_value,
                    merchant: a.merchant,
                    voucher_type: a.voucher_type,
                    landing_url: a.landing_url
                }))
            });
        }
    } catch (err) {
        console.error("Lỗi verify-and-use:", err);
        res.status(500).json({ error: "SERVER_ERROR" });
    }
});

/**
 * API #2: Report broken
 * POST /api/vouchers/report-broken
 */
router.post('/report-broken', async (req, res) => {
    try {
        const { voucher_code, user_id } = req.body;
        if (!voucher_code || !user_id) {
            return res.status(400).json({ error: "MISSING_DATA" });
        }

        const db = getDB();
        const now = new Date();
        const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        
        // 1. Chống spam 1 user report 1 mã nhiều lần trong 24h
        const existingReport = await db.collection('voucher_reports').findOne({
            voucher_code,
            user_id,
            reported_at: { $gte: past24h.toISOString() }
        });
        
        if (existingReport) {
            return res.status(200).json({ received: true, message: "Đã ghi nhận trước đó" });
        }
        
        // 2. Insert report
        await db.collection('voucher_reports').insertOne({
            voucher_code,
            user_id,
            reported_at: now.toISOString()
        });
        
        // 3. Đếm số report khác user trong 30 phút qua
        const past30m = new Date(now.getTime() - 30 * 60 * 1000);
        const reportCount = await db.collection('voucher_reports').countDocuments({
            voucher_code,
            reported_at: { $gte: past30m.toISOString() }
        });
        
        if (reportCount >= 3) {
            // Xóa ngay lập tức
            await db.collection('live_vouchers').deleteOne({ code: voucher_code });
            console.log(`[GỠ BỎ - BÁO CÁO NGƯỜI DÙNG >=3] Mã: ${voucher_code}`);
        } else if (reportCount === 1) {
            // Trigger check ngầm
            verifyWithPython(voucher_code).catch(e => console.error("Lỗi background check:", e));
        }
        
        res.status(200).json({ received: true });
    } catch (err) {
        console.error("Lỗi report-broken:", err);
        res.status(500).json({ error: "SERVER_ERROR" });
    }
});

module.exports = router;
