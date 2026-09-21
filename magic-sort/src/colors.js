// Vivid, distinguishable palette (also sane under common color-blindness
// types -- spread across hue, and varied in lightness rather than hue alone).
export const PALETTE = [
  { name: "Corail", base: "#ff5470", light: "#ff8aa0" },
  { name: "Lagon", base: "#00c2d1", light: "#5ce1ea" },
  { name: "Citron", base: "#ffd23f", light: "#ffe27a" },
  { name: "Prune", base: "#8c54ff", light: "#b28aff" },
  { name: "Menthe", base: "#26d07c", light: "#6fe8ab" },
  { name: "Mandarine", base: "#ff9224", light: "#ffb266" },
  { name: "Myrtille", base: "#3a6df0", light: "#7fa2ff" },
  { name: "Rose", base: "#ff6fd8", light: "#ffa3e8" },
  { name: "Olive", base: "#a3c22c", light: "#c3dd6a" },
  { name: "Vermillon", base: "#e83f3f", light: "#f07d7d" },
  { name: "Turquoise", base: "#1fc9a8", light: "#6cdfc7" },
  { name: "Indigo", base: "#4b3fd6", light: "#8a80ea" },
  { name: "Sable", base: "#d6a24c", light: "#e6c188" },
  { name: "Fuchsia", base: "#d63fc0", light: "#e880d8" },
];

export function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}
