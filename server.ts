import { createServer } from 'http';
import OpenAI from 'openai';
import 'dotenv/config';
import { createReadStream } from 'fs';
import * as path from 'path';

// Environment validation
const requiredEnvVars = ['OPENAI_API_KEY', 'API_BASE_URL', 'MODEL_LIST', 'DEFAULT_MODEL'];
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    console.error(`Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.API_BASE_URL,
});

// Client configuration
const clientConfig = {
  modelList: process.env.MODEL_LIST.split(','),
  defaultModel: process.env.DEFAULT_MODEL
};

const port = process.env.PORT || 3001;

// MIME types for static files
const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route handling
    switch (url.pathname) {
      case '/':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        createReadStream('./index.html').pipe(res);
        break;

      case '/config':
        console.log('Sending config:', clientConfig);
        res.writeHead(200, { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        });
        res.end(JSON.stringify(clientConfig));
        break;

      case '/chat':
      case '/chat-vision':
        let body = '';
        for await (const chunk of req) {
          body += chunk;
        }
        const data = JSON.parse(body);

        if (!data.messages?.length) {
          res.writeHead(400);
          res.end('Messages are required');
          return;
        }

        if (url.pathname === '/chat') {
          const stream = await openai.chat.completions.create({
            model: data.model || clientConfig.defaultModel,
            messages: data.messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 2000,
          });

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          for await (const chunk of stream) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();
        } else {
          const response = await openai.chat.completions.create({
            model: data.model || clientConfig.defaultModel,
            messages: data.messages,
            max_tokens: 500,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        }
        break;

      default:
        // Handle static files (images, etc.)
        if (url.pathname.startsWith('/images/')) {
          const filePath = path.join(process.cwd(), url.pathname);
          const ext = path.extname(filePath);
          const contentType = mimeTypes[ext] || 'application/octet-stream';

          try {
            res.writeHead(200, { 'Content-Type': contentType });
            createReadStream(filePath).pipe(res);
          } catch (error) {
            res.writeHead(404);
            res.end('File not found');
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
    }
  } catch (error) {
    console.error('Server error:', error);
    res.writeHead(500);
    res.end(JSON.stringify({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }));
  }
}).listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
  console.log('Client configuration:', clientConfig);
});