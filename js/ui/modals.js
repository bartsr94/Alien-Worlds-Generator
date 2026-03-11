// Tutorial modal and power-user survey tracker.
import { state } from '../core/state.js';

/** Wire up the five-step tutorial modal. */
export function initTutorial() {
    const overlay  = document.getElementById('tutorialOverlay');
    const card     = document.getElementById('tutorialCard');
    const closeBtn = document.getElementById('tutorialClose');
    const backBtn  = document.getElementById('tutorialBack');
    const nextBtn  = document.getElementById('tutorialNext');
    const helpBtn  = document.getElementById('helpBtn');
    const steps    = card.querySelectorAll('.tutorial-step');
    const dots     = card.querySelectorAll('.dot');
    const TOTAL    = steps.length;
    const LS_KEY   = 'atlas-engine-tutorial-seen';
    let current    = 0;

    function showStep(i) {
        current = i;
        steps.forEach((s, idx) => s.classList.toggle('active', idx === i));
        dots.forEach((d, idx) => d.classList.toggle('active', idx === i));
        backBtn.disabled = i === 0;
        nextBtn.textContent = i === TOTAL - 1 ? 'Get Started' : 'Next';
    }

    function openModal() {
        current = 0;
        showStep(0);
        overlay.classList.remove('hidden');
    }

    function closeModal() {
        overlay.classList.add('hidden');
        localStorage.setItem(LS_KEY, '1');
    }

    nextBtn.addEventListener('click', () => {
        if (current < TOTAL - 1) showStep(current + 1);
        else closeModal();
    });

    backBtn.addEventListener('click', () => {
        if (current > 0) showStep(current - 1);
    });

    closeBtn.addEventListener('click', closeModal);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !overlay.classList.contains('hidden')) closeModal();
    });

    helpBtn.addEventListener('click', openModal);

    // Update tutorial step 2 for touch devices
    if (state.isTouchDevice) {
        const step2 = card.querySelector('.tutorial-step[data-step="2"]');
        if (step2) {
            const p = step2.querySelector('p');
            if (p) p.innerHTML = '<strong>Drag</strong> to rotate the globe. <strong>Pinch</strong> to zoom in and out. Tap the <strong>edit button</strong> (pencil icon) then <strong>tap</strong> any plate to reshape continents &mdash; ocean rises into land, land floods into ocean.';
        }
    }

    // Auto-show on first visit — wait until the build overlay has faded out
    overlay.classList.add('hidden');
    if (!localStorage.getItem(LS_KEY)) {
        const genBtn = document.getElementById('generate');
        const buildOverlayEl = document.getElementById('buildOverlay');
        genBtn.addEventListener('generate-done', () => {
            if (buildOverlayEl) {
                buildOverlayEl.addEventListener('transitionend', () => openModal(), { once: true });
            } else {
                openModal();
            }
        }, { once: true });
    }
}

/** Track hours and days of active use; show the survey after 3+ hours across 2+ days. */
export function initSurveyTracker() {
    const LS = 'wo-usage';
    const LS_DISMISSED = 'wo-survey-dismissed';

    if (localStorage.getItem(LS_DISMISSED)) return;

    let data;
    try { data = JSON.parse(localStorage.getItem(LS)) || {}; } catch (_) { data = {}; }
    const hours = data.h || 0;
    const days  = data.d || 0;
    const lastH = data.lh || '';
    const lastD = data.ld || '';

    // Epoch-based buckets: no readable timestamps stored, no custom hash needed
    const hourKey = Math.floor(Date.now() / 3_600_000).toString(36);
    const dayKey  = Math.floor(Date.now() / 86_400_000).toString(36);

    const newHours = hourKey !== lastH ? hours + 1 : hours;
    const newDays  = dayKey  !== lastD ? days  + 1 : days;

    localStorage.setItem(LS, JSON.stringify({ h: newHours, d: newDays, lh: hourKey, ld: dayKey }));

    if (newHours >= 3 && newDays >= 2) {
        const overlay    = document.getElementById('surveyOverlay');
        const closeBtn   = document.getElementById('surveyClose');
        const dismissBtn = document.getElementById('surveyDismiss');
        const linkBtn    = document.getElementById('surveyLink');
        if (!overlay) return;

        function dismiss() {
            overlay.classList.add('hidden');
            localStorage.setItem(LS_DISMISSED, '1');
        }

        // Show after the first generation completes
        const genBtn = document.getElementById('generate');
        genBtn.addEventListener('generate-done', () => {
            setTimeout(() => overlay.classList.remove('hidden'), 1000);
        }, { once: true });

        closeBtn.addEventListener('click', dismiss);
        dismissBtn.addEventListener('click', dismiss);
        linkBtn.addEventListener('click', dismiss);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !overlay.classList.contains('hidden')) dismiss();
        });
    }
}
