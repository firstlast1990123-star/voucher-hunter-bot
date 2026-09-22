const serverless = require('serverless-http');
const app = require('../backend/server-app');

const serverlessHandler = serverless(app);

// Hỗ trợ cả 2 cơ chế trên Vercel:
// 1. Vercel Serverless Function native (req, res)
// 2. AWS Lambda / Netlify / serverless-http simulation (event, context)
const handler = (req, res) => {
    // Phòng ngừa lỗi cú pháp JSON do @vercel/node tự động ném ra khi truy cập getter req.body
    try {
        if (req && req.headers && req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
            const _ = req.body;
        }
    } catch (err) {
        const isJsonSyntaxError =
            err instanceof SyntaxError ||
            (err && err.name === 'SyntaxError') ||
            (err && err.type === 'entity.parse.failed') ||
            (err && (err.status === 400 || err.statusCode === 400) && err.message === 'Invalid JSON') ||
            (err && err.message && (err.message.includes('Unexpected token') || err.message.includes('is not valid JSON')));

        if (isJsonSyntaxError) {
            if (res && typeof res.status === 'function') {
                return res.status(400).json({
                    error: 'BAD_REQUEST',
                    message: 'Định dạng dữ liệu JSON không hợp lệ.'
                });
            }
            if (res && typeof res.writeHead === 'function') {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                return res.end(JSON.stringify({
                    error: 'BAD_REQUEST',
                    message: 'Định dạng dữ liệu JSON không hợp lệ.'
                }));
            }
        }
    }

    if (req && req.httpMethod && (!res || typeof res.writeHead !== 'function')) {
        return serverlessHandler(req, res);
    }
    return app(req, res);
};

handler.handler = serverlessHandler;

module.exports = handler;
