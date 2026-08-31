const express = require('express');
const { getDB } = require('../db');

const router = express.Router();

/**
 * GET /api/stats/success-rate
 */
router.get('/success-rate', async (req, res) => {
    try {
        const db = getDB();
        const stats = await db.collection('site_stats').findOne({ _id: "global_stats" });
        
        if (!stats) {
            return res.status(200).json({ success: true, low_sample: true });
        }
        
        return res.status(200).json({
            success: true,
            success_rate: stats.success_rate,
            period_days: stats.period_days,
            low_sample: stats.low_sample,
            last_updated: stats.last_updated
        });
    } catch (err) {
        console.error("Lỗi get success-rate:", err);
        res.status(500).json({ error: "SERVER_ERROR" });
    }
});

module.exports = router;
