import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { attachInterviewASRWebSocket } from './lib/interview-asr-ws-server';
import { attachInterviewTTSWebSocket } from './lib/interview-tts-ws-server';
import { startResumeProcessingWorker } from './lib/resume-processing-worker';
import { startJobBackgroundWorker } from './lib/job-background-worker';
import { startApplicationProfileWorker } from './lib/application-profile-worker';

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
  const asrUpgradeHandler = attachInterviewASRWebSocket(server);
  const ttsUpgradeHandler = attachInterviewTTSWebSocket(server);

  // Next registers its own upgrade listener during app.prepare(). An ASR/TTS
  // handler authenticates asynchronously, so allowing Next's listener to run
  // for the same socket closes it before our ticket check can finish. Keep
  // exactly one dispatcher and hand non-interview upgrades back to Next.
  const nextUpgradeHandlers = server.listeners('upgrade').filter(
    (handler) => handler !== asrUpgradeHandler && handler !== ttsUpgradeHandler,
  );
  server.removeAllListeners('upgrade');
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/ws/interview/asr') {
      asrUpgradeHandler(request, socket, head);
      return;
    }
    if (pathname === '/ws/interview/tts') {
      ttsUpgradeHandler(request, socket, head);
      return;
    }
    nextUpgradeHandlers.forEach((handler) => handler.call(server, request, socket, head));
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, hostname, () => {
    startResumeProcessingWorker();
    startJobBackgroundWorker();
    startApplicationProfileWorker();
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : 'production'
      }`,
    );
  });
});
