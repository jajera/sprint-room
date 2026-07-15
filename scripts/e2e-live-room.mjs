/**
 * Expanded live E2E — joins a room, stays connected, exercises the happy path.
 *
 * Usage:
 *   node scripts/e2e-live-room.mjs [roomUrl] [holdSeconds]
 *
 * Example:
 *   node scripts/e2e-live-room.mjs http://localhost:5173/room/qP1w1LcrI_ 90
 *
 * Keep your own browser open in the same room. You should see this bot stay
 * in presence for the hold duration (it only leaves when the script ends).
 */
import { chromium } from 'playwright';

const ROOM_URL =
  process.argv[2] || 'http://localhost:5173/room/qP1w1LcrI_';
const HOLD_SECONDS = Number(process.argv[3] || 90);
const DISPLAY_NAME = `E2E_Bot`;

const results = [];

function log(step, msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${step}  ${msg}`);
}

function pass(name, detail = '') {
  results.push({ ok: true, name, detail });
  log('PASS', `${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, detail = '') {
  results.push({ ok: false, name, detail });
  log('FAIL', `${name}${detail ? ` — ${detail}` : ''}`);
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function bodyText(page) {
  return page.locator('body').innerText();
}

async function hasText(page, re) {
  const text = await bodyText(page);
  return re.test(text) || text.includes(typeof re === 'string' ? re : '');
}

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log(`Room URL:     ${ROOM_URL}`);
  console.log(`Bot name:     ${DISPLAY_NAME}`);
  console.log(`Hold online:  ${HOLD_SECONDS}s (stay visible in your browser)`);
  console.log('══════════════════════════════════════════════\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  try {
    // ── 1. Load + join ──────────────────────────────────────────
    log('STEP', 'Opening join page…');
    const response = await page.goto(ROOM_URL, {
      waitUntil: 'networkidle',
      timeout: 20000,
    });
    response?.ok()
      ? pass('Page loads', `HTTP ${response.status()}`)
      : fail('Page loads', `status ${response?.status()}`);

    const nameInput = page.getByLabel(/display name/i);
    if (!(await nameInput.isVisible().catch(() => false))) {
      fail('Join gate', 'display name input missing — aborting');
      return;
    }
    pass('Join gate visible');

    await nameInput.fill(DISPLAY_NAME);
    await page.getByRole('button', { name: /^join$/i }).click();
    log('STEP', `Joining as ${DISPLAY_NAME}…`);

    await page
      .getByRole('heading', { name: /^sprint room$/i })
      .waitFor({ state: 'visible', timeout: 20000 });
    pass('Join succeeds', `in room as ${DISPLAY_NAME}`);
    await page.screenshot({ path: '/tmp/sprint-e2e-01-joined.png', fullPage: true });

    // ── 2. Presence / chrome ────────────────────────────────────
    const text1 = await bodyText(page);
    text1.includes(DISPLAY_NAME)
      ? pass('Own name in presence/UI')
      : fail('Own name in presence/UI');
    /sprint\s*ai/i.test(text1)
      ? pass('Sprint AI visible')
      : fail('Sprint AI visible');
    (await page.getByRole('button', { name: /clarify/i }).isVisible())
      ? pass('Clarify button ready')
      : fail('Clarify button ready');

    log(
      'WATCH',
      `>>> Look at your browser now — you should see "${DISPLAY_NAME}" in presence <<<`
    );
    await sleep(5000);

    // ── 3. Multiple raw inputs over time ────────────────────────
    const raw = page.getByLabel(/raw input text/i);
    const probes = [
      `Feature: collaborative dark mode (${Date.now()})`,
      `Bug: export loses acceptance criteria`,
      `Constraint: ship MVP in one day`,
    ];

    for (let i = 0; i < probes.length; i++) {
      log('STEP', `Adding raw input ${i + 1}/${probes.length}…`);
      await raw.fill(probes[i]);
      await page.getByRole('button', { name: /^add$/i }).click();
      await sleep(2000);
      const t = await bodyText(page);
      t.includes(probes[i])
        ? pass(`Raw input ${i + 1} visible`, probes[i].slice(0, 48))
        : fail(`Raw input ${i + 1} visible`, 'not on page for bot');
      log(
        'WATCH',
        `>>> Check your Raw Inputs list for: "${probes[i].slice(0, 40)}…" <<<`
      );
    }
    await page.screenshot({ path: '/tmp/sprint-e2e-02-inputs.png', fullPage: true });

    // ── 4. Notes collaborative edit ─────────────────────────────
    log('STEP', 'Typing into shared Notes…');
    const notes = page.locator('.ProseMirror, [contenteditable="true"]').first();
    if (await notes.isVisible().catch(() => false)) {
      await notes.click();
      const noteLine = `E2E notes sync check ${Date.now()}`;
      await notes.type(noteLine, { delay: 20 });
      await sleep(1500);
      const t = await bodyText(page);
      t.includes('E2E notes sync')
        ? pass('Notes editor accepts text', noteLine)
        : fail('Notes editor accepts text');
      log('WATCH', `>>> Notes pane should show: "${noteLine}" <<<`);
    } else {
      fail('Notes editor visible');
    }

    // ── 5. Presence still online mid-session ────────────────────
    log('STEP', 'Verifying bot still present after 15s online…');
    await sleep(10000);
    const mid = await bodyText(page);
    mid.includes(DISPLAY_NAME)
      ? pass('Still in presence after activity')
      : fail('Still in presence after activity', 'name gone from bot view');

    // ── 6. Clarify (Bedrock) ────────────────────────────────────
    log('STEP', 'Clicking Clarify (may take up to 30s)…');
    log('WATCH', '>>> Sprint AI should show working; questions should appear <<<');
    await page.getByRole('button', { name: /clarify/i }).click();

    const clarifyOutcome = await page
      .getByText(/ai is working/i)
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => 'working')
      .catch(() => 'no-working-banner');
    clarifyOutcome === 'working'
      ? pass('AI working indicator after Clarify')
      : fail('AI working indicator after Clarify', clarifyOutcome);

    // Wait for real clarification questions (not the empty-state blurb)
    let clarifyDone = false;
    const clarifyDeadline = Date.now() + 45000;
    while (Date.now() < clarifyDeadline) {
      const qItems = page.locator(
        'section[aria-label="Clarifications"] ul[aria-label="Clarification questions"] > li'
      );
      const qCount = await qItems.count();
      const toastText =
        (await page.locator('[data-testid="error-toast"]').first().innerText().catch(() => '')) ||
        '';
      if (toastText) {
        fail('Clarify produced questions', `error toast: ${toastText.slice(0, 240)}`);
        clarifyDone = true;
        break;
      }
      if (qCount > 0) {
        const firstQ = await qItems.first().innerText();
        pass('Clarify produced questions', `${qCount} question(s); first: ${firstQ.slice(0, 80)}`);
        clarifyDone = true;
        break;
      }
      await sleep(2000);
    }
    if (!clarifyDone) {
      fail(
        'Clarify produced questions',
        'timed out — restart partykit:dev; open a NEW room (old Yjs snapshot may be corrupt)'
      );
    }
    await page.screenshot({ path: '/tmp/sprint-e2e-03-clarify.png', fullPage: true });

    // Try answering first clarification answer field if present
    const answerBox = page
      .locator('section[aria-label="Clarifications"] textarea, section[aria-label="Clarifications"] input[type="text"]')
      .first();
    if (await answerBox.isVisible().catch(() => false)) {
      log('STEP', 'Answering first clarification…');
      await answerBox.fill('E2E answer: target 2-week ship, Alice owns auth');
      const answerBtn = page
        .locator('section[aria-label="Clarifications"]')
        .getByRole('button', { name: /answer|submit|save/i })
        .first();
      if (await answerBtn.isVisible().catch(() => false)) {
        await answerBtn.click();
      } else {
        await answerBox.press('Enter');
      }
      await sleep(2000);
      pass('Submitted a clarification answer');
      log('WATCH', '>>> You should see the E2E answer on a clarification <<<');
    } else {
      fail('Clarification answer field available', 'skipping answer step');
    }

    // ── 7. Plan ─────────────────────────────────────────────────
    log('STEP', 'Clicking Plan (may take up to 30s)…');
    log('WATCH', '>>> Sprint packet should fill for both of you <<<');
    const planBtn = page.getByRole('button', { name: /^plan$/i });
    if (await planBtn.isEnabled()) {
      await planBtn.click();
    } else {
      // wait for AI idle
      await sleep(3000);
      await planBtn.click({ force: true }).catch(() => {});
      await planBtn.click().catch(() => fail('Plan click', 'button not clickable'));
    }

    let planDone = false;
    const planDeadline = Date.now() + 45000;
    while (Date.now() < planDeadline) {
      const t = await bodyText(page);
      if (/sprint goal|in.scope|out.of.scope|acceptance/i.test(t)) {
        // Heuristic: SprintPacketPanel labels
        pass('Plan content visible', 'packet-like text found');
        planDone = true;
        break;
      }
      await sleep(2000);
    }
    if (!planDone) {
      const toast = await page
        .locator('[data-testid="error-toast"]')
        .first()
        .innerText()
        .catch(() => '');
      fail('Plan content visible', toast || 'timed out — check Bedrock errors in PartyKit');
    }
    await page.screenshot({ path: '/tmp/sprint-e2e-04-plan.png', fullPage: true });

    // ── 8. Hold online so you can observe ───────────────────────
    const remaining = Math.max(10, HOLD_SECONDS - 60);
    log(
      'HOLD',
      `Staying connected ${remaining}s — bot must remain in your presence bar`
    );
    log(
      'WATCH',
      `>>> Do NOT expect me to leave yet. Presence should still show ${DISPLAY_NAME} <<<`
    );

    const holdEnd = Date.now() + remaining * 1000;
    let checks = 0;
    while (Date.now() < holdEnd) {
      await sleep(10000);
      checks++;
      const t = await bodyText(page);
      if (t.includes(DISPLAY_NAME)) {
        pass(`Presence check #${checks}`, 'still online');
      } else {
        fail(`Presence check #${checks}`, 'bot name missing while browser still open');
      }
    }

    await page.screenshot({ path: '/tmp/sprint-e2e-05-final.png', fullPage: true });

    if (consoleErrors.length) {
      fail('Console clean', consoleErrors.slice(0, 3).join(' | ').slice(0, 280));
    } else {
      pass('Console clean');
    }
  } finally {
    log('STEP', 'Closing bot browser — you should see presence drop within ~5s');
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n══════════════════════════════════════════════');
  console.log(`Summary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('Failures:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  }
  console.log('Screenshots: /tmp/sprint-e2e-0*.png');
  console.log('══════════════════════════════════════════════');
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
