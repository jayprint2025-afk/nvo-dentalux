# Centro Dental Innovador - v6 (robusto en Windows)

## Novedades
- `dev` usa `node node_modules/electron/cli.js .` (más estable que `npx electron .`).
- `.bat` incluye instalación automática la primera vez.
- `base: './'` en Vite para evitar pantalla en blanco al empaquetar.

## Uso
1) Doble clic **iniciar-dev.bat** (o `npm run dev`).
2) Doble clic **generar-exe.bat** (o `npm run dist`).

## Manual si algo falla
- Terminal 1: `npx vite`
- Terminal 2: `node node_modules/electron/cli.js .`
