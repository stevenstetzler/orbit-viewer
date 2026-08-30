/**
 * Calendar/JD text entry + datetime-local picker + UTC/TAI toggle for
 * the "Reference epoch" controls every curated page already has (a
 * `timeSlider` range input driving `updateSceneForOffset(offsetDays)`
 * off some `demo.et0` origin) -- see solar-system/index.html,
 * solar-system/trajectory/index.html, the body/body-trajectory
 * templates, and close-approach/index.html, all of which mount this
 * the same way right after their own `#timeRow`. examples/browser-demo/
 * index.html has its own copy of this exact same widget instead of
 * importing it (that file deliberately never imports from
 * examples/shared/ -- see modules.md) -- keep the two in sync by hand.
 *
 * This module only ever *reads* an epoch and hands it to the page's
 * own `setOffsetDays()` -- placing markers, rebuilding arcs, etc. all
 * stay exactly the page's own updateSceneForOffset(), unchanged. It
 * also *displays* the current epoch (kept in sync with the slider via
 * refresh()), so text/datetime/checkbox always agree with whatever
 * last moved the reference epoch, from any of the four controls.
 *
 * All time conversion here deliberately uses str2et()/et2utc()/et2tai()/
 * taiToEt()'s own default pool (the shared global one), not a page's
 * per-session `demo.remote.pool` -- every page loads its leapseconds
 * kernel via loadLeapseconds() (kernelSession.js), which itself calls
 * load() with no explicit pool, i.e. only ever into the global pool.
 * demo.remote.pool (a fresh, per-openRemoteSpk() KernelPool) never has
 * a leapseconds kernel of its own; every page's own kernelStartEt/
 * kernelStopEt/et0 computation already relies on this exact same
 * default-pool convention, so this module just matches it.
 */
import { str2et, parseTimeString, taiToEt, et2utc, et2tai } from '../../src/browser.js';

/**
 * @param {HTMLElement} container - controls are appended here
 * @param {object} options
 * @param {() => number} options.getEt0 - the fixed reference-epoch *origin* (ET) that
 *   timeSlider's offset (in days) is measured from -- used to turn a
 *   newly-entered epoch back into an offsetDays for setOffsetDays()
 * @param {() => number} options.getCurrentEt - the epoch currently shown (et0 + the
 *   slider's current offset*86400) -- used to keep the display fields in sync
 * @param {() => {min: number, max: number}} options.getOffsetBounds - current timeSlider min/max, in days from et0
 * @param {(offsetDays: number) => (void|Promise<void>)} options.setOffsetDays
 *   - apply a new epoch, expressed as an offset (days) from et0; expected
 *     to update timeSlider.value and re-run the page's own scene update
 * @param {(msg: string) => void} [options.log] - page's own log(), for parse-error reporting
 * @returns {{ refresh(): void, setEnabled(enabled: boolean): void }}
 *   call refresh() whenever the shown epoch changes elsewhere (dragging
 *   timeSlider, "Look At", loading a new kernel, ...) to keep these
 *   controls in sync; call setEnabled() alongside timeSlider.disabled
 */
export function mountEpochControls(container, { getEt0, getCurrentEt, getOffsetBounds, setOffsetDays, log }) {
  container.classList.add('epochControls');

  const textRow = document.createElement('div');
  textRow.className = 'epochRow';
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'epochTextInput';
  textInput.placeholder = 'e.g. 2024-06-15 12:00:00, JD 2460477.0';
  textInput.spellcheck = false;
  const textBtn = document.createElement('button');
  textBtn.type = 'button';
  textBtn.textContent = 'Go';
  textRow.append(textInput, textBtn);

  const datetimeRow = document.createElement('div');
  datetimeRow.className = 'epochRow';
  const datetimeInput = document.createElement('input');
  datetimeInput.type = 'datetime-local';
  datetimeInput.className = 'epochDatetimeInput';
  datetimeInput.step = '1'; // whole seconds
  datetimeRow.append(datetimeInput);

  const taiRow = document.createElement('label');
  taiRow.className = 'epochTaiRow';
  const taiCheckbox = document.createElement('input');
  taiCheckbox.type = 'checkbox';
  const taiLabelText = document.createElement('span');
  taiLabelText.textContent = 'Interpret entered times as TAI (unchecked: UTC)';
  taiRow.append(taiCheckbox, taiLabelText);

  const errorEl = document.createElement('div');
  errorEl.className = 'epochError';

  container.append(textRow, datetimeRow, taiRow, errorEl);

  function reportError(err) {
    errorEl.textContent = err.message;
    log?.(`  -> ${err.message}`);
  }

  function clearError() {
    errorEl.textContent = '';
  }

  /** Free-text (calendar or JD) -> ET, honoring an explicit " TDB"/" TDT"
   *  label in the text itself over the TAI checkbox, exactly like
   *  str2et() already does for a UTC-vs-explicit-label string. */
  function parseText(text) {
    if (!taiCheckbox.checked) return str2et(text);
    const { system, contSec } = parseTimeString(text);
    if (system === 'TDB' || system === 'TDT') return str2et(text);
    return taiToEt(contSec);
  }

  /** datetime-local's value ("YYYY-MM-DDTHH:MM:SS", never labeled) -> ET. */
  function parseDatetimeLocal(value) {
    if (!taiCheckbox.checked) return str2et(value);
    const { contSec } = parseTimeString(value);
    return taiToEt(contSec);
  }

  function applyEt(et) {
    const et0 = getEt0();
    const { min, max } = getOffsetBounds();
    const DAY = 86400;
    const offsetDays = Math.min(Math.max((et - et0) / DAY, min), max);
    clearError();
    // setOffsetDays() may be async (it re-runs the page's own
    // updateSceneForOffset()) -- catch here too, not just synchronous
    // parse errors, matching how each page's own timeSlider listener
    // already .catch()es updateSceneForOffset()'s returned promise.
    return Promise.resolve(setOffsetDays(offsetDays)).catch((err) => reportError(err));
  }

  textBtn.addEventListener('click', () => {
    try {
      applyEt(parseText(textInput.value));
    } catch (err) {
      reportError(err);
    }
  });
  textInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') textBtn.click();
  });

  datetimeInput.addEventListener('change', () => {
    if (!datetimeInput.value) return;
    try {
      applyEt(parseDatetimeLocal(datetimeInput.value));
    } catch (err) {
      reportError(err);
    }
  });

  // Toggling the timescale only changes how *new* input is interpreted
  // -- it doesn't move the reference epoch, so just re-render the
  // display fields (e.g. the datetime picker) on the new timescale.
  taiCheckbox.addEventListener('change', () => refresh());

  function refresh() {
    try {
      const et = getCurrentEt();
      datetimeInput.value = taiCheckbox.checked ? et2tai(et, 0) : et2utc(et, 0);
    } catch {
      // No session yet (getCurrentEt() has nothing to read), or no
      // leapseconds kernel loaded yet -- leave the picker blank rather
      // than throwing out of a refresh() call site.
    }
  }

  function setEnabled(enabled) {
    textInput.disabled = !enabled;
    textBtn.disabled = !enabled;
    datetimeInput.disabled = !enabled;
    taiCheckbox.disabled = !enabled;
  }

  setEnabled(false);
  refresh();
  return { refresh, setEnabled };
}
