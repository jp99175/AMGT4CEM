// Unifies two interaction models on the same bottle row:
//  - tap bottle A, then tap bottle B -> attempt pour(A, B)
//  - press on bottle A, drag, release over bottle B -> attempt pour(A, B)
// Both funnel into the same onMoveAttempt callback so game logic only has to
// handle one kind of event.
const DRAG_THRESHOLD = 10;

export function attachBottleInput(container, { onSelectChange, onMoveAttempt }) {
  let selected = null;
  let dragStart = null;
  let dragMoved = false;
  let startX = 0;
  let startY = 0;
  let lastDropTarget = null;

  function bottleIdxFromElement(el) {
    const bottleEl = el?.closest?.(".bottle");
    if (!bottleEl || bottleEl.parentElement !== container) return null;
    const idx = Number(bottleEl.dataset.idx);
    return Number.isNaN(idx) ? null : idx;
  }

  function setSelectedIdx(idx) {
    selected = idx;
    onSelectChange(idx);
  }

  function clearDropHighlight() {
    if (lastDropTarget) {
      lastDropTarget.classList.remove("drop-target");
      lastDropTarget = null;
    }
  }

  function onPointerDown(e) {
    const idx = bottleIdxFromElement(e.target);
    if (idx === null) return;
    dragStart = idx;
    dragMoved = false;
    startX = e.clientX;
    startY = e.clientY;
    container.children[idx]?.classList.add("lifted");
  }

  function onPointerMove(e) {
    if (dragStart === null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragMoved && Math.hypot(dx, dy) > DRAG_THRESHOLD) dragMoved = true;
    if (!dragMoved) return;

    const target = document.elementFromPoint(e.clientX, e.clientY);
    const idx = bottleIdxFromElement(target);
    const el = idx !== null ? container.children[idx] : null;
    if (el !== lastDropTarget) {
      clearDropHighlight();
      if (el && idx !== dragStart) {
        el.classList.add("drop-target");
        lastDropTarget = el;
      }
    }
  }

  function finishPointer(e) {
    if (dragStart === null) return;
    container.children[dragStart]?.classList.remove("lifted");
    clearDropHighlight();

    const dropTarget = e ? document.elementFromPoint(e.clientX, e.clientY) : null;
    const dropIdx = e ? bottleIdxFromElement(dropTarget) : null;

    if (!dragMoved) {
      // Simple tap: toggle selection or complete a pour with the already-selected bottle.
      if (selected === dragStart) {
        setSelectedIdx(null);
      } else if (selected === null) {
        setSelectedIdx(dragStart);
      } else {
        const from = selected;
        const to = dragStart;
        setSelectedIdx(null);
        onMoveAttempt({ from, to });
      }
    } else if (dropIdx !== null && dropIdx !== dragStart) {
      setSelectedIdx(null);
      onMoveAttempt({ from: dragStart, to: dropIdx });
    }

    dragStart = null;
    dragMoved = false;
  }

  container.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", finishPointer);
  window.addEventListener("pointercancel", () => finishPointer(null));
  container.style.touchAction = "none";

  return {
    clearSelection() {
      setSelectedIdx(null);
    },
    destroy() {
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishPointer);
    },
  };
}
