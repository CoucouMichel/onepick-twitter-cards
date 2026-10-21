// tools/twitter-cards/color.js — Couleur dominante d'un maillot, chargé par les gabarits HTML (script classique).
// Même algorithme que mcExtractColor (src/js/views/matchCompare.js) : teinte dominante parmi les pixels
// SATURÉS (blanc, noir et gris ignorés : ce sont les « non-couleurs » d'un maillot), repli gris ardoise.
// Retourne { hex, hue } (hue = null si le maillot n'a pas de teinte). Pas de cache : une image par carte.
(function () {
    const NEUTRAL = '#64748b';
    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
        if (d === 0) return [0, 0, l];
        const sat = d / (1 - Math.abs(2 * l - 1));
        const h = max === r ? ((g - b) / d) % 6 : (max === g ? (b - r) / d + 2 : (r - g) / d + 4);
        return [(h * 60 + 360) % 360, sat, l];
    }
    function hslToHex(h, sat, l) {
        const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
        const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
    }
    function extractColor(src) {
        return new Promise((resolve) => {
            if (!src) return resolve({ hex: NEUTRAL, hue: null });
            const img = new Image();
            img.onload = () => {
                try {
                    const N = 40, cv = document.createElement('canvas');
                    cv.width = cv.height = N;
                    const ctx = cv.getContext('2d', { willReadFrequently: true });
                    ctx.drawImage(img, 0, 0, N, N);
                    const px = ctx.getImageData(0, 0, N, N).data;
                    const bins = Array.from({ length: 24 }, () => ({ w: 0, sx: 0, sy: 0 }));
                    for (let i = 0; i < px.length; i += 4) {
                        if (px[i + 3] < 200) continue;
                        const [h, sat, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
                        if (sat < 0.3 || l < 0.14 || l > 0.88) continue;
                        const b = bins[Math.floor(h / 15) % 24], a = h * Math.PI / 180;
                        b.w += sat; b.sx += Math.cos(a) * sat; b.sy += Math.sin(a) * sat;
                    }
                    let best = -1, bestW = 0;
                    bins.forEach((b, i) => {
                        const w = b.w + 0.5 * (bins[(i + 23) % 24].w + bins[(i + 1) % 24].w);
                        if (w > bestW) { bestW = w; best = i; }
                    });
                    if (best < 0 || bestW < 6) return resolve({ hex: NEUTRAL, hue: null });
                    const b = bins[best];
                    const hue = (Math.atan2(b.sy, b.sx) * 180 / Math.PI + 360) % 360;
                    resolve({ hex: hslToHex(hue, 0.68, 0.5), hue });
                } catch (e) { resolve({ hex: NEUTRAL, hue: null }); }
            };
            img.onerror = () => resolve({ hex: NEUTRAL, hue: null });
            img.src = src;
        });
    }
    window.OPColor = { extractColor, NEUTRAL };
})();
