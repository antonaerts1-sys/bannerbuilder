# TKK Bannerbuilder

Single-page browser tool om logo's te normaliseren voor decks: grijstinten of originele kleuren, uniforme bounding box, optioneel in een banner-rooster.

Eerder bekend als "TKK Logo Normalizer" (oude folder/repo naam: `tkk-logo-normalizer`).

## Doel

Anton maakt regelmatig decks met logo-rijen (zie TKK "Over ons" slide: 20 client-logos in 10x2). Zonder tool kost dit veel handwerk: elk logo apart naar grijstinten zetten, in eenzelfde formaat plaatsen, witruimte trimmen, uitlijnen. Deze tool doet die normalisatie in batch en levert ofwel losse PNG's ofwel een kant-en-klare banner-PNG.

## Twee modes

1. **Eén logo** — 1 logo in, grayscale + uniforme box uit
2. **Banner** — meerdere logos in, configureerbaar rooster (cols, rows, gap) uit als 1 PNG

## Stack

Vanilla HTML/CSS/JS + Canvas API. Geen build step, geen framework, geen dependencies. Drie bestanden:

- `index.html` — markup + structuur
- `styles.css` — alle styling
- `app.js` — alle logica

Reden: matcht het collage-maker patroon, instant deploybaar als statische site, niets om te onderhouden.

## Pipeline per logo

1. File ingelezen via FileReader → HTMLImageElement
2. Getekend op offscreen canvas (origineel-kleur behouden)
3. **Soft bg-removal voor JPG**: pixels met R+G+B > 720 (near-white) worden transparant, met soft feather over 60 niveaus
4. **Optionele expliciete bg-removal**: als `logo.bgRemoval` gezet is, worden pixels binnen Euclidische RGB-afstand `tolerance` van de gekozen sample-kleur transparant, met soft feather over `BG_FEATHER` (18) niveaus
5. **Auto-trim**: bounding-box van pixels met alpha > threshold, crop tot die box → `trimmedCanvas` (volledig in originele kleur)
6. **Render-step kleurtransform** (`getRenderCanvas`):
   - `colorMode = 'original'`: gebruikt `trimmedCanvas` rechtstreeks
   - `colorMode = 'grayscale'`: applies `grayscale(1) contrast(1.05)`, cached per logo
   - `colorMode = 'tint'`: vervangt RGB met gekozen kleur, moduleert alpha met (255 - luminance) / 255, cached per logo per kleur

`trimmedCanvas` bewaart dus de originele kleuren post-trim. Kleurtransform gebeurt at render-time zodat schakelen tussen Origineel/Grijs/Kleur geen re-normalize vereist.

## Rendering

Render-stap is altijd dezelfde: trimmedCanvas wordt aspect-correct geschaald in `cellSize - 2*padding`, gecentreerd in cel, vermenigvuldigd met user-scale-slider (0.5x-1.5x) voor visueel gewicht.

Single mode: 1 cel = output.
Banner mode: grid van cellen op offscreen canvas, gap tussen cellen, achtergrond-fill, geëxporteerd als 1 PNG.

## Background removal (color sample)

Voor logos met niet-witte achtergrond (bv 1813 op grijs, logo op licht-cream): per-logo "bg" toggle button.

- Click → `sampleCornerColor(sourceImage)` neemt gemiddelde van de 4 hoeken (skipping reeds-transparante hoeken), zet `logo.bgRemoval = { sampleRGB, tolerance: 30 }`, roept `reNormalizeLogo(logo)` aan
- Tolerance-slider verschijnt onder logo-item (5-120 range), elke wijziging triggert re-normalize
- Click opnieuw → `bgRemoval = null`, re-normalize zonder color sample
- Soft feather van `BG_FEATHER` (18) niveaus voorbij tolerance voor anti-aliased edges

Geen ML, geen API-call, geen heuristiek voor complexe achtergronden. Werkt goed voor uniforme bg ~80% van use-cases. Edge cases (foto-bg, gradients) blijven niet ondersteund.

## Bewust niet (v1)

- **SVG behoud als vector**: SVG wordt gerasterd via `<img>` met data-URL. Voldoende voor deck-gebruik op 800px+ cellen.
- **ML background removal** (à la Canva/remove.bg): niet realistisch in vanilla browser. Color-sample dekt de meeste logos.
- **Klik-om-te-samplen op het logo**: nu auto-sample uit 4 hoeken. Click-to-sample (magic wand) zou per-pixel UI vereisen. Toevoegen als 4-corner-sample te vaak misgaat.
- **ZIP-download van losse PNG's**: enkel banner-PNG + individuele single-mode download. Kan later toegevoegd met JSZip CDN.
- **Drag-to-reorder**: volgorde in banner = upload-volgorde, met simpele up/down knopjes per logo om te herschikken.

## State shape

```js
state = {
  mode: 'single' | 'banner',
  logos: [{
    id: string,
    name: string,
    sourceImage: HTMLImageElement,
    trimmedCanvas: HTMLCanvasElement,  // origineel-kleur post-trim + bg-removal
    inkPixels: number,                  // voor auto-balance
    centroid: { x, y },                 // voor optisch centreren
    scale: number,                      // 0.5 - 1.5
    bgRemoval: null | { sampleRGB: [r,g,b], tolerance: number },
    _renderCache: HTMLCanvasElement,
    _renderCacheKey: string,
  }],
  config: {
    cellW, cellH: number,
    paddingPct: number,
    bgColor: 'transparent' | hex,
    cols: number,                       // banner only
    gap: number,
    colorMode: 'original' | 'grayscale' | 'tint',
    tint: { color: hex },
    opticalCenter: boolean,
  }
}
```

## Deployment

Gedeployed als GitHub Pages site onder Anton's `antonaerts1-sys` account in repo `bannerbuilder`. URL: https://antonaerts1-sys.github.io/bannerbuilder/. Geen build nodig, push naar `main` triggert nieuwe deploy.

## Design

Sober, vergelijkbaar met Gather-stijl: zwart op cream/wit, bold sans-serif headings, body Inter/Google Sans. Geen emoji, geen em-dashes (Anton-voorkeur).
