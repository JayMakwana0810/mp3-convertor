/**
 * SoundRip — script.js
 * Handles: theme toggle, navbar scroll, mobile menu,
 *          drag-and-drop upload, simulated conversion pipeline,
 *          quality selection, toast notifications, AOS-lite, contact form.
 */

/* ── Helpers ─────────────────────────────────────── */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/* ── DOM refs ────────────────────────────────────── */
const navbar       = $('#navbar');
const hamburger    = $('#hamburger');
const navLinks     = $('#navLinks');
const themeToggle  = $('#themeToggle');
const themeIcon    = $('#themeIcon');

const dropZone     = $('#dropZone');
const fileInput    = $('#fileInput');
const dropContent  = $('#dropContent');
const fileSelected = $('#fileSelected');
const fileNameEl   = $('#fileName');
const fileSizeEl   = $('#fileSize');
const removeFileBtn= $('#removeFile');
const qualityRow   = $('#qualityRow');
const convertBtn   = $('#convertBtn');
const progressWrap = $('#progressWrap');
const progressFill = $('#progressFill');
const progressPct  = $('#progressPct');
const progressLabel= $('#progressLabel');
const progressStatus=$('#progressStatus');
const downloadWrap = $('#downloadWrap');
const audioPreview = $('#audioPreview');
const downloadBtn  = $('#downloadBtn');
const resetBtn     = $('#resetBtn');

/* ── State ───────────────────────────────────────── */
let selectedFile   = null;
let selectedQuality= 128;
let convertedBlobUrl = null;

/* ══════════════════════════════════════════════════
   THEME TOGGLE
══════════════════════════════════════════════════ */
const applyTheme = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
  themeIcon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
  localStorage.setItem('sr-theme', theme);
};

// Load saved theme
applyTheme(localStorage.getItem('sr-theme') || 'dark');

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
  toast('info', current === 'dark' ? '☀️ Light mode on' : '🌙 Dark mode on');
});

/* ══════════════════════════════════════════════════
   NAVBAR — scroll shadow + active link
══════════════════════════════════════════════════ */
const updateNavbar = () => {
  navbar.classList.toggle('scrolled', window.scrollY > 40);

  // highlight active section
  const sections = $$('section[id]');
  const scrollMid = window.scrollY + window.innerHeight / 2;
  sections.forEach(sec => {
    const link = $(`.nav-link[href="#${sec.id}"]`);
    if (!link) return;
    const top = sec.offsetTop;
    const bot = top + sec.offsetHeight;
    link.classList.toggle('active', scrollMid >= top && scrollMid < bot);
  });
};
window.addEventListener('scroll', updateNavbar, { passive: true });
updateNavbar();

/* ══════════════════════════════════════════════════
   HAMBURGER MENU
══════════════════════════════════════════════════ */
hamburger.addEventListener('click', () => {
  hamburger.classList.toggle('open');
  navLinks.classList.toggle('open');
});
// Close on link click
$$('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    hamburger.classList.remove('open');
    navLinks.classList.remove('open');
  });
});

/* ══════════════════════════════════════════════════
   SMOOTH-SCROLL (fallback for older browsers)
══════════════════════════════════════════════════ */
document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="#"]');
  if (!link) return;
  const target = $(link.getAttribute('href'));
  if (target) {
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth' });
  }
});

/* ══════════════════════════════════════════════════
   FILE HANDLING — validation, selection, removal
══════════════════════════════════════════════════ */
const ALLOWED_TYPES = [
  'video/mp4','video/avi','video/x-msvideo','video/x-matroska',
  'video/quicktime','video/x-ms-wmv','video/x-flv','video/webm'
];
const MAX_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

const formatBytes = (bytes) => {
  if (bytes < 1024)       return `${bytes} B`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

const handleFile = (file) => {
  // Extension fallback (browser may report generic type for some extensions)
  const ext = file.name.split('.').pop().toLowerCase();
  const validExts = ['mp4','avi','mkv','mov','wmv','flv','webm','m4v','3gp'];

  if (!ALLOWED_TYPES.includes(file.type) && !validExts.includes(ext)) {
    toast('error', '❌ Unsupported file type. Please upload a video file.');
    return;
  }
  if (file.size > MAX_SIZE_BYTES) {
    toast('error', `❌ File too large (${formatBytes(file.size)}). Max 500 MB.`);
    return;
  }

  selectedFile = file;

  // Update UI
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent  = formatBytes(file.size);
  dropContent.style.display  = 'none';
  fileSelected.style.display = 'flex';
  qualityRow.style.display   = 'flex';
  convertBtn.disabled        = false;

  toast('success', `✅ "${file.name}" selected!`);
};

// File input change
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

// Remove file
removeFileBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  resetToInitial();
});

function resetToInitial() {
  selectedFile = null;
  fileInput.value = '';
  dropContent.style.display  = 'flex';
  fileSelected.style.display = 'none';
  qualityRow.style.display   = 'none';
  convertBtn.disabled        = true;
  progressWrap.style.display = 'none';
  downloadWrap.style.display = 'none';
  progressFill.style.width   = '0%';
  if (convertedBlobUrl) {
    URL.revokeObjectURL(convertedBlobUrl);
    convertedBlobUrl = null;
  }
}

/* ── Drag & Drop ─────────────────────────────────── */
['dragenter','dragover'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
});
['dragleave','drop'].forEach(evt => {
  dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
  });
});
dropZone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
dropZone.addEventListener('click', (e) => {
  // Only open picker if clicking the drop zone itself (not the remove button)
  if (e.target.closest('.remove-file') || e.target.closest('.btn-outline')) return;
  if (!selectedFile) fileInput.click();
});

