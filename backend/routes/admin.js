const express = require('express');
const { ObjectId } = require('mongodb');
const Joi = require('joi');
const { getDB } = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware');
const { adminLimiter } = require('../rateLimiter');
const { calculateVipExpiry } = require('../authUtils');

const router = express.Router();

// Áp dụng Rate Limit và phân quyền Admin tuyệt đối cho toàn bộ router
router.use(adminLimiter);
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * Helper tìm kiếm voucher theo id hoặc code
 */
function buildIdQuery(id) {
    if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) {
        return { $or: [{ _id: new ObjectId(id) }, { _id: id }, { code: id }] };
    }
    return { $or: [{ _id: id }, { code: id }] };
}

/**
 * GET /api/admin/check
 * Kiểm tra quyền admin nhanh cho frontend
 */
router.get('/check', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Xác thực quyền quản trị viên thành công.',
        admin_email: req.user.email
    });
});

/**
 * GET /api/admin/dashboard
 * Thống kê giám sát hệ thống & Bot health
 */
router.get('/dashboard', async (req, res) => {
    try {
        const db = getDB();

        // 1. Lấy thông tin sức khỏe bot
        const botRecords = await db.collection('bot_health').find({}).toArray();
        const botMap = {
            hunter_bot: { status: 'unknown', last_cycle_result: 'unknown' },
            validator_bot: { status: 'unknown', last_cycle_result: 'unknown' },
            telegram_notifier: { status: 'unknown', last_cycle_result: 'unknown' }
        };

        botRecords.forEach(bot => {
            botMap[bot._id] = bot;
        });

        // 2. Thống kê voucher & user
        const now = new Date();
        const nowIso = now.toISOString();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const [
            totalLive,
            totalPending,
            totalUsers,
            totalVip,
            recentPaidOrders
        ] = await Promise.all([
            db.collection('live_vouchers').countDocuments({}),
            db.collection('pending_vouchers').countDocuments({}),
            db.collection('users').countDocuments({}),
            db.collection('users').countDocuments({
                $or: [
                    { membership: 'vip' },
                    { vip_expired_at: { $gt: nowIso } }
                ]
            }),
            db.collection('payment_orders').countDocuments({
                status: 'paid',
                $or: [
                    { paid_at: { $gte: sevenDaysAgo } },
                    { created_at: { $gte: sevenDaysAgo } }
                ]
            })
        ]);

        res.status(200).json({
            success: true,
            bots: botMap,
            stats: {
                total_live_vouchers: totalLive,
                total_pending_vouchers: totalPending,
                total_users: totalUsers,
                total_vip_users: totalVip,
                recent_paid_orders_7d: recentPaidOrders
            }
        });
    } catch (err) {
        console.error('Lỗi GET /api/admin/dashboard:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi tải dữ liệu dashboard quản trị.' });
    }
});

/**
 * GET /api/admin/vouchers
 * Xem danh sách voucher (live hoặc pending) có phân trang & tìm kiếm
 */
