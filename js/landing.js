// landing.html skriptlari (server CSP: script-src 'self' — ichki <script> ishlamaydi, shuning uchun alohida faylda)
// Pinned run: the step in view decides which screen the stage shows (stays on the first without script)
(() => {
  const steps = document.querySelectorAll('.pin__step');
  const shots = document.querySelectorAll('.pin__shot');
  if (!steps.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (!e.isIntersecting) return;
    const n = e.target.dataset.step;
    shots.forEach((s) => s.classList.toggle('is-on', s.dataset.shot === n));
  }), { rootMargin: '-45% 0px -45% 0px' });
  steps.forEach((s) => io.observe(s));
})();

window.hallmarkSlots = (m) => {
  for (const [k, v] of Object.entries(m)) {
    const s = document.querySelector(`[data-slot="${k}"]`);
    if (!s) continue;
    const im = new Image();
    im.src = typeof v === 'string' ? v : v.src;
    im.alt = (typeof v === 'object' && v.alt) || s.dataset.alt || '';
    s.querySelectorAll(':scope > img').forEach((o) => o.remove());
    s.prepend(im);
  }
};
document.querySelectorAll('[data-slot] img').forEach((i) => {
  if (i.complete && !i.naturalWidth) i.remove();
  else i.addEventListener('error', () => i.remove(), { once: true });
});
