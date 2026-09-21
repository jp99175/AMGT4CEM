// A single flask: a stack of color-unit indices, bottom of array = bottom of flask.
export class Bottle {
  constructor({ capacity = 4, colors = [], isLocked = false, hiddenLayers = 0 } = {}) {
    this.capacity = capacity;
    this.colors = colors.slice();
    this.isLocked = isLocked;
    // Reserved for the future "mystery color" mechanic: number of top layers
    // whose true color is hidden ("?") until they become the topmost unit.
    this.hiddenLayers = hiddenLayers;
  }

  get length() {
    return this.colors.length;
  }

  get isEmpty() {
    return this.colors.length === 0;
  }

  get isFull() {
    return this.colors.length === this.capacity;
  }

  get topColor() {
    return this.colors.length ? this.colors[this.colors.length - 1] : null;
  }

  get isSolved() {
    if (this.isEmpty) return true;
    if (!this.isFull) return false;
    const first = this.colors[0];
    return this.colors.every((c) => c === first);
  }

  topRunLength() {
    if (this.isEmpty) return 0;
    const top = this.topColor;
    let n = 0;
    for (let i = this.colors.length - 1; i >= 0 && this.colors[i] === top; i--) n++;
    return n;
  }

  clone() {
    return new Bottle({
      capacity: this.capacity,
      colors: this.colors,
      isLocked: this.isLocked,
      hiddenLayers: this.hiddenLayers,
    });
  }
}