router.get('/vouchers', async (req, res) => {
    try {
        const db = getDB();
        const type = req.query.type === 'pending' ? 'pending' : 'live';
        const collectionName = type === 'pending' ? 'pending_vouchers' : 'live_vouchers';

        let filter = {};
        if (req.query.search && typeof req.query.search === 'string') {
            const q = req.query.search.trim();
            if (q) {
                const regex = new RegExp(q, 'i');
                filter.$or = [
                    { code: regex },
                    { title: regex },
                    { merchant: regex }
                ];
            }
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [items, total] = await Promise.all([
            db.collection(collectionName).find(filter).sort({ _id: -1 }).skip(skip).limit(limit).toArray(),
            db.collection(collectionName).countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            type,
            items,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Lỗi GET /api/admin/vouchers:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi tải danh sách voucher.' });
    }
});

/**
 * POST /api/admin/vouchers
 * Thêm voucher mới thủ công
 */
router.post('/vouchers', async (req, res) => {
    try {
        const voucherSchema = Joi.object({
            merchant: Joi.string().trim().default('Shopee'),
            voucher_type: Joi.string().valid('code', 'deeplink').required().messages({
                'any.only': 'Loại voucher phải là code hoặc deeplink.'
            }),
            code: Joi.string().trim().uppercase().required().messages({
                'string.empty': 'Mã voucher không được để trống.'
            }),
            title: Joi.string().trim().required().messages({
                'string.empty': 'Tiêu đề voucher không được để trống.'
            }),
            discount_type: Joi.string().valid('percent', 'fixed').default('fixed'),
            discount_value: Joi.number().min(0).required().messages({
                'number.min': 'Giá trị giảm không được âm.'
            }),
            discount_max_value: Joi.number().min(0).allow(null).default(null),
            min_order_value: Joi.number().min(0).default(0),
            valid_to: Joi.string().isoDate().required().messages({
                'string.isoDate': 'Hạn sử dụng phải là định dạng ISO date hợp lệ.'
            }),
            remain_count: Joi.number().min(0).allow(null).default(null),
            landing_url: Joi.string().uri().required().messages({
                'string.uri': 'Link đích (landing_url) phải là đường dẫn URL hợp lệ.'
            }),
            source: Joi.string().default('manual'),
            target: Joi.string().valid('live', 'pending').default('live')
        });

        const { error, value } = voucherSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: 'VALIDATION_ERROR', message: error.details[0].message });
        }

        const db = getDB();
        const targetCollection = value.target === 'pending' ? 'pending_vouchers' : 'live_vouchers';

        // Kiểm tra trùng lặp
        const exists = await db.collection(targetCollection).findOne({ code: value.code });
        if (exists) {
            return res.status(409).json({
                error: 'DUPLICATE_CODE',
                message: `Mã '${value.code}' đã tồn tại trong danh sách ${targetCollection}.`
            });
        }

        const nowIso = new Date().toISOString();
        const docToInsert = {
            merchant: value.merchant || 'Shopee',
            voucher_type: value.voucher_type,
            code: value.code,
            title: value.title,
            discount_type: value.discount_type,
            discount_value: value.discount_value,
            discount_max_value: value.discount_max_value,
            min_order_value: value.min_order_value,
            valid_to: value.valid_to,
            remain_count: value.remain_count,
            landing_url: value.landing_url,
            source: value.source || 'manual',
            status: value.target === 'pending' ? 'pending' : 'live',
            created_at: nowIso,
            added_by_admin: req.user.email
        };

        if (value.target === 'live') {
            docToInsert.verified_at = nowIso;
            docToInsert.published_at = nowIso;
        }

        const result = await db.collection(targetCollection).insertOne(docToInsert);

        res.status(201).json({
            success: true,
            message: `Đã thêm voucher '${value.code}' vào ${targetCollection} thành công.`,
            voucher: { _id: result.insertedId, ...docToInsert }
        });
    } catch (err) {
        console.error('Lỗi POST /api/admin/vouchers:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi thêm voucher mới.' });
    }
});

/**
 * PUT /api/admin/vouchers/:id
 * Sửa voucher thủ công
 */
router.put('/vouchers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const type = req.query.type === 'pending' ? 'pending' : 'live';
        const collectionName = type === 'pending' ? 'pending_vouchers' : 'live_vouchers';

        const updateSchema = Joi.object({
            merchant: Joi.string().trim(),
            voucher_type: Joi.string().valid('code', 'deeplink'),
            code: Joi.string().trim().uppercase(),
            title: Joi.string().trim(),
            discount_type: Joi.string().valid('percent', 'fixed'),
            discount_value: Joi.number().min(0),
            discount_max_value: Joi.number().min(0).allow(null),
            min_order_value: Joi.number().min(0),
            valid_to: Joi.string().isoDate(),
            remain_count: Joi.number().min(0).allow(null),
            landing_url: Joi.string().uri(),
            source: Joi.string()
        });

        const { error, value } = updateSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: 'VALIDATION_ERROR', message: error.details[0].message });
        }

        const db = getDB();
        const query = buildIdQuery(id);
        const existing = await db.collection(collectionName).findOne(query);
        if (!existing) {
            return res.status(404).json({ error: 'NOT_FOUND', message: `Không tìm thấy voucher trong ${collectionName}.` });
        }

        const updateData = {
            ...value,
            updated_at: new Date().toISOString(),
            updated_by_admin: req.user.email
        };

        await db.collection(collectionName).updateOne(
            { _id: existing._id },
            { $set: updateData }
        );

        res.status(200).json({
            success: true,
            message: `Cập nhật voucher thành công.`,
            voucher: { ...existing, ...updateData }
        });
    } catch (err) {
        console.error('Lỗi PUT /api/admin/vouchers/:id:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi cập nhật voucher.' });
    }
});

