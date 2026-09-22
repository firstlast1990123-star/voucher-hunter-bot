const serverless = require('serverless-http');
const app = require('../backend/server-app');

const serverlessHandler = serverless(app);

// Hỗ trợ cả 2 cơ chế trên Vercel:
// 1. Vercel Serverless Function native (req, res)
// 2. AWS Lambda / Netlify / serverless-http simulation (event, context)
const handler = (req, res) => {
    if (req && req.httpMethod && (!res || typeof res.writeHead !== 'function')) {
        return serverlessHandler(req, res);
    }
    return app(req, res);
};

handler.handler = serverlessHandler;

module.exports = handler;
