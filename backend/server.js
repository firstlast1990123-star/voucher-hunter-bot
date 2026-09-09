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
const PORT = process.env.PORT || 3000;

// Tin tưởng proxy (chuẩn triển khai production để express-rate-limit nhận diện đúng IP client)
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
    next();
});

// Health check endpoint (không áp dụng rate limit để monitor tự do)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Áp dụng Rate Limiting bảo vệ nền chung cho toàn bộ /api/* (100 req/15 phút)
app.use('/api', globalLimiter);

// Register API routes
app.use('/api/auth', authRoutes);
app.use('/api/vouchers', voucherStorageRoutes);
app.use('/api/vouchers', verifyAndUseRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/scan', scanRoutes);
app.use('/api/user', userRoutes);
app.use('/api/user', savingsReportRoutes);
app.use('/api/stats', statsRoutes);

// Fallback 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `Route ${req.method} ${req.originalUrl} not found` });
});

// Global error handler
app.use((err, req, res, _next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: err.message });
});

// Start server after connecting to MongoDB
async function startServer() {
    try {
        const db = await connectDB();
        console.log('MongoDB connection verified.');
        await db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(() => {});

        const server = app.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
            console.log('Registered routes:');
            console.log('  GET  /health');
            console.log('  POST /api/auth/register');
            console.log('  POST /api/auth/login');
            console.log('  GET  /api/auth/me');
            console.log('  POST /api/vouchers/save');
            console.log('  GET  /api/vouchers/my-storage');
            console.log('  POST /api/vouchers/verify-and-use');
            console.log('  POST /api/vouchers/report-broken');
            console.log('  POST /api/payment/create-vip-order');
            console.log('  POST /api/payment/webhook');
            console.log('  POST /api/scan');
            console.log('  POST /api/user/generate-telegram-link-code');
            console.log('  POST /api/user/register');
            console.log('  GET  /api/user/export-my-data');
            console.log('  POST /api/user/request-deletion');
            console.log('  GET  /api/user/savings-report');
            console.log('  GET  /api/stats/success-rate');
        });
        return server;
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };

