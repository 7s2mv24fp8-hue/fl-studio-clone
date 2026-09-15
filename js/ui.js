/**
 * FL Studio Clone — UI Helpers
 * Canvas knobs, resize handles, toast notifications, context menus
 */

// ── Toast notifications ────────────────────────────────────────
function showToast(msg, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Draw canvas knob (standalone, for toolbar) ─────────────────
function drawKnob(canvas, value, min, max, color = '#ff6a00', label = '') {
  const ctx = canvas.getContext('2d');
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const r = cx - 3;

  const norm = (value - min) / (max - min);
  const startAngle = Math.PI * 0.75;
  const sweep = Math.PI * 1.5;
  const angle = startAngle + norm * sweep;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Outer rim
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a';
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Track
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, startAngle, startAngle + sweep);
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Filled arc
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, startAngle, angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.shadowColor = color;
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Dot in center
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#555';
  ctx.fill();

  // Indicator
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(
    cx + (r - 4) * Math.cos(angle),
    cy + (r - 4) * Math.sin(angle)
  );
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ── Make a canvas knob interactive ────────────────────────────
function makeInteractiveKnob(canvas, initialValue, min, max, color, onChange) {
  let value = initialValue;
  let startY, startVal;

  drawKnob(canvas, value, min, max, color);

  canvas.addEventListener('mousedown', e => {
    startY = e.clientY;
    startVal = value;
    e.preventDefault();

    const sensitivity = (max - min) / 200;

    const onMove = me => {
      const dy = startY - me.clientY;
      value = Math.max(min, Math.min(max, startVal + dy * sensitivity));
      drawKnob(canvas, value, min, max, color);
      if (onChange) onChange(value);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  canvas.addEventListener('dblclick', () => {
    value = initialValue;
    drawKnob(canvas, value, min, max, color);
    if (onChange) onChange(value);
  });

  canvas.title = `${min}–${max} (drag up/down, dblclick to reset)`;

  return {
    getValue: () => value,
    setValue: v => {
      value = Math.max(min, Math.min(max, v));
      drawKnob(canvas, value, min, max, color);
    }
  };
}

// ── BPM drag control ──────────────────────────────────────────
function makeBPMDrag(display, onBPMChange) {
  let startY, startBPM;

  display.addEventListener('mousedown', e => {
    startY = e.clientY;
    startBPM = parseInt(display.value || display.textContent, 10);
    e.preventDefault();

    const onMove = me => {
      const delta = Math.round((startY - me.clientY) * 0.5);
      const newBPM = Math.max(20, Math.min(300, startBPM + delta));
      display.value = newBPM;
      onBPMChange(newBPM);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

// ── Horizontal resize handle ──────────────────────────────────
function makeResizeHandle(handle, leftEl, rightEl, minLeft = 200, minRight = 300) {
  let dragging = false;
  let startX, startLeftW;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startLeftW = leftEl.getBoundingClientRect().width;
    e.preventDefault();
    document.body.style.cursor = 'ew-resize';
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const newW = Math.max(minLeft, startLeftW + dx);
    const parentW = handle.parentElement.getBoundingClientRect().width;
    if (parentW - newW - handle.offsetWidth < minRight) return;
    leftEl.style.width = newW + 'px';
    leftEl.style.minWidth = newW + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (dragging) {
      dragging = false;
      document.body.style.cursor = '';
    }
  });
}

// ── Context menu ──────────────────────────────────────────────
function showContextMenu(items, x, y) {
  // Remove existing
  const existing = document.querySelector('.context-menu');
  if (existing) existing.remove();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = `${x}px`;
  menu.style.top  = `${y}px`;

  items.forEach(item => {
    if (item === 'separator') {
      const sep = document.createElement('div');
      sep.className = 'context-separator';
      menu.appendChild(sep);
    } else {
      const el = document.createElement('div');
      el.className = 'context-item';
      el.textContent = item.label;
      el.addEventListener('click', () => {
        item.action();
        menu.remove();
      });
      menu.appendChild(el);
    }
  });

  document.body.appendChild(menu);

  // Auto-remove on outside click
  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 50);
}

// ── MIDI note name ────────────────────────────────────────────
function midiToName(midi) {
  const notes = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  return `${notes[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

window.showToast = showToast;
window.drawKnob = drawKnob;
window.makeInteractiveKnob = makeInteractiveKnob;
window.makeBPMDrag = makeBPMDrag;
window.makeResizeHandle = makeResizeHandle;
window.showContextMenu = showContextMenu;
window.midiToName = midiToName;
