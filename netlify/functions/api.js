const serverless = require('serverless-http');
const app = require('../../backend/server-app');

// Bọc toàn bộ Express app thành 1 Netlify Serverless Function duy nhất
module.exports.handler = serverless(app);

