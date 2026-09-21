import { Bottle } from "./bottle.js";
import { canPour, pour, undoPour, checkVictory, findHint } from "./puzzle.js";
import { buildLevel, randomSeed, CURATED_LEVELS } from "./levels.js";
import { loadProgress, saveProgress } from "./storage.js";
import { audio } from "./audio.js";
import { renderAll, setSelected, clearHint, showHint, shakeInvalid, animatePour, spawnConfetti } from "./render.js";
import { attachBottleInput } from "./input.js";

const ADD_BOTTLE_COST = 10;
const WIN_COINS = 10;

const els = {
  bottleRow: document.getElementById("bottleRow"),
  tutorialBanner: document.getElementById("tutorialBanner"),
  levelValue: document.getElementById("levelValue"),
  coinValue: document.getElementById("coinValue"),
  undoBtn: document.getElementById("undoBtn"),
  restartBtn: document.getElementById("restartBtn"),
  hintBtn: document.getElementById("hintBtn"),
  addBottleBtn: document.getElementById("addBottleBtn"),
  addBottleCost: document.getElementById("addBottleCost"),
  toast: document.getElementById("toast"),
  winPanel: document.getElementById("winPanel"),
  winSubtitle: document.getElementById("winSubtitle"),
  winCoins: document.getElementById("winCoins"),
  nextLevelBtn: document.getElementById("nextLevelBtn"),
  levelsBtn: document.getElementById("levelsBtn"),
  levelSelectPanel: document.getElementById("levelSelectPanel"),
  closeLevelsBtn: document.getElementById("closeLevelsBtn"),
  levelGrid: document.getElementById("levelGrid"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsPanel: document.getElementById("settingsPanel"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  musicToggle: document.getElementById("musicToggle"),
  sfxToggle: document.getElementById("sfxToggle"),
  resetProgressBtn: document.getElementById("resetProgressBtn"),
  confirmResetPanel: document.getElementById("confirmResetPanel"),
  cancelResetBtn: document.getElementById("cancelResetBtn"),
  confirmResetBtn: document.getElementById("confirmResetBtn"),
};

const progress = loadProgress();
audio.musicEnabled = progress.settings.music;
audio.sfxEnabled = progress.settings.sfx;
els.musicToggle.checked = progress.settings.music;
els.sfxToggle.checked = progress.settings.sfx;
els.addBottleCost.textContent = `${ADD_BOTTLE_COST}◆`;

let currentLevelId = Math.max(1, progress.currentLevel || 1);
let bottles = [];
let history = [];
let inputLocked = false;
let addedBottleThisLevel = false;
let tutorialStep = null; // null | 'select' | 'pour' | 'group'
let toastTimer = null;

// Each level is randomly generated (see src/levels.js), so the exact same
// puzzle only needs to reappear for the level currently in progress -- to
// survive a page reload and to make Restart restore the right layout. The
// moment the player moves to a different level, a brand new seed is drawn.
function ensureSeedFor(id) {
  if (progress.activeLevelId === id && progress.activeSeed !== null) {
    return progress.activeSeed;
  }
  progress.activeLevelId = id;
  progress.activeSeed = randomSeed();
  saveProgress(progress);
  return progress.activeSeed;
}

const inputCtrl = attachBottleInput(els.bottleRow, {
  onSelectChange(idx) {
    setSelected(els.bottleRow, idx);
    if (idx !== null) {
      audio.select();
      if (tutorialStep === "select") advanceTutorial("pour");
    }
  },
  onMoveAttempt({ from, to }) {
    attemptMove(from, to);
  },
});

function startLevel(id) {
  currentLevelId = Math.max(1, id);
  const seed = ensureSeedFor(currentLevelId);
  bottles = buildLevel(currentLevelId, seed);
  history = [];
  addedBottleThisLevel = false;
  inputLocked = false;
  renderAll(els.bottleRow, bottles);
  clearHint(els.bottleRow);
  inputCtrl.clearSelection();
  updateTopbar();
  updateActionButtons();
  maybeStartTutorial();
}

function attemptMove(from, to) {
  if (inputLocked) return;
  if (!canPour(bottles, from, to)) {
    shakeInvalid(els.bottleRow, from);
    audio.invalid();
    return;
  }
  inputLocked = true;
  clearHint(els.bottleRow);
  const move = pour(bottles, from, to);
  history.push(move);
  audio.pour();
  updateActionButtons();

  animatePour(els.bottleRow, bottles, move).then(() => {
    renderAll(els.bottleRow, bottles);
    inputLocked = false;
    updateActionButtons();

    if (tutorialStep === "pour") advanceTutorial("group");

    if (checkVictory(bottles)) {
      handleVictory();
    }
  });
}

function undo() {
  if (inputLocked || history.length === 0) return;
  const move = history.pop();
  undoPour(bottles, move);
  renderAll(els.bottleRow, bottles);
  clearHint(els.bottleRow);
  inputCtrl.clearSelection();
  audio.select();
  updateActionButtons();
}

function restart() {
  if (inputLocked) return;
  // Same seed as the in-progress instance -- restart must reproduce the
  // exact layout the player started with, not draw a new puzzle.
  bottles = buildLevel(currentLevelId, progress.activeSeed);
  history = [];
  addedBottleThisLevel = false;
  renderAll(els.bottleRow, bottles);
  clearHint(els.bottleRow);
  inputCtrl.clearSelection();
  updateActionButtons();
}

function hint() {
  if (inputLocked) return;
  const move = findHint(bottles);
  if (!move) {
    showToast("Aucun coup disponible.");
    return;
  }
  showHint(els.bottleRow, move);
}

function addBottle() {
  if (inputLocked || addedBottleThisLevel) return;
  if (progress.coins < ADD_BOTTLE_COST) {
    showToast(`Il te faut ${ADD_BOTTLE_COST}◆ pour ajouter une fiole.`);
    audio.invalid();
    return;
  }
  progress.coins -= ADD_BOTTLE_COST;
  addedBottleThisLevel = true;
  const capacity = bottles[0]?.capacity ?? 4;
  bottles.push(new Bottle({ capacity, colors: [] }));
  saveProgress(progress);
  renderAll(els.bottleRow, bottles);
  updateTopbar();
  updateActionButtons();
  audio.select();
}

function handleVictory() {
  const firstClear = !progress.completedLevels.includes(currentLevelId);
  if (firstClear) {
    progress.completedLevels.push(currentLevelId);
    progress.coins += WIN_COINS;
  }
  progress.currentLevel = Math.max(progress.currentLevel, currentLevelId + 1);
  saveProgress(progress);

  audio.victory();
  spawnConfetti(document.body);
  if (navigator.vibrate) navigator.vibrate(60);

  els.winCoins.textContent = firstClear ? String(WIN_COINS) : "0";
  els.winSubtitle.textContent =
    currentLevelId === CURATED_LEVELS
      ? "Bravo, tu passes en mode expert : la difficulté continue de grimper !"
      : "Toutes les couleurs sont triées.";
  els.nextLevelBtn.textContent = "Niveau suivant →";
  els.winPanel.classList.remove("hidden");
  updateTopbar();

  if (currentLevelId === 1 && !progress.tutorialSeen) {
    progress.tutorialSeen = true;
    saveProgress(progress);
  }
}

function updateTopbar() {
  els.levelValue.textContent = String(currentLevelId);
  els.coinValue.textContent = String(progress.coins);
}

function updateActionButtons() {
  els.undoBtn.disabled = inputLocked || history.length === 0;
  els.restartBtn.disabled = inputLocked;
  els.hintBtn.disabled = inputLocked;
  els.addBottleBtn.disabled = inputLocked || addedBottleThisLevel || progress.coins < ADD_BOTTLE_COST;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove("hidden");
  requestAnimationFrame(() => els.toast.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.classList.remove("show");
    setTimeout(() => els.toast.classList.add("hidden"), 200);
  }, 2200);
}

/* ---------- Tutorial (level 1 only, shown once) ---------- */

function maybeStartTutorial() {
  if (currentLevelId !== 1 || progress.tutorialSeen) {
    tutorialStep = null;
    els.tutorialBanner.classList.add("hidden");
    return;
  }
  advanceTutorial("select");
}

function advanceTutorial(step) {
  tutorialStep = step;
  const messages = {
    select: "Sélectionne une bouteille.",
    pour: "Verse sur une bouteille de la même couleur.",
    group: "Regroupe toutes les couleurs pour gagner !",
  };
  if (!messages[step]) {
    els.tutorialBanner.classList.add("hidden");
    return;
  }
  els.tutorialBanner.textContent = messages[step];
  els.tutorialBanner.classList.remove("hidden");
  if (step === "group") {
    setTimeout(() => {
      if (tutorialStep === "group") els.tutorialBanner.classList.add("hidden");
    }, 3200);
  }
}

/* ---------- Level select panel ---------- */

function buildLevelGrid() {
  els.levelGrid.innerHTML = "";
  // Grid always shows the curated milestones, and grows to cover however
  // far the player has actually progressed (levels beyond 20 are endless).
  const gridSize = Math.max(CURATED_LEVELS, progress.currentLevel);
  for (let id = 1; id <= gridSize; id++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "level-cell";
    btn.textContent = String(id);
    const isLocked = id > progress.currentLevel;
    if (progress.completedLevels.includes(id)) btn.classList.add("done");
    if (id === currentLevelId) btn.classList.add("current");
    if (isLocked) {
      btn.classList.add("locked");
      btn.disabled = true;
    } else {
      btn.addEventListener("click", () => {
        startLevel(id);
        els.levelSelectPanel.classList.add("hidden");
      });
    }
    els.levelGrid.appendChild(btn);
  }
}

/* ---------- Wiring ---------- */

els.undoBtn.addEventListener("click", undo);
els.restartBtn.addEventListener("click", restart);
els.hintBtn.addEventListener("click", hint);
els.addBottleBtn.addEventListener("click", addBottle);

els.nextLevelBtn.addEventListener("click", () => {
  els.winPanel.classList.add("hidden");
  startLevel(currentLevelId + 1);
});

els.levelsBtn.addEventListener("click", () => {
  buildLevelGrid();
  els.levelSelectPanel.classList.remove("hidden");
});
els.closeLevelsBtn.addEventListener("click", () => els.levelSelectPanel.classList.add("hidden"));
els.levelSelectPanel.addEventListener("click", (e) => {
  if (e.target === els.levelSelectPanel) els.levelSelectPanel.classList.add("hidden");
});

els.settingsBtn.addEventListener("click", () => els.settingsPanel.classList.remove("hidden"));
els.closeSettingsBtn.addEventListener("click", () => els.settingsPanel.classList.add("hidden"));
els.settingsPanel.addEventListener("click", (e) => {
  if (e.target === els.settingsPanel) els.settingsPanel.classList.add("hidden");
});

els.musicToggle.addEventListener("change", () => {
  progress.settings.music = els.musicToggle.checked;
  audio.musicEnabled = progress.settings.music;
  saveProgress(progress);
});
els.sfxToggle.addEventListener("change", () => {
  progress.settings.sfx = els.sfxToggle.checked;
  audio.sfxEnabled = progress.settings.sfx;
  saveProgress(progress);
});
// A native `confirm()` dialog is unreliable here (sandboxed embeds, such as
// a published Artifact iframe, commonly block it outright), so the
// confirmation is a normal in-page panel instead.
els.resetProgressBtn.addEventListener("click", () => {
  els.settingsPanel.classList.add("hidden");
  els.confirmResetPanel.classList.remove("hidden");
});
els.cancelResetBtn.addEventListener("click", () => {
  els.confirmResetPanel.classList.add("hidden");
});
els.confirmResetPanel.addEventListener("click", (e) => {
  if (e.target === els.confirmResetPanel) els.confirmResetPanel.classList.add("hidden");
});
els.confirmResetBtn.addEventListener("click", () => {
  localStorage.removeItem("chromix.save.v1");
  window.location.reload();
});

window.addEventListener(
  "pointerdown",
  () => {
    audio.unlock();
  },
  { once: true }
);

startLevel(currentLevelId);