/**
 * DELETE /api/admin/vouchers/:id
 * Xóa voucher khỏi live_vouchers hoặc pending_vouchers
 */
router.delete('/vouchers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const type = req.query.type === 'pending' ? 'pending' : 'live';
        const collectionName = type === 'pending' ? 'pending_vouchers' : 'live_vouchers';

        const db = getDB();
        const query = buildIdQuery(id);
        const existing = await db.collection(collectionName).findOne(query);

        if (!existing) {
            return res.status(404).json({ error: 'NOT_FOUND', message: `Không tìm thấy voucher trong ${collectionName}.` });
        }

        await db.collection(collectionName).deleteOne({ _id: existing._id });

        res.status(200).json({
            success: true,
            message: `Đã xóa voucher '${existing.code}' khỏi ${collectionName}.`
        });
    } catch (err) {
        console.error('Lỗi DELETE /api/admin/vouchers/:id:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi xóa voucher.' });
    }
});

/**
 * POST /api/admin/vouchers/approve/:id
 * Duyệt tay 1 voucher từ pending_vouchers đẩy thẳng lên live_vouchers
 */
router.post('/vouchers/approve/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = getDB();
        const query = buildIdQuery(id);

        const pending = await db.collection('pending_vouchers').findOne(query);
        if (!pending) {
            return res.status(404).json({ error: 'NOT_FOUND', message: 'Không tìm thấy voucher trong pending_vouchers.' });
        }

        const nowIso = new Date().toISOString();
        const liveDoc = {
            ...pending,
            status: 'live',
            verified_at: nowIso,
            published_at: nowIso,
            approved_manually: true,
            approved_by_admin: req.user.email
        };
        delete liveDoc._id; // Tránh xung đột _id khi upsert theo code

        await db.collection('live_vouchers').updateOne(
            { code: pending.code },
            { $set: liveDoc },
            { upsert: true }
        );

        await db.collection('pending_vouchers').deleteOne({ _id: pending._id });

        res.status(200).json({
            success: true,
            message: `Đã duyệt tay thành công mã '${pending.code}' lên live_vouchers.`
        });
    } catch (err) {
        console.error('Lỗi POST /api/admin/vouchers/approve/:id:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi duyệt voucher.' });
    }
});

/**
 * GET /api/admin/users
 * Xem danh sách người dùng (loại trừ password_hash)
 */
