/** Annotations de photo — petit constructeur DOM : tout texte passe par textContent (jamais de HTML saisi par l'utilisateur). */
(function () {
const A = (window.AMGT4CEM_Annotate = window.AMGT4CEM_Annotate || {});

A.h = function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
};
})();
