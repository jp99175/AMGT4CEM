import { colorFor, PALETTE } from "./colors.js";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createBottleElement(bottle, idx) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "bottle";
  el.dataset.idx = String(idx);
  el.setAttribute("aria-label", `Fiole ${idx + 1}`);

  const neck = document.createElement("div");
  neck.className = "bottle__neck";

  const cap = document.createElement("div");
  cap.className = "bottle__cap";
  neck.appendChild(cap);

  const glass = document.createElement("div");
  glass.className = "bottle__glass";

  const stack = document.createElement("div");
  stack.className = "bottle__stack";
  for (let i = 0; i < bottle.capacity; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    stack.appendChild(cell);
  }

  const shine = document.createElement("div");
  shine.className = "bottle__shine";

  glass.appendChild(stack);
  glass.appendChild(shine);
  el.appendChild(neck);
  el.appendChild(glass);

  return el;
}

function renderBottleFill(bottleEl, bottle) {
  const cells = bottleEl.querySelectorAll(".cell");
  for (let i = 0; i < bottle.capacity; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const colorIdx = bottle.colors[i];
    if (colorIdx === undefined) {
      cell.classList.remove("filled");
      cell.style.removeProperty("--cell-color");
      cell.style.removeProperty("--cell-color-light");
    } else {
      cell.classList.add("filled");
      const c = colorFor(colorIdx);
      cell.style.setProperty("--cell-color", c.base);
      cell.style.setProperty("--cell-color-light", c.light);
    }
  }
}

export function renderAll(container, bottles) {
  while (container.children.length < bottles.length) {
    const idx = container.children.length;
    const el = createBottleElement(bottles[idx], idx);
    container.appendChild(el);
  }
  while (container.children.length > bottles.length) {
    container.removeChild(container.lastChild);
  }
  [...container.children].forEach((el, idx) => {
    const bottle = bottles[idx];
    el.dataset.idx = String(idx);
    el.classList.toggle("locked", !!bottle.isLocked);
    el.classList.toggle("solved", bottle.isSolved && !bottle.isEmpty);
    renderBottleFill(el, bottle);
  });
  container.style.setProperty("--bottle-count", bottles.length);
}

export function setSelected(container, idx) {
  [...container.children].forEach((el, i) => el.classList.toggle("selected", i === idx));
}

export function clearHint(container) {
  [...container.children].forEach((el) => el.classList.remove("hint-src", "hint-dst"));
}

export function showHint(container, move) {
  clearHint(container);
  if (!move) return;
  container.children[move.from]?.classList.add("hint-src");
  setTimeout(() => {
    container.children[move.to]?.classList.add("hint-dst");
  }, 550);
}

export function shakeInvalid(container, idx) {
  const el = container.children[idx];
  if (!el) return;
  el.classList.remove("shake");
  // eslint-disable-next-line no-unused-expressions
  void el.offsetWidth;
  el.classList.add("shake");
  setTimeout(() => el.classList.remove("shake"), 400);
}

// A brief "pop" on the cap the moment a bottle becomes solved, so completing
// one reads as a small reward rather than a silent state change.
export function celebrateCap(container, idx) {
  const el = container.children[idx];
  if (!el) return;
  const cap = el.querySelector(".bottle__cap");
  if (!cap) return;
  cap.classList.remove("cap-pop");
  // eslint-disable-next-line no-unused-expressions
  void cap.offsetWidth;
  cap.classList.add("cap-pop");
  setTimeout(() => cap.classList.remove("cap-pop"), 500);
}

// Tilts the source bottle, then updates both bottles' liquid columns so the
// CSS transitions on `.cell` read as liquid rising/falling between flasks.
export async function animatePour(container, bottles, move) {
  const srcEl = container.children[move.from];
  const dstEl = container.children[move.to];
  if (!srcEl || !dstEl) return;

  const srcRect = srcEl.getBoundingClientRect();
  const dstRect = dstEl.getBoundingClientRect();
  const tiltDir = dstRect.left + dstRect.width / 2 >= srcRect.left + srcRect.width / 2 ? 1 : -1;

  srcEl.style.setProperty("--tilt", `${tiltDir * -34}deg`);
  srcEl.classList.add("pouring");

  await wait(240);
  renderBottleFill(dstEl, bottles[move.to]);
  renderBottleFill(srcEl, bottles[move.from]);
  await wait(300);

  srcEl.classList.remove("pouring");
  srcEl.style.removeProperty("--tilt");
}

export function spawnConfetti(root, count = 90) {
  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  root.appendChild(layer);
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    const c = colorFor(Math.floor(Math.random() * PALETTE.length));
    piece.style.setProperty("--c", c.base);
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
    piece.style.animationDuration = `${(1.6 + Math.random() * 1.2).toFixed(2)}s`;
    piece.style.setProperty("--drift", `${((Math.random() - 0.5) * 160).toFixed(0)}px`);
    piece.style.setProperty("--rot", `${((Math.random() - 0.5) * 720).toFixed(0)}deg`);
    layer.appendChild(piece);
  }
  setTimeout(() => layer.remove(), 3200);
}