router.get('/users', async (req, res) => {
    try {
        const db = getDB();
        let filter = {};

        if (req.query.search && typeof req.query.search === 'string') {
            const q = req.query.search.trim();
            if (q) {
                const regex = new RegExp(q, 'i');
                filter.$or = [
                    { email: regex },
                    { _id: q }
                ];
            }
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;

        const [users, total] = await Promise.all([
            db.collection('users')
                .find(filter, { projection: { password_hash: 0 } })
                .sort({ created_at: -1, _id: -1 })
                .skip(skip)
                .limit(limit)
                .toArray(),
            db.collection('users').countDocuments(filter)
        ]);

        res.status(200).json({
            success: true,
            users,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Lỗi GET /api/admin/users:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi tải danh sách người dùng.' });
    }
});

/**
 * GET /api/admin/users/:email/details
 * Chi tiết người dùng và lịch sử đơn hàng payment_orders để đối chiếu PayOS
 */
router.get('/users/:email/details', async (req, res) => {
    try {
        const db = getDB();
        const target = decodeURIComponent(req.params.email).trim().toLowerCase();

        const user = await db.collection('users').findOne(
            { $or: [{ email: target }, { _id: req.params.email }] },
            { projection: { password_hash: 0 } }
        );

        if (!user) {
            return res.status(404).json({ error: 'USER_NOT_FOUND', message: 'Không tìm thấy tài khoản người dùng.' });
        }

        // Lấy lịch sử đơn hàng của user để đối chiếu
        const orders = await db.collection('payment_orders')
            .find({ user_id: user._id })
            .sort({ created_at: -1 })
            .toArray();

        res.status(200).json({
            success: true,
            user,
            orders
        });
    } catch (err) {
        console.error('Lỗi GET /api/admin/users/:email/details:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi lấy thông tin chi tiết người dùng.' });
    }
});

/**
 * POST /api/admin/users/grant-vip
 * Cấp VIP thủ công (xử lý khiếu nại, có kiểm tra & audit log)
 */
router.post('/users/grant-vip', async (req, res) => {
    try {
        const grantSchema = Joi.object({
            email: Joi.string().email().required().messages({
                'string.empty': 'Vui lòng nhập email người dùng.',
                'string.email': 'Email người dùng không hợp lệ.',
                'any.required': 'Email là bắt buộc.'
            }),
            plan: Joi.string().valid('vip_weekly', 'vip_monthly').required().messages({
                'any.only': 'Gói VIP phải là vip_weekly (Gói Tuần) hoặc vip_monthly (Gói Tháng).',
                'any.required': 'Vui lòng chọn gói VIP.'
            }),
            reason: Joi.string().trim().min(5).required().messages({
                'string.empty': 'Lý do cấp VIP là bắt buộc và không được để trống.',
                'string.min': 'Lý do cấp VIP phải có tối thiểu 5 ký tự (để đối chiếu sau này).',
                'any.required': 'Lý do cấp VIP là bắt buộc.'
            })
        });

        const { error, value } = grantSchema.validate(req.body);
        if (error) {
            return res.status(400).json({
                error: 'VALIDATION_ERROR',
                message: error.details[0].message
            });
        }

        const db = getDB();
        const targetEmail = value.email.trim().toLowerCase();
        const user = await db.collection('users').findOne({ email: targetEmail });

        if (!user) {
            return res.status(404).json({
                error: 'USER_NOT_FOUND',
                message: `Không tìm thấy tài khoản người dùng với email: ${targetEmail}`
            });
        }

        const now = new Date();
        // Tái sử dụng chính xác hàm calculateVipExpiry (cộng dồn nếu user đang còn hạn VIP)
        const newExpiry = calculateVipExpiry(user.vip_expired_at, value.plan, now);

        const grantRecord = {
            granted_at: now.toISOString(),
            plan: value.plan,
            reason: value.reason.trim(),
            admin_email: req.user.email
        };

        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: {
                    membership: 'vip',
                    current_plan: value.plan,
                    vip_expired_at: newExpiry.toISOString()
                },
                $push: {
                    manual_vip_grants: grantRecord
                }
            }
        );

        console.log(`⭐ [ADMIN] Admin ${req.user.email} đã cấp VIP thủ công cho user ${user.email} (${value.plan}) - Lý do: ${value.reason}`);

        res.status(200).json({
            success: true,
            message: `Cấp ${value.plan === 'vip_monthly' ? 'VIP Tháng (30 ngày)' : 'VIP Tuần (7 ngày)'} thành công cho ${user.email}.`,
            user: {
                _id: user._id,
                email: user.email,
                membership: 'vip',
                current_plan: value.plan,
                vip_expired_at: newExpiry.toISOString()
            },
            grant: grantRecord
        });
    } catch (err) {
        console.error('Lỗi POST /api/admin/users/grant-vip:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi cấp VIP thủ công.' });
    }
});

module.exports = router;
