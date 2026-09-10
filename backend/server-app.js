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

// Import rate limiters
const { globalLimiter } = require('./rateLimiter');

const app = express();

// Tin tưởng proxy (chuẩn triển khai production/Netlify để nhận diện đúng IP client)
app.set('trust proxy', 1);

// Middleware cơ bản
app.use(cors());
app.use(express.json());

// Tự động kết nối MongoDB trước khi xử lý request (quan trọng cho môi trường Serverless cold-start)
app.use(async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (err) {
        console.error('Database connection error in middleware:', err);
        return res.status(500).json({ error: 'DB_CONNECTION_ERROR', message: 'Không thể kết nối cơ sở dữ liệu' });
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
app.get('/.netlify/functions/api/health', healthHandler);

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

// Mount apiRouter trên '/api' (local/rewrite), '/.netlify/functions/api' (Netlify) và root path (Vercel)
app.use('/api', apiRouter);
app.use('/.netlify/functions/api', apiRouter);
app.use(apiRouter);

// Fallback 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
});

module.exports = app;

