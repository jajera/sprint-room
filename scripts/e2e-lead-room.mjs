/**
 * Join a room and drive the full happy path as facilitator.
 *
 * Usage:
 *   node scripts/e2e-lead-room.mjs <roomUrl> [holdSeconds]
 */
import { chromium } from 'playwright';

const ROOM_URL = process.argv[2];
const HOLD_SECONDS = Number(process.argv[3] || 90);
const DISPLAY_NAME = 'Facilitator';

if (!ROOM_URL) {
  console.error('Usage: node scripts/e2e-lead-room.mjs <roomUrl> [holdSeconds]');
  process.exit(1);
}

function log(step, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step}  ${msg}`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForIdle(page, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const working = await page.getByText(/ai is working/i).isVisible().catch(() => false);
    const toast = await page.locator('[data-testid="error-toast"]').first().innerText().catch(() => '');
    if (toast) throw new Error(`AI error toast: ${toast.slice(0, 300)}`);
    if (!working) return;
    await sleep(1000);
  }
  throw new Error('Timed out waiting for AI idle');
}

async function answerAllClarifications(page) {
  const section = page.locator('section[aria-label="Clarifications"]');
  const answers = [
    'MVP is a collaborative sprint board + AI plan packet, demoable in one day.',
    'Export = Markdown + JSON of the sprint packet including acceptance criteria; must not drop ACs.',
    'Dark mode is in-scope for the shared notes / room chrome if time allows; otherwise next sprint.',
    'Alice owns auth and export correctness; Facilitator owns AI plan merge + demo script.',
    'Ship constraint: one-day MVP — cut anything that blocks a live dual-browser demo.',
  ];

  let answered = 0;
  for (let round = 0; round < 8; round++) {
    const boxes = section.locator('input[aria-label^="Answer for:"]');
    const count = await boxes.count();
    if (count === 0) break;

    for (let i = 0; i < count; i++) {
      const box = boxes.nth(i);
      if (!(await box.isVisible().catch(() => false))) continue;
      const text = answers[answered % answers.length];
      await box.fill(text);
      const form = box.locator('xpath=ancestor::form[1]');
      const submit = form.getByRole('button', { name: /^submit$/i });
      if (await submit.isEnabled().catch(() => false)) {
        await submit.click();
      } else {
        await box.press('Enter');
      }
      answered++;
      await sleep(400);
    }
    await sleep(800);
  }
  return answered;
}

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log(`Leading room: ${ROOM_URL}`);
  console.log(`As:           ${DISPLAY_NAME}`);
  console.log(`Hold:         ${HOLD_SECONDS}s`);
  console.log('══════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();

  try {
    await page.goto(ROOM_URL, { waitUntil: 'networkidle', timeout: 20000 });
    await page.getByLabel(/display name/i).fill(DISPLAY_NAME);
    await page.getByRole('button', { name: /^join$/i }).click();
    await page.getByRole('heading', { name: /^sprint room$/i }).waitFor({ state: 'visible', timeout: 20000 });
    log('JOIN', `In room as ${DISPLAY_NAME} — watch presence`);

    const raw = page.getByLabel(/raw input text/i);
    const inputs = [
      'Goal: run a live multiplayer sprint-room demo with AI teammate',
      'Must-have: shared raw inputs, clarifications, sprint packet export',
      'Constraint: one day; prefer Bedrock Nova Lite; no account auth',
      'Risk: empty parentTaskId from model must not break Plan',
    ];
    for (const line of inputs) {
      await raw.fill(line);
      await page.getByRole('button', { name: /^add$/i }).click();
      await sleep(600);
      log('INPUT', line.slice(0, 72));
    }

    const notes = page.locator('.ProseMirror, [contenteditable="true"]').first();
    if (await notes.isVisible().catch(() => false)) {
      await notes.click();
      await notes.type(
        `\nFacilitator notes: driving Clarify → answer all → Plan → Break Down if possible.`,
        { delay: 10 }
      );
      log('NOTES', 'Wrote facilitator plan in notes');
    }

    log('AI', 'Clarify…');
    await page.getByRole('button', { name: /clarify/i }).click();
    await waitForIdle(page, 90000);

    const qItems = page.locator(
      'section[aria-label="Clarifications"] ul[aria-label="Clarification questions"] > li'
    );
    const qCount = await qItems.count();
    log('AI', `Clarify returned ${qCount} question(s)`);

    const answered = await answerAllClarifications(page);
    log('LEAD', `Answered ${answered} clarification(s)`);

    log('AI', 'Plan…');
    await page.getByRole('button', { name: /^plan$/i }).click();
    await waitForIdle(page, 90000);

    const body = await page.locator('body').innerText();
    if (/sprint goal|in.scope|acceptance/i.test(body)) {
      log('AI', 'Sprint packet looks populated');
    } else {
      throw new Error('Plan finished but packet text not visible');
    }

    // Select first task + break down if enabled
    const taskBtn = page
      .locator('section[aria-label="Sprint packet"] button, [aria-label*="task" i], li')
      .filter({ hasText: /./ })
      .first();
    const breakDown = page.getByRole('button', { name: /break.?down/i });
    if (await breakDown.isEnabled().catch(() => false)) {
      log('AI', 'Break Down…');
      await breakDown.click();
      await waitForIdle(page, 90000);
      log('AI', 'Break Down finished');
    } else {
      // try clicking a task row then break down
      const clickableTask = page.locator('text=/acceptance|priority|high|medium/i').first();
      if (await clickableTask.isVisible().catch(() => false)) {
        await clickableTask.click().catch(() => {});
        await sleep(500);
      }
      if (await breakDown.isEnabled().catch(() => false)) {
        log('AI', 'Break Down (after selecting task)…');
        await breakDown.click();
        await waitForIdle(page, 90000);
        log('AI', 'Break Down finished');
      } else {
        log('AI', 'Break Down skipped (no task selected / disabled)');
      }
    }

    // Export clicks (UI smoke)
    for (const name of [/markdown/i, /json/i]) {
      const btn = page.getByRole('button', { name });
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        log('EXPORT', `Clicked ${name}`);
        await sleep(400);
      }
    }

    await page.screenshot({ path: '/tmp/sprint-lead-final.png', fullPage: true });
    log('HOLD', `Staying online ${HOLD_SECONDS}s so you can follow along`);
    const end = Date.now() + HOLD_SECONDS * 1000;
    while (Date.now() < end) {
      await sleep(10000);
      const t = await page.locator('body').innerText();
      log('PRESENCE', t.includes(DISPLAY_NAME) ? 'still visible' : 'name missing on bot view');
    }
  } finally {
    log('DONE', 'Leaving room');
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
