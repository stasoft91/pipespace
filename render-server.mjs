import http from 'node:http';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const PORT = Number(process.env.RENDER_PORT ?? 3333);
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/';
const RENDER_DIR = path.join(process.cwd(), 'Rendered');
const NAV_TIMEOUT_MS = Number(process.env.NAV_TIMEOUT_MS ?? 5 * 60 * 1000);

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

const convertIvfToMp4 = async (ivfPath, base) => {
  const mp4Path = path.join(path.dirname(ivfPath), `${base}.mp4`);
  console.log(`[render:${base}] Converting IVF to MP4: ${ivfPath} -> ${mp4Path}`);

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', ivfPath,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      mp4Path
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`[render:${base}] MP4 conversion successful: ${mp4Path}`);
        resolve(mp4Path);
      } else {
        console.error(`[render:${base}] FFmpeg conversion failed with code ${code}`);
        console.error(stderr);
        reject(new Error(`FFmpeg conversion failed: ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      console.error(`[render:${base}] Failed to spawn ffmpeg:`, err);
      reject(err);
    });
  });
};

let busy = false;

async function runRenderJob({ schedule, outputBase, appUrl }) {
  const base = sanitizeBase(outputBase);
  const expectedIvf = path.join(RENDER_DIR, `${base}.ivf`);
  const expectedWebm = path.join(RENDER_DIR, `${base}.webm`);
  const targetUrl = typeof appUrl === 'string' && appUrl.length ? appUrl : APP_URL;

  console.log(`[render:${base}] Starting…`);
  console.log(`[render:${base}] App URL: ${targetUrl}`);
  console.log(`[render:${base}] Output dir: ${RENDER_DIR}`);

  const launchArgs = [];
  if (process.platform === 'darwin') {
    launchArgs.push(
      '--use-angle=metal',
      '--use-gl=angle',
      '--enable-features=Metal',
      '--ignore-gpu-blocklist',
      '--disable-software-rasterizer'
    );
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    args: launchArgs,
    // Long renders can exceed the default CDP call timeout. We'll avoid awaiting
    // long-running page functions, but bump this anyway for safety.
    protocolTimeout: 60 * 60 * 1000,
  });

  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.on('console', (msg) => {
      console.log(`[page:${base}] ${msg.type()}: ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      console.error(`[page:${base}] pageerror`, err);
    });

    const client = await page.target().createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: RENDER_DIR });

    const nav = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    if (nav && !nav.ok()) {
      throw new Error(`Navigation failed: ${nav.status()} ${nav.statusText()}`);
    }
    await page.waitForFunction(() => window.__pipesBackend?.ready === true, { timeout: NAV_TIMEOUT_MS });

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

    // Automatically convert IVF files to MP4
    if (outPath.endsWith('.ivf')) {
      try {
        await convertIvfToMp4(outPath, base);
      } catch (err) {
        console.error(`[render:${base}] Failed to convert IVF to MP4:`, err);
        // Don't fail the entire job if conversion fails
      }
    }

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
      const schedule = body.schedule && typeof body.schedule === 'object' ? body.schedule : body;
      const outputBase = typeof body.outputBase === 'string' ? body.outputBase : `render-${Date.now()}`;
      const appUrl = typeof body.appUrl === 'string' ? body.appUrl : APP_URL;

      busy = true;
      const jobId = sanitizeBase(outputBase);
      json(res, 202, { ok: true, jobId, outputBase: jobId });

      runRenderJob({ schedule, outputBase: jobId, appUrl })
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
