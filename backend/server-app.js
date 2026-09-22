const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { connectDB } = require('./db');

// Import routes
const authRoutes = require('./routes/auth');
const voucherStorageRoutes = require('./routes/voucherStorage');
const verifyAndUseRoutes = require('./routes/verifyAndUse');
const paymentRoutes = require('./routes/payment');
const scanRoutes = require('./routes/scan');
const userRoutes = require('./routes/user');
const savingsReportRoutes = require('./routes/savingsReport');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');

// Import rate limiters
const { globalLimiter } = require('./rateLimiter');

const app = express();

// Vô hiệu hóa header x-powered-by để không tiết lộ framework backend (Express)
app.disable('x-powered-by');

// Tin tưởng proxy (chuẩn triển khai production/Vercel để nhận diện đúng IP client)
app.set('trust proxy', 1);

const { parseRequestBody } = require('./validationUtils');

// Middleware cơ bản
app.use(cors());
app.use(express.json());
app.use(express.text({ type: '*/*' }));

// Middleware chuyên biệt bắt lỗi cú pháp JSON từ express.json() hoặc @vercel/node (chạy TRƯỚC mọi route và generic error handler)
app.use((err, req, res, next) => {
    const isJsonSyntaxError =
        err instanceof SyntaxError || (err && err.name === 'SyntaxError') || (err && err.type === 'entity.parse.failed');

    if (isJsonSyntaxError) {
        return res.status(400).json({
            error: 'BAD_REQUEST',
            message: 'Định dạng dữ liệu JSON không hợp lệ.'
        });
    }
    next(err);
});

// Chuẩn hóa req.body phòng thủ nếu body là Buffer hoặc chuỗi JSON (Serverless runtime)
app.use((req, res, next) => {
    req.body = parseRequestBody(req.body);
    next();
});

// Tự động kết nối MongoDB trước khi xử lý request (quan trọng cho môi trường Serverless cold-start)
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('Database connection error in middleware:', err);
        res.setHeader('X-Debug-From', 'db-middleware');
        return res.status(500).json({
            error: 'INTERNAL_SERVER_ERROR',
            message: 'Đã có lỗi xảy ra trên hệ thống, vui lòng thử lại sau.'
        });
    }
});

// Request logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// Health check endpoint (không áp dụng rate limit để monitor tự do)
const healthHandler = (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
};
app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Tạo Router tập trung cho toàn bộ API routes
const apiRouter = express.Router();

// Áp dụng Rate Limiting bảo vệ nền chung cho toàn bộ API (100 req/15 phút)
apiRouter.use(globalLimiter);

// Đăng ký API routes
apiRouter.use('/auth', authRoutes);
apiRouter.use('/vouchers', voucherStorageRoutes);
apiRouter.use('/vouchers', verifyAndUseRoutes);
apiRouter.use('/payment', paymentRoutes);
apiRouter.use('/scan', scanRoutes);
apiRouter.use('/user', userRoutes);
apiRouter.use('/user', savingsReportRoutes);
apiRouter.use('/stats', statsRoutes);
apiRouter.use('/admin', adminRoutes);

// Phục vụ admin.html khi chạy server local
app.get(['/admin', '/admin.html'], (req, res) => {
    res.sendFile(path.join(__dirname, '../admin.html'));
});

// Mount apiRouter trên '/api' (local/rewrite) và root path (Vercel serverless)
app.use('/api', apiRouter);
app.use(apiRouter);

// Fallback 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, _next) => {
    // Phòng vệ tầng cuối: xử lý lỗi cú pháp JSON nếu lọt xuống đây
    const isJsonSyntaxError =
        err instanceof SyntaxError || (err && err.name === 'SyntaxError') || (err && err.type === 'entity.parse.failed');

    if (isJsonSyntaxError) {
        return res.status(400).json({
            error: 'BAD_REQUEST',
            message: 'Định dạng dữ liệu JSON không hợp lệ.'
        });
    }

    console.error('Server error:', err);
    res.setHeader('X-Debug-From', 'global-error-handler');
    res.setHeader('X-Debug-Err-Name', String(err && err.name));
    res.setHeader('X-Debug-Err-Msg', String(err && err.message));
    res.setHeader('X-Debug-Err-Type', String(err && err.type));
    res.setHeader('X-Debug-Err-Status', String(err && (err.status || err.statusCode)));
    res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Đã có lỗi xảy ra trên hệ thống, vui lòng thử lại sau.'
    });
});

module.exports = app;

