import { getCredits } from './credits.js';

// "About" card with the author credits, opened from the info button next to the language switch.
// It replaces the start or pause card while open and brings that card back when closed.
// The name and the e-mail address are drawn into PNG images at the screen's pixel density,
// so they never appear as text in the page source or the DOM.

const SHADOW = 'rgba(0, 0, 0, 0.4)';
const drawn = new WeakMap(); // image -> settings it was last drawn with

// Draws text as a PNG styled by the CSS of the image's parent: font, size, weight and color,
// so media queries keep working. Sharp on any screen: the bitmap matches devicePixelRatio.
function drawText(img, text) {
  const css = getComputedStyle(img.parentElement);
  const size = parseFloat(css.fontSize);
  const font = `${css.fontWeight} ${size}px ${css.fontFamily}`;
  const ratio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 4);
  const settings = `${font}|${css.color}|${ratio}`;
  if (drawn.get(img) === settings) return;
  drawn.set(img, settings);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  const pad = Math.ceil(size * 0.15); // room for the shadow and overhanging glyphs
  const width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const height = Math.ceil(size * 1.3) + pad;
  canvas.width = Math.ceil(width * ratio);
  canvas.height = Math.ceil(height * ratio);
  // resizing the canvas resets the context, so styles are set again
  ctx.scale(ratio, ratio);
  ctx.font = font;
  ctx.fillStyle = css.color;
  ctx.textBaseline = 'middle';
  // shadow sizes ignore the scale, so they are given in device pixels
  ctx.shadowColor = SHADOW;
  ctx.shadowOffsetY = ratio;
  ctx.shadowBlur = 2 * ratio;
  ctx.fillText(text, pad, height / 2);
  img.src = canvas.toDataURL('image/png');
  img.style.width = `${width}px`;
  img.style.height = `${height}px`;
}

export function setupAbout() {
  const overlay = document.getElementById('about');
  const button = document.getElementById('about-btn');
  const back = document.getElementById('about-close');
  const nameImg = document.getElementById('about-name');
  const mailImg = document.getElementById('about-mail');

  let covered = null;
  const isOpen = () => !overlay.classList.contains('hidden');

  function render() {
    if (!isOpen()) return;
    const { name, mail } = getCredits();
    drawText(nameImg, name);
    drawText(mailImg, mail);
  }

  // a new pixel density (browser zoom, another monitor) needs sharper or smaller images
  let densityQuery = null;
  function watchDensity() {
    densityQuery?.removeEventListener('change', onDensity);
    densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    densityQuery.addEventListener('change', onDensity);
  }
  function onDensity() {
    watchDensity();
    render();
  }
  watchDensity();
  // a resize can switch the card to its compact layout with smaller fonts
  window.addEventListener('resize', render);

  function open() {
    if (isOpen()) return;
    covered = [...document.querySelectorAll('#start, #pause')].find((el) => !el.classList.contains('hidden')) ?? null;
    covered?.classList.add('hidden');
    overlay.classList.remove('hidden');
    button.setAttribute('aria-expanded', 'true');
    render();
    back.focus();
  }

  function close(restore = true) {
    if (!isOpen()) return;
    overlay.classList.add('hidden');
    button.setAttribute('aria-expanded', 'false');
    if (restore && covered) {
      covered.classList.remove('hidden');
      // the primary button again, so Enter keeps starting or resuming the drive
      covered.querySelector('.btn')?.focus();
    }
    covered = null;
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isOpen()) close();
    else open();
  });
  back.addEventListener('click', () => close());
  // a click on the dimmed background outside the card closes it too
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  return {
    isOpen,
    close: () => close(),
    // only on the start and pause screens, never over the running game
    setAvailable(available) {
      button.classList.toggle('hidden', !available);
      // the game has moved on, so the covered card stays as the game left it
      if (!available) close(false);
    },
  };
}
