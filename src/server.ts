import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { attachInterviewASRWebSocket } from './lib/interview-asr-ws-server';
import { attachInterviewTTSWebSocket } from './lib/interview-tts-ws-server';
import { startResumeProcessingWorker } from './lib/resume-processing-worker';

const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOSTNAME || '0.0.0.0';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  attachInterviewASRWebSocket(server);
  attachInterviewTTSWebSocket(server);
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    startResumeProcessingWorker();
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : 'production'
      }`,
    );
  });
});
