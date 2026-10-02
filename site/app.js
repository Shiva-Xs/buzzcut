// trybuzzcut.pages.dev: the shaved stripe, the roast receipt, the before/after cut and the
// "push it" replay. The roast itself comes from buzzcut-web.js: the real analyzer, run here.
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = (n) => Number(n).toLocaleString('en-US');
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };

  // ─── copy buttons ─────────────────────────────────────────────────────────
  async function copy(text, btn) {
    const label = btn.dataset.label ?? btn.textContent;
    btn.dataset.label = label;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Press ⌘C';
    }
    btn.classList.add('done');
    setTimeout(() => {
      btn.textContent = label;
      btn.classList.remove('done');
    }, 1400);
  }
  $$('[data-copy]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.copy, b)));

  // ─── 00 · the hero: real AI yap, with a stripe shaved through it ──────────
  const YAP = [
    '## 🚀 Summary',
    'This PR introduces a comprehensive and robust retry mechanism for webhook delivery, significantly enhancing the reliability and resilience of our notification system.',
    '## ✨ Key Changes',
    '- **Retry Logic**: Implemented a robust retry loop that seamlessly handles transient failures',
    '- **Exponential Backoff**: Leveraged exponential backoff to ensure optimal performance under load',
    '- **Error Handling**: Enhanced error handling with descriptive error messages',
    '- **Code Quality**: Improved code readability and maintainability',
    '## 📁 Files Changed',
    '- `src/webhook.ts`: Updated the send function with retry logic',
    '- Updated webhook.ts to use a for loop',
    '## 🧪 Testing',
    '- [x] Tested locally',
    '- [x] No breaking changes',
    '- [x] Follows the style guidelines of this project',
    '## 📝 Notes',
    'Overall, these changes significantly improve the robustness of our webhook delivery pipeline and follow industry best practices. Let me know if you have any questions!',
    '## 🎯 Impact',
    'This change empowers the team to deliver a seamless, production-ready developer experience across the entire platform.',
    "It's worth noting that this refactor plays a crucial role in our holistic approach to scalability and long-term maintainability.",
    '## 🔒 Security Considerations',
    'Bolstered our security posture by leveraging best practices throughout the codebase.',
    '- **Performance**: Significantly faster and more efficient',
    '- **Architecture**: Streamlined the module structure for future-proof extensibility',
    'In summary, this PR delivers comprehensive improvements that elevate the overall quality of the project.',
    "Here's the PR description you asked for. Happy to address any feedback!",
  ];
  const BUZZ = /^(?:comprehensive|robust|robustness|seamless|seamlessly|leverag\w*|enhanc\w*|significantly|streamlin\w*|empower\w*|holistic|crucial|production-ready|elevate|bolster\w*|future-proof|optimal|resilience|best|practices|industry|worth|noting|overall,?|introduces)[.,!]?$/i;

  const hero = $('.hero');
  const band = $('#band');
  const yapCv = $('#yap');
  const fxCv = $('#fx');
  const clipper = $('#clipper');
  const hint = $('#hint');
  const yap = yapCv.getContext('2d');
  const fx = fxCv.getContext('2d');
  let W = 0;
  let H = 0;
  let revealed = false;
  let cleared = 0; // how far the stripe has been shaved, in px

  // Whole pixels: a clear with fractional edges leaves faint slivers of text behind.
  function bandBox() {
    const h = hero.getBoundingClientRect();
    const b = band.getBoundingClientRect();
    const top = Math.floor(b.top - h.top);
    return { top, height: Math.ceil(b.bottom - h.top) - top };
  }

  function size(cv, ctx) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintYap() {
    W = hero.clientWidth;
    H = hero.clientHeight;
    size(yapCv, yap);
    size(fxCv, fx);
    const small = W < 600;
    const fs = small ? 11 : 13;
    const lh = small ? 18 : 21;
    const pad = small ? 14 : 28;
    yap.textBaseline = 'top';
    yap.font = `400 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
    const cw = yap.measureText('M').width || fs * 0.6;
    const cols = Math.max(20, Math.floor((W - pad * 2) / cw));
    let y = 14;
    let i = 0;
    const words = (s) => s.split(' ');
    while (y < H) {
      const para = YAP[i % YAP.length];
      i++;
      const heading = para.startsWith('##');
      let line = [];
      let len = 0;
      const flush = () => {
        let x = pad;
        for (const w of line) {
          yap.font = `${heading ? 700 : 400} ${fs}px "JetBrains Mono", ui-monospace, monospace`;
          // Texture, not text: quiet enough that the headline and the install command own the screen.
          yap.fillStyle = heading ? 'rgba(243,237,226,0.15)' : BUZZ.test(w) ? 'rgba(255,75,54,0.3)' : 'rgba(243,237,226,0.075)';
          yap.fillText(w, x, y);
          x += (w.length + 1) * cw;
        }
        y += lh;
        line = [];
        len = 0;
      };
      for (const w of words(para)) {
        if (len && len + 1 + w.length > cols) flush();
        line.push(w);
        len += (len ? 1 : 0) + w.length;
        if (y > H) break;
      }
      if (line.length) flush();
    }
    if (revealed) {
      const { top, height } = bandBox();
      yap.clearRect(0, top, W, height);
    }
  }

  // Hair: short strands that fall out of the shaved stripe.
  const HAIR = ['rgba(243,237,226,0.55)', 'rgba(243,237,226,0.3)', 'rgba(255,75,54,0.7)', 'rgba(243,237,226,0.42)'];
  const hairs = [];
  let ticking = false;
  function spawn(x, y, n, push = 1) {
    if (calm) return;
    for (let k = 0; k < n && hairs.length < 900; k++) {
      hairs.push({
        x: x + (Math.random() - 0.5) * 6,
        y,
        vx: push * (0.4 + Math.random() * 2.4),
        vy: -Math.random() * 1.8,
        len: 5 + Math.random() * 12,
        a: Math.random() * Math.PI,
        va: (Math.random() - 0.5) * 0.28,
        c: HAIR[(Math.random() * HAIR.length) | 0],
      });
    }
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(fall);
    }
  }
  function fall() {
    fx.clearRect(0, 0, W, H);
    fx.lineWidth = 1.2;
    for (let k = hairs.length - 1; k >= 0; k--) {
      const p = hairs[k];
      p.vy += 0.17;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      if (p.y > H + 20) {
        hairs.splice(k, 1);
        continue;
      }
      const dx = (Math.cos(p.a) * p.len) / 2;
      const dy = (Math.sin(p.a) * p.len) / 2;
      fx.strokeStyle = p.c;
      fx.beginPath();
      fx.moveTo(p.x - dx, p.y - dy);
      fx.lineTo(p.x + dx, p.y + dy);
      fx.stroke();
    }
    if (hairs.length) requestAnimationFrame(fall);
    else {
      ticking = false;
      fx.clearRect(0, 0, W, H);
    }
  }

  function reveal() {
    revealed = true;
    hero.classList.add('revealed');
    band.style.clipPath = '';
  }

  function sweep() {
    const { top, height } = bandBox();
    if (calm) {
      yap.clearRect(0, top, W, height);
      reveal();
      return;
    }
    clipper.style.top = `${top}px`;
    clipper.style.height = `${height}px`;
    clipper.classList.add('on');
    const t0 = performance.now();
    const dur = Math.min(1150, 520 + W * 0.42);
    const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const x = -30 + (W + 60) * ease(k);
      if (x > cleared) {
        yap.clearRect(Math.floor(cleared), top, Math.ceil(x) - Math.floor(cleared) + 1, height);
        spawn(x, top + Math.random() * height, Math.min(14, Math.ceil((x - cleared) / 5)));
        cleared = x;
      }
      band.style.clipPath = `inset(0 ${Math.max(0, W - x)}px 0 0)`;
      clipper.style.transform = `translateX(${x - 26}px)`;
      if (k < 1) requestAnimationFrame(step);
      else {
        clipper.classList.remove('on');
        yap.clearRect(0, top, W, height);
        reveal();
      }
    };
    requestAnimationFrame(step);
  }

  // Your turn: the cursor shaves whatever yap is left.
  let last = null;
  let shaved = 0;
  hero.addEventListener('pointermove', (e) => {
    if (!revealed || e.pointerType !== 'mouse') return;
    const h = hero.getBoundingClientRect();
    const x = e.clientX - h.left;
    const y = e.clientY - h.top;
    const { top, height } = bandBox();
    if (y > top && y < top + height) {
      last = null;
      return;
    }
    if (last) {
      const d = Math.hypot(x - last.x, y - last.y);
      const n = Math.max(1, Math.ceil(d / 4));
      for (let k = 1; k <= n; k++) {
        const px = last.x + ((x - last.x) * k) / n;
        const py = last.y + ((y - last.y) * k) / n;
        yap.clearRect(px - 17, py - 9, 34, 18);
      }
      if (d > 2) spawn(x, y, Math.min(6, Math.ceil(d / 7)), x >= last.x ? 1 : -1);
      shaved += d;
      if (shaved > 500 && hint && !hint.classList.contains('gone')) {
        hint.classList.add('gone');
        store.set('buzzcut:shaved', '1');
      }
    }
    last = { x, y };
  });
  hero.addEventListener('pointerleave', () => (last = null));
  if (store.get('buzzcut:shaved')) hint?.classList.add('gone');

  let lastW = 0;
  new ResizeObserver(() => {
    if (Math.abs(hero.clientWidth - lastW) < 2 && Math.abs(hero.clientHeight - H) < 2) return;
    lastW = hero.clientWidth;
    paintYap();
  }).observe(hero);

  const fontsReady = document.fonts?.load ? document.fonts.load('13px "JetBrains Mono"').catch(() => null) : Promise.resolve();
  Promise.race([fontsReady, sleep(900)]).then(() => {
    lastW = hero.clientWidth;
    paintYap();
    setTimeout(sweep, calm ? 0 : 280);
  });

  // ─── 01 · try it: roast receipts ─────────────────────────────────────────
  const ticket = $('#ticket');
  const status = $('#status');
  const input = $('#target');
  // The full hint doesn't fit a phone-width box; the short one still names both inputs.
  if (matchMedia('(max-width: 600px)').matches) input.placeholder = 'PR link or owner/repo';
  const go = $('#go');
  const queue = $('#queue');
  const SITE = 'https://trybuzzcut.pages.dev/';
  const HEAT = { praise: 'Says what changed and why. It gets a compliment.', nit: 'Mostly there. It gets a nit or two.', roast: 'It gets the full roast.' };
  const MARK = { ok: '✓', bad: '✗', meh: '!', none: '–' };
  const ICON = { error: '✗', warn: '!', info: '·' };
  let currentTarget = '';

  // Sharing is about the tool, never about somebody's PR.
  const post = 'AI writes our code now. buzzcut makes the pull requests readable again: what changed and why, in plain words, like the good old days.\n\nRoast any PR in your browser:';
  $('#share-x').href = `https://x.com/intent/tweet?text=${encodeURIComponent(post)}&url=${encodeURIComponent(SITE)}`;

  const row = (k, v) => `<div class="t-row"><span>${esc(k)}</span><span class="lead"></span><b>${esc(v)}</b></div>`;
  const stamp = (grade, verdict, score) =>
    `<div class="stamp ${grade}" aria-label="Grade ${grade}, ${esc(verdict)}"><span class="g">${grade}</span><span class="s">${esc(verdict.replace(/\.$/, ''))}</span><span class="p">${score}/100 yap</span></div>`;
  const head = (sub) => `<div class="t-shop">Buzzcut</div><div class="t-sub">${sub}</div><hr class="t-rule">`;
  const foot = (who) => `<div class="t-foot"><span>Tip your ${who}:<br><b>npx buzzcut</b></span><span class="barcode" aria-hidden="true"></span></div>`;

  function prTicket(c, demo) {
    const basics = [['What changed', c.basics.what], ['Why', c.basics.why]]
      .map(([k, b]) => `<span class="m ${b.mark}" aria-label="${b.mark}">${MARK[b.mark]}</span><span class="k">${k.toUpperCase()}</span><span class="v ${b.mark}">${esc(b.text)}</span>`)
      .join('');
    const cell = (k, v) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
    const stats = [cell('Words', fmt(c.words))];
    if (c.lines != null) stats.push(cell('Diff', `${fmt(c.lines)} line${c.lines === 1 ? '' : 's'}`));
    if (c.perLine) stats.push(cell('Per line', c.perLine));
    if (c.yapPct != null) stats.push(cell('Could be', `~${fmt(c.budget)} (${c.yapPct}% yap)`));
    // The receipt has to fit on one screen next to the form: four burns at most.
    const shown = c.burns.slice(0, 4);
    const more = c.more + c.burns.length - shown.length;
    const burns = shown.length
      ? `<hr class="t-rule"><div class="t-h">${c.heat === 'nit' ? 'Nits' : 'The cut'}</div>${shown.map((b) => `<div class="t-burn ${b.severity}"><i>${ICON[b.severity]}</i><span>${esc(b.text)}</span></div>`).join('')}${more ? `<div class="t-none">…and ${more} more</div>` : ''}`
      : '';
    const keep = c.keep
      ? c.keep.sentences.length
        ? `<hr class="t-rule"><div class="t-h">Worth keeping</div>${c.keep.sentences.map((s) => `<div class="t-keep">${esc(s)}</div>`).join('')}`
        : '<hr class="t-rule"><div class="t-line"><span class="t-h">Worth keeping</span> <span class="t-none">nothing. No numbers, no errors, no reason why.</span></div>'
      : '';
    const ref = demo ? `<span>${esc(c.ref)}</span>` : `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.ref)}</a>`;
    return `
      ${head('haircuts for AI pull requests')}
      <div class="t-ref"><span>TICKET</span>${ref}</div>
      <div class="t-title">"${esc(c.title)}"</div>
      <hr class="t-rule">
      <div class="t-basics">${basics}</div>
      <hr class="t-rule">
      <div class="t-stats">${stats.join('')}</div>
      ${burns}
      ${keep}
      <hr class="t-rule">
      <div class="t-seal"><div><div class="t-h">Verdict</div><div class="t-verdict">${esc(c.closer)}</div></div>${stamp(c.grade, c.verdict, c.score)}</div>
      ${foot('reviewer')}`;
  }

  function boardTicket(b) {
    const rows = b.rows
      .map(
        (r) => `<tr><td class="mk ${r.pass ? 'ok' : 'bad'}">${r.pass ? '✓' : '✗'}</td><td><a href="${esc(r.url)}" target="_blank" rel="noopener"><b>${esc(r.id)}</b></a><span class="ttl">${esc(r.title)}</span></td><td class="n">${r.score} ${r.grade}</td><td class="n">${fmt(r.words)}w</td></tr>`,
      )
      .join('');
    const lines = [row('PRs sent back', `${b.failing} of ${b.rows.length}`)];
    if (b.yappiest) lines.push(row('Yappiest', `${b.yappiest.id}: ${fmt(b.yappiest.words)} words, ${fmt(b.yappiest.lines)} lines`));
    if (b.overBudget >= 100) lines.push(row('Words nobody needed', fmt(b.overBudget)));
    const [repo, what] = b.subject.split(' · ');
    return `
      ${head('group booking')}
      <div class="t-ref"><span>TICKET</span><span>${esc(repo)}</span></div>
      <div class="t-title">${esc(what || '')}</div>
      <hr class="t-rule">
      <table class="t-board"><tbody>${rows}</tbody></table>
      <hr class="t-rule">
      ${lines.join('')}
      <hr class="t-rule">
      <div class="t-seal"><div><div class="t-h">Average</div><div class="t-verdict">${esc(b.verdict)}</div></div>${stamp(b.grade, b.verdict, b.average)}</div>
      ${foot('reviewers')}`;
  }

  function siteLink(target) {
    const u = new URL(location.href);
    u.search = target ? `?roast=${encodeURIComponent(target)}` : '';
    u.hash = target ? '' : 'try';
    return u.toString();
  }

  function show(r, target, demo = false) {
    currentTarget = target;
    ticket.classList.remove('busy');
    ticket.innerHTML = r.kind === 'pr' ? prTicket(r.card, demo) : boardTicket(r.board);
    ticket.classList.remove('print');
    void ticket.offsetWidth;
    ticket.classList.add('print');
  }

  // The queue: three made-up PRs, each rendered from the real roast so the numbers are true.
  const ORDER = ['yappy', 'decent', 'clean'];
  const demos = Object.fromEntries(ORDER.map((k) => [k, buzzcut.demo(buzzcut.SAMPLES[k])]));
  queue.innerHTML = ORDER.map((k) => {
    const c = demos[k].card;
    return `<li><button type="button" class="pr-row" data-sample="${k}" aria-pressed="false">
      <span class="g ${c.grade}" aria-label="Grade ${c.grade}">${c.grade}</span>
      <span><span class="t">${esc(c.title)}</span><span class="m">#${c.ref.split('#')[1]} · ${fmt(c.lines)} changed lines · ${fmt(c.words)} words</span></span>
      <span class="go" aria-hidden="true">→</span>
    </button></li>`;
  }).join('');

  function pickSample(name) {
    show(demos[name], '', true);
    $$('.pr-row').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sample === name)));
    status.className = 'status';
    status.textContent = HEAT[demos[name].card.heat];
  }
  $$('.pr-row').forEach((b) => b.addEventListener('click', () => pickSample(b.dataset.sample)));

  async function roast(target) {
    target = target.trim();
    if (!target) {
      input.focus();
      return;
    }
    go.disabled = true;
    go.setAttribute('aria-busy', 'true');
    ticket.classList.add('busy');
    status.className = 'status';
    status.textContent = /\/pull\/|#\d+$/.test(target) ? 'Fetching the PR from GitHub…' : 'Fetching the last merged PRs from GitHub…';
    try {
      show(await buzzcut.roast(target), target);
      $$('.pr-row').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      status.textContent = 'Want every PR your team reviews to read like the clean kind? npm i -g buzzcut';
      history.replaceState(null, '', siteLink(target));
    } catch (e) {
      ticket.classList.remove('busy');
      status.className = 'status err';
      status.textContent = e.message;
    } finally {
      go.disabled = false;
      go.removeAttribute('aria-busy');
    }
  }

  $('#seat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    roast(input.value);
  });
  $('#copy-link').addEventListener('click', (e) => copy(siteLink(currentTarget), e.currentTarget));

  pickSample('yappy');
  const initial = new URLSearchParams(location.search).get('roast');
  if (initial) {
    input.value = initial;
    roast(initial);
    setTimeout(() => $('#try').scrollIntoView(), 60);
  }

  // ─── 02 · the problem: the same PR, before and after ──────────────────────
  const BEFORE = [
    { t: '## 🚀 Summary', h: 1, yap: '3 form headers for 9 lines of code' },
    { t: 'This PR introduces a comprehensive and robust retry mechanism for webhook delivery, significantly enhancing the reliability of our notification system.', yap: "An opener and buzzwords. Says nothing the title didn't" },
    { t: '## ✨ Key Changes', h: 1 },
    { t: '- **Retry Logic**: Implemented a robust retry loop in `src/webhook.ts`', yap: 'A tour of the diff. GitHub already shows it' },
    { t: '- **Why**: customer endpoints return [[502s and 503s while they restart]], so we drop [[about 2% of events]]', keep: 'The only reason in here. Keep it' },
    { t: '- **Backoff**: [[5xx and 429]] retry up to [[3 times]], waiting [[200ms, 400ms, 800ms]] plus [[up to 100ms of jitter]]', keep: 'Facts. Keep them' },
    { t: '- **Error Handling**: [[other 4xx]] still fail right away', keep: 'A behavior a reviewer asks about. Keep it' },
    { t: '- **Code Quality**: Improved readability and maintainability', yap: 'A claim with nothing behind it' },
    { t: '## 🧪 Testing', h: 1 },
    { t: '- [x] [[`npm test`]] passes, plus a local server that returns [[503 twice, then 200]]', keep: 'What actually ran. Keep it' },
    { t: '- [x] No breaking changes', yap: 'A ticked box. Checked how?' },
    { t: 'Overall, these changes significantly improve the robustness of our webhook pipeline.', yap: 'A summary of the summary' },
  ];
  // The same change, the way a good PR always read: what changed and why, the changes a reviewer
  // would ask about, and what was tested. It keeps the facts above and adds none. With the markup
  // stripped it's test/fixtures/good-pr.md word for word (a test checks), so the roast box's
  // "clean" example and this panel show the same PR.
  const AFTER = {
    title: 'Retry webhook deliveries on 5xx and 429',
    opening: '<mark class="why">Webhook deliveries to customer endpoints fail [[about 2% of the time]] with [[502s and 503s]] while their servers restart, and we drop the event.</mark> This retries them.',
    bullets: [
      '<mark class="what">[[5xx and 429]] responses retry up to [[3 times]] with backoff ([[200ms, 400ms, 800ms]], plus [[up to 100ms of jitter]]), then throw so the job queue picks the event up</mark>',
      'Other 4xx responses still fail right away, since retrying won\'t help',
    ],
    tested: 'Tested: `npm test`, plus a local server that returns 503 twice, then 200.',
  };
  const PR_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.12v5.26a2.25 2.25 0 1 1-1.5 0V5.37a2.25 2.25 0 0 1-1.5-2.12Zm2.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM3.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25-.63V6.5A1.5 1.5 0 0 0 10.5 5H9.56l1.22 1.22a.75.75 0 1 1-1.06 1.06l-2.5-2.5a.75.75 0 0 1 0-1.06l2.5-2.5a.75.75 0 1 1 1.06 1.06L9.56 3.5h.94a3 3 0 0 1 3 3v4.87a2.25 2.25 0 1 1-1.5 0ZM12.75 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>';
  const words = (s) => (s.replace(/<[^>]+>/g, ' ').replace(/\[\[|\]\]/g, '').replace(/[#*`\-[\]]/g, ' ').match(/[\p{L}\p{N}][\p{L}\p{N}'’.%-]*/gu) || []).length;
  const facts = (s) => esc(s).replace(/\[\[(.+?)\]\]/g, '<span class="fact">$1</span>');
  // The after body carries its own <mark> tags, so only the facts get marked up there.
  const markFacts = (s) => s.replace(/\[\[(.+?)\]\]/g, '<span class="fact">$1</span>');
  // Counted by buzzcut itself, so the panel and the roast box agree on the same PR.
  const beforeWords = buzzcut.demo({ title: 'Add comprehensive retry mechanism', body: BEFORE.map((l) => l.t.replace(/\[\[|\]\]/g, '')).join('\n'), files: [['src/webhook.ts', 7, 2]], number: 482 }).card.words;
  const afterWords = demos.clean.card.words;

  const view = $('#pr-view');
  const blade = $('#blade');
  const wc = $('#wc');
  const prStatus = $('#pr-status');
  const cutBtn = $('#cut');
  const tabBefore = $('#tab-before');
  const tabAfter = $('#tab-after');
  let run = 0;
  let state = 'before';

  function countTo(to, ms = 400) {
    const from = Number(wc.textContent) || 0;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      wc.textContent = Math.round(from + (to - from) * k);
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function setTabs(which) {
    tabBefore.setAttribute('aria-selected', String(which === 'before'));
    tabAfter.setAttribute('aria-selected', String(which === 'after'));
    view.setAttribute('aria-labelledby', which === 'before' ? 'tab-before' : 'tab-after');
  }

  function renderBefore() {
    run++;
    state = 'before';
    setTabs('before');
    view.innerHTML = BEFORE.map((l, i) => {
      const kind = l.keep ? 'keep' : 'yap';
      const note = l.keep || l.yap;
      return `<div class="ln ${kind}${l.h ? ' h' : ''}" data-i="${i}"><span class="txt">${facts(l.t)}</span>${note ? `<span class="note">${esc(note)}</span>` : '<span></span>'}</div>`;
    }).join('');
    wc.textContent = beforeWords;
    prStatus.textContent = `acme/api · PR #482 · 9 changed lines · ${beforeWords} words`;
    cutBtn.innerHTML = 'Cut it <span aria-hidden="true">✂</span>';
  }

  // What went, in the order a reviewer would care about it.
  const LEDGER = [
    ['cut', '✂', '3 form headers', 'an opening and two bullets do the job'],
    ['cut', '✂', 'The opener and the buzzwords', 'comprehensive, robust, enhancing…'],
    ['cut', '✂', 'A tour of the diff', 'GitHub already shows src/webhook.ts'],
    ['cut', '✂', 'A claim with nothing behind it', 'readability and maintainability'],
    ['cut', '✂', 'A checklist and a sign-off', 'ticked boxes, "Overall, these changes…"'],
    ['ok', '✓', 'Every fact kept', '502s and 503s, 2%, 3 tries, 200/400/800ms, jitter, 429'],
    ['ok', '✓', 'Real testing', 'the command and the check that actually ran'],
  ];

  function renderAfter() {
    state = 'after';
    setTabs('after');
    const ledger = LEDGER.map(([cls, icon, what, why]) => `<li class="${cls}"><i>${icon}</i><span><b>${esc(what)}</b>${esc(why)}</span></li>`).join('');
    const [testedLabel, testedRest] = AFTER.tested.split(/(?<=^Tested:)/);
    // Laid out like the PR page a reviewer opens: title, state, then the description as the first comment.
    view.innerHTML = `<div class="after">
      <article class="gh">
        <header class="gh-head">
          <h4 class="gh-title">${esc(AFTER.title)} <span class="gh-num">#482</span></h4>
          <p class="gh-meta"><span class="gh-state">${PR_ICON}Open</span><span><b>agent</b> wants to merge into <code>main</code> from <code>retry-5xx</code></span></p>
        </header>
        <div class="gh-comment">
          <span class="gh-avatar" aria-hidden="true"></span>
          <div class="gh-box">
            <p class="gh-box-h"><b>agent</b> commented</p>
            <div class="pr-after">
              <p>${markFacts(AFTER.opening)}</p>
              <ul>${AFTER.bullets.map((b) => `<li>${markFacts(b)}</li>`).join('')}</ul>
              <p class="tested"><b>${esc(testedLabel)}</b>${esc(testedRest).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>
            </div>
          </div>
        </div>
        <p class="key" aria-hidden="true"><span class="what"><i></i>what changed</span><span class="why"><i></i>why</span><span class="fct"><i></i>facts kept</span></p>
      </article>
      <div class="ledger"><p class="ledger-h">What got cut</p><ul>${ledger}</ul></div>
    </div>`;
    countTo(afterWords, 500);
    const cuts = LEDGER.filter(([cls]) => cls === 'cut').length;
    prStatus.innerHTML = `<b>${beforeWords} → ${afterWords} words</b> · ${cuts} kinds of yap cut · every fact kept`;
    cutBtn.innerHTML = 'Again <span aria-hidden="true">↺</span>';
  }

  // A cut line bursts into falling characters.
  function burst(line) {
    const txt = $('.txt', line);
    txt.innerHTML = [...txt.textContent]
      .map((ch, i) => {
        const dx = (Math.random() * 2 - 1) * 70;
        const dy = 120 + Math.random() * 180;
        const r = (Math.random() * 2 - 1) * 120;
        const d = 600 + Math.random() * 450;
        return `<span class="ch" style="--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--r:${r.toFixed(0)}deg;--d:${d.toFixed(0)}ms;animation-delay:${Math.min(i * 3, 220)}ms">${esc(ch)}</span>`;
      })
      .join('');
    const note = $('.note', line);
    if (note) note.style.opacity = '0';
  }

  async function cut() {
    if (state === 'after') renderBefore();
    const id = ++run;
    state = 'cutting';
    if (calm) {
      renderAfter();
      return;
    }
    await sleep(250);
    const body = view.parentElement.getBoundingClientRect();
    let left = beforeWords;
    blade.classList.add('on');
    for (const line of $$('.ln', view)) {
      if (id !== run) return;
      const l = BEFORE[Number(line.dataset.i)];
      const box = line.getBoundingClientRect();
      blade.style.top = `${box.top - body.top + box.height / 2}px`;
      await sleep(240);
      if (l.keep) {
        await sleep(160);
        continue;
      }
      left -= words(l.t);
      countTo(left, 220);
      burst(line);
      await sleep(l.h ? 90 : 150);
    }
    blade.classList.remove('on');
    await sleep(450);
    if (id !== run) return;
    $$('.ln', view).forEach((l) => {
      if (!BEFORE[Number(l.dataset.i)].keep) l.classList.add('gone');
    });
    await sleep(750);
    if (id !== run) return;
    renderAfter();
  }

  let touched = false;
  cutBtn.addEventListener('click', () => {
    touched = true;
    cut();
  });
  tabAfter.addEventListener('click', () => {
    touched = true;
    if (state === 'before') cut();
  });
  tabBefore.addEventListener('click', () => {
    touched = true;
    renderBefore();
  });
  renderBefore();
  // Hold the panel at the height of the long version, so the page doesn't jump when it's cut.
  const holdHeight = () => {
    const body = view.parentElement;
    body.style.minHeight = '';
    if (state === 'before') body.style.minHeight = `${body.offsetHeight}px`;
  };
  holdHeight();
  addEventListener('resize', holdHeight);
  new IntersectionObserver(
    (entries, obs) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      obs.disconnect();
      // Give people a moment to read the notes before the clippers come out.
      setTimeout(() => !touched && state === 'before' && cut(), 2600);
    },
    { threshold: 0.55 },
  ).observe($('#panel'));

  // ─── 03 · "push it": what happens in the agent's session ──────────────────
  const SCRIPT = [
    { who: 'you', cls: 'you', html: 'push this to GitHub and open a PR' },
    { who: 'agent', cls: 'agent', type: 'git commit -m "feat: implement comprehensive webhook retry mechanism" -m "## Summary…"' },
    { who: 'buzzcut', cls: 'bz', html: '✗ Sent back before it ran. Markdown headers git log shows as raw ##, a bold label on every bullet, two ticked boxes with no command, and an opener that says nothing.' },
    { who: 'agent', cls: 'agent', html: 'Rewriting it as plain text: why in a line or two, then the two parts of the change as plain bullets.' },
    { who: 'agent', cls: 'agent', type: 'git commit -F .git/BUZZCUT_MSG' },
    { who: 'buzzcut', cls: 'bz ok', html: '✓ Yap score 0 · "Retry webhook deliveries on 5xx and 429"' },
    { who: 'agent', cls: 'agent', type: 'git push && gh pr create --body-file pr.md' },
    { who: 'buzzcut', cls: 'bz ok', html: '✓ PR passes · what changed, why, and what was tested, in 80 words' },
    { who: 'agent', cls: 'agent', html: 'Pushed. PR #483 is open.' },
  ];
  const log = $('#chat-log');
  // At rest the whole session is on screen, so the box never looks empty. When it scrolls into
  // view (or on Replay), it plays back in order over a faint copy of itself.
  log.innerHTML = SCRIPT.map(
    (step) => `<li class="${step.cls}"><span class="who">${esc(step.who)}</span><span class="msg">${step.type ? `<code>${esc(step.type)}</code>` : step.html}</span></li>`,
  ).join('');
  let chatRun = 0;
  async function replay() {
    if (calm) return;
    const id = ++chatRun;
    const items = $$('li', log);
    log.style.minHeight = `${log.offsetHeight}px`;
    items.forEach((li) => li.classList.add('wait'));
    for (const [i, step] of SCRIPT.entries()) {
      if (id !== chatRun) return;
      const li = items[i];
      li.classList.remove('wait');
      if (step.type) {
        const msg = $('.msg', li);
        const code = $('code', li);
        code.textContent = '';
        msg.classList.add('caret');
        for (let k = 1; k <= step.type.length; k++) {
          if (id !== chatRun) return;
          code.textContent = step.type.slice(0, k);
          await sleep(16);
        }
        msg.classList.remove('caret');
        await sleep(420);
      } else {
        await sleep(step.cls.startsWith('bz') ? 1150 : 800);
      }
    }
  }
  $('#replay').addEventListener('click', replay);
  if (calm) $('#replay').hidden = true;
  new IntersectionObserver(
    (entries, obs) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      obs.disconnect();
      replay();
    },
    { threshold: 0.5 },
  ).observe($('#chat'));

  // ─── quiet entrances ──────────────────────────────────────────────────────
  const reveal$ = $$('main > section:not(.hero) .label, main > section:not(.hero) h2, .split-head .sub, .pr-panel, .found, .how-grid, .rules, .tiers, .agents-line, .stats, .last .cmd, .last .fine');
  reveal$.forEach((el) => el.setAttribute('data-reveal', ''));
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in');
        $$('.bars', e.target).forEach((b) => b.classList.add('in'));
        io.unobserve(e.target);
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
  );
  reveal$.forEach((el) => io.observe(el));
})();
