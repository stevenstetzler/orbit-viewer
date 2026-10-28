/**
 * "Time window" start/end inputs for the trajectory pages' added
 * (custom-kernel) bodies: the span the "Reference epoch" slider scrubs
 * across and each added body's trajectory line is drawn over. Major
 * bodies are unaffected (they're drawn as orbits). Disabled until the
 * page has at least one added body; the page owns all the actual
 * clamping and redrawing in `setWindow` -- this only reads/shows ETs.
 *
 * Times are entered and shown in UTC, to the millisecond (added
 * kernels are often only seconds long).
 */
// spicejs: plain <script> global, not an import -- see kernelSession.js.
const { str2et, et2utc } = window.spicejs;

/**
 * @param {HTMLElement} container - controls are appended here
 * @param {object} options
 * @param {() => ([number, number]|null)} options.getWindow - current [startEt, endEt], or null if none
 * @param {() => ([number, number]|null)} options.getLimits - the widest window allowed ([startEt, endEt]), or null
 * @param {(startEt: number, endEt: number) => (void|Promise<void>)} options.setWindow - apply (the page clamps)
 * @param {(msg: string) => void} [options.log]
 * @returns {{ refresh(): void, setEnabled(enabled: boolean): void }}
 */
export function mountTimeWindowControls(container, { getWindow, getLimits, setWindow, log }) {
  container.classList.add('epochControls');
  container.innerHTML = `
    <div class="epochRow"><label style="flex:0 0 3em">Start</label><input type="datetime-local" step="0.001" data-role="start" class="epochDatetimeInput" /></div>
    <div class="epochRow"><label style="flex:0 0 3em">End</label><input type="datetime-local" step="0.001" data-role="end" class="epochDatetimeInput" /></div>
    <div class="epochRow"><button type="button" data-role="reset">Reset to full coverage</button> <span style="color:#626c80;font-size:11px">UTC</span></div>
    <div class="epochError" data-role="error"></div>`;
  const startInput = container.querySelector('[data-role=start]');
  const endInput = container.querySelector('[data-role=end]');
  const resetBtn = container.querySelector('[data-role=reset]');
  const errorEl = container.querySelector('[data-role=error]');

  function show(input, et) {
    input.value = et2utc(et, 3);
  }
  function refresh() {
    const w = getWindow();
    if (!w) {
      startInput.value = '';
      endInput.value = '';
      return;
    }
    try {
      show(startInput, w[0]);
      show(endInput, w[1]);
    } catch {
      // No leapseconds kernel yet -- leave blank.
    }
  }
  async function apply(startEt, endEt) {
    errorEl.textContent = '';
    try {
      await setWindow(startEt, endEt);
    } catch (err) {
      errorEl.textContent = err.message;
      log?.(`  -> ${err.message}`);
    }
    refresh();
  }
  function onChange() {
    if (!startInput.value || !endInput.value) return;
    try {
      apply(str2et(startInput.value), str2et(endInput.value));
    } catch (err) {
      errorEl.textContent = err.message;
    }
  }
  startInput.addEventListener('change', onChange);
  endInput.addEventListener('change', onChange);
  resetBtn.addEventListener('click', () => {
    const limits = getLimits();
    if (limits) apply(limits[0], limits[1]);
  });

  function setEnabled(enabled) {
    startInput.disabled = !enabled;
    endInput.disabled = !enabled;
    resetBtn.disabled = !enabled;
  }
  setEnabled(false);
  return { refresh, setEnabled };
}
