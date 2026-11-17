// 点一下仍可键盘输入；按住数字左右拖动调整，一次拖动对应一次撤销。
export function installNumberScrub(panel, hooks) {
    let drag = null;
    panel.addEventListener('pointerdown', event => {
        let input = event.target;
        if (event.button !== 0 || event.isPrimary === false || input.type !== 'number' || !input.dataset.key) return;
        const key = input.dataset.key;
        // 避免点击另一个输入框时 blur/change 重绘面板，先提交原输入框。
        if (document.activeElement !== input && document.activeElement?.dataset.key) document.activeElement.blur();
        if (!input.isConnected) {
            input = panel.querySelector(`input[data-key="${key}"]`);
            if (!input) return;
            event.preventDefault(); input.focus();
        }
        drag = { input, id: event.pointerId, key: input.dataset.key, x: event.clientX,
            start: Number(input.value || 0), value: Number(input.value || 0), step: Number(input.step) || 1, started: false };
        panel.setPointerCapture(event.pointerId);
    });
    panel.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        const dx = event.clientX - drag.x;
        if (!drag.started && Math.abs(dx) < 4) return;
        event.preventDefault();
        if (!drag.started) { hooks.begin(); drag.started = true; drag.input.classList.add('scrubbing'); }
        const sensitivity = event.shiftKey ? .1 : event.ctrlKey ? 10 : 1;
        let value = drag.start + Math.round(dx / 6 * sensitivity) * drag.step;
        const [min, max] = hooks.bounds(drag.key, drag.input);
        value = +Math.max(min, Math.min(max, value)).toFixed(6);
        drag.input.value = String(value); drag.value = value;
        hooks.change(drag.key, value);
    });
    const end = event => {
        if (!drag || (event && drag.id !== event.pointerId)) return;
        const done = drag; drag = null;
        done.input.classList.remove('scrubbing');
        if (panel.hasPointerCapture(done.id)) panel.releasePointerCapture(done.id);
        if (done.started) hooks.end(done.key, event?.type === 'pointercancel' || done.value === done.start);
    };
    panel.addEventListener('pointerup', end);
    panel.addEventListener('pointercancel', end);
    panel.addEventListener('lostpointercapture', end);
    // 拖动时由此模块负责提交，避免 input blur/change 重复写入撤销栈。
    panel.addEventListener('change', event => { if (drag?.started) { event.stopImmediatePropagation(); end(); } }, true);
    return { active: () => !!drag };
}