/* ══════════════════════════════════════════════════
   QUALITY PILLS
══════════════════════════════════════════════════ */
$$('.pill').forEach(pill => {
  pill.addEventListener('click', () => {
    $$('.pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    selectedQuality = parseInt(pill.dataset.q, 10);
  });
});

/* ══════════════════════════════════════════════════
   CONVERSION — simulated pipeline
   In production this would POST to the Java backend.
══════════════════════════════════════════════════ */
convertBtn.addEventListener('click', startConversion);

async function startConversion() {
  if (!selectedFile) return;

  // Show progress, hide convert button
  convertBtn.disabled        = true;
  progressWrap.style.display = 'flex';
  downloadWrap.style.display = 'none';

  const steps = [
    { label:'Uploading file…',         pct: 20, status:'Uploading file…' },
    { label:'Analysing video stream…', pct: 40, status:'Analysing video stream…' },
    { label:'Extracting audio…',       pct: 65, status:'Extracting audio track…' },
    { label:'Encoding MP3…',           pct: 85, status:`Encoding at ${selectedQuality} kbps…` },
    { label:'Finalising…',             pct:100, status:'Finalising output…' },
  ];

  for (const step of steps) {
    await animateProgress(step.pct);
    progressLabel.textContent  = step.label;
    progressStatus.textContent = step.status;
    await delay(600 + Math.random() * 500);
  }

  // ── Real backend call would go here ──────────────
  // const formData = new FormData();
  // formData.append('file', selectedFile);
  // formData.append('quality', selectedQuality);
  // const response = await fetch('/api/convert', { method:'POST', body:formData });
  // const blob = await response.blob();
  // convertedBlobUrl = URL.createObjectURL(blob);
  // ─────────────────────────────────────────────────

  // Simulate: create a silent audio blob for demo purposes
  convertedBlobUrl = createSilentAudioBlob();

  showDownload();
}

function animateProgress(targetPct) {
  return new Promise(resolve => {
    const current = parseFloat(progressFill.style.width) || 0;
    const step = (targetPct - current) / 20;
    let val = current;
    const interval = setInterval(() => {
      val = Math.min(val + step, targetPct);
      progressFill.style.width = val + '%';
      progressPct.textContent  = Math.round(val) + '%';
      if (val >= targetPct) { clearInterval(interval); resolve(); }
    }, 30);
  });
}

function showDownload() {
  progressWrap.style.display = 'none';
  downloadWrap.style.display = 'flex';

  // Set audio preview src
  audioPreview.src = convertedBlobUrl;

  // Download button
  const mp3Name = selectedFile.name.replace(/\.[^.]+$/, '') + '.mp3';
  downloadBtn.onclick = () => {
    const a = document.createElement('a');
    a.href = convertedBlobUrl;
    a.download = mp3Name;
    a.click();
    toast('success', `⬇️ Downloading "${mp3Name}"`);
  };

  toast('success', '🎵 Conversion complete! Your MP3 is ready.');
}

/* ── Reset button ────────────────────────────────── */
resetBtn.addEventListener('click', () => {
  resetToInitial();
  toast('info', '🔄 Ready for another conversion!');
});

/* ── Helper: delay ───────────────────────────────── */
const delay = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Creates a minimal silent WAV/MP3-like blob for demo preview.
 * In production the real MP3 binary comes from the server.
 */
function createSilentAudioBlob() {
  // 1-second silent WAV (44 bytes header + 88200 bytes of zeros for 1s stereo 44100Hz)
  const sampleRate = 44100;
  const numChannels = 2;
  const bitsPerSample = 16;
  const dataLength = sampleRate * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bitsPerSample / 8, true);
  view.setUint16(32, numChannels * bitsPerSample / 8, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLength, true);
  // data is already zeroed → silent

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

/* ══════════════════════════════════════════════════
   TOAST NOTIFICATIONS
══════════════════════════════════════════════════ */
const toastContainer = $('#toastContainer');

const toastIcons = {
  success: 'fa-check-circle',
  error:   'fa-times-circle',
  info:    'fa-info-circle',
};

function toast(type, message, duration = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fas ${toastIcons[type] || 'fa-info-circle'}"></i><span>${message}</span>`;
  toastContainer.appendChild(el);

  setTimeout(() => {
    el.classList.add('exit');
    el.addEventListener('animationend', () => el.remove());
  }, duration);
}

/* ══════════════════════════════════════════════════
   AOS-LITE — Intersection Observer fade-in
══════════════════════════════════════════════════ */
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('aos-visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

$$('[data-aos]').forEach(el => observer.observe(el));

/* ══════════════════════════════════════════════════
   CONTACT FORM — simulated submit
══════════════════════════════════════════════════ */
window.handleContact = (e) => {
  e.preventDefault();
  const btn = e.currentTarget;

  // Basic validation
  const inputs = $$('.form-input');
  let valid = true;
  inputs.forEach(inp => {
    if (!inp.value.trim()) {
      inp.style.borderColor = '#ff4d6d';
      valid = false;
    } else {
      inp.style.borderColor = '';
    }
  });

  if (!valid) {
    toast('error', '⚠️ Please fill in all fields.');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:16px;height:16px;margin:0"></div> Sending…';

  // Simulate async send
  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Message';
    inputs.forEach(inp => inp.value = '');
    toast('success', '✅ Message sent! We\'ll reply within 24 hours.');
  }, 2000);
};

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
console.log('%c🎵 SoundRip', 'font-size:1.5rem;font-weight:bold;color:#b06aff');
console.log('%cFrontend ready. Backend endpoint: POST /api/convert', 'color:#9d8fc2');
