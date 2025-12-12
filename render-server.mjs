import http from 'node:http';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const PORT = Number(process.env.RENDER_PORT ?? 3333);
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/';
const RENDER_DIR = path.join(process.cwd(), 'Rendered');

mkdirSync(RENDER_DIR, { recursive: true });

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(payload);
};

const text = (res, status, body) => {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(body);
};

const readJsonBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return null;
  return JSON.parse(raw);
};

const sanitizeBase = (name) => name.replace(/[^a-zA-Z0-9._-]/g, '_');

const waitForStableFile = async (filePath, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let stableCount = 0;

  while (Date.now() < deadline) {
    try {
      const s = await stat(filePath);
      const size = s.size;
      if (size > 0) {
        if (size === lastSize) stableCount++;
        else stableCount = 0;
        lastSize = size;
        if (stableCount >= 3) return size;
      }
    } catch {
      // file not found yet
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
};

let busy = false;

async function runRenderJob({ schedule, outputBase }) {
  const base = sanitizeBase(outputBase);
  const expectedIvf = path.join(RENDER_DIR, `${base}.ivf`);
  const expectedWebm = path.join(RENDER_DIR, `${base}.webm`);

  console.log(`[render:${base}] Starting…`);
  console.log(`[render:${base}] App URL: ${APP_URL}`);
  console.log(`[render:${base}] Output dir: ${RENDER_DIR}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    // Long renders can exceed the default CDP call timeout. We'll avoid awaiting
    // long-running page functions, but bump this anyway for safety.
    protocolTimeout: 60 * 60 * 1000,
  });

  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      console.log(`[page:${base}] ${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.error(`[page:${base}] pageerror`, err);
    });

    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: RENDER_DIR });

    await page.goto(APP_URL, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__pipesBackend?.ready === true, { timeout: 60_000 });

    await page.evaluate(() => {
      const timeline = document.getElementById('timeline-pane');
      const splitter = document.getElementById('splitter');
      if (timeline) timeline.style.display = 'none';
      if (splitter) splitter.style.display = 'none';
      window.dispatchEvent(new Event('resize'));
    });

    // Trigger render and return immediately. We then wait for the output file to appear.
    await page.evaluate(
      (renderSchedule, filenameBase) => {
        window.__pipesBackend
          .renderFromSchedule(renderSchedule, filenameBase)
          .catch((err) => console.error('renderFromSchedule failed', err));
      },
      schedule,
      base
    );

    const timeoutMs = 60 * 60 * 1000;
    const outPath = await Promise.any([
      waitForStableFile(expectedIvf, timeoutMs).then(() => expectedIvf),
      waitForStableFile(expectedWebm, timeoutMs).then(() => expectedWebm),
    ]);

    console.log(`[render:${base}] Done: ${outPath}`);
    return outPath;
  } finally {
    await browser.close();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) return text(res, 400, 'Missing URL');
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (req.method === 'OPTIONS') {
      return text(res, 204, '');
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/render') {
      if (busy) return json(res, 409, { ok: false, error: 'Renderer busy' });
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') return json(res, 400, { ok: false, error: 'Invalid JSON body' });
      const schedule = body;
      const outputBase = typeof body.outputBase === 'string' ? body.outputBase : `render-${Date.now()}`;

      busy = true;
      const jobId = sanitizeBase(outputBase);
      json(res, 202, { ok: true, jobId, outputBase: jobId });

      runRenderJob({ schedule, outputBase: jobId })
        .catch((err) => {
          console.error(`[render:${jobId}] Failed`, err);
        })
        .finally(() => {
          busy = false;
        });
      return;
    }

    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    console.error('Server error', err);
    return json(res, 500, { ok: false, error: 'Internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`Render server listening on http://localhost:${PORT}`);
  console.log(`Set APP_URL to override target page (default ${APP_URL})`);
  console.log(`Rendered files go to: ${RENDER_DIR}`);
});
