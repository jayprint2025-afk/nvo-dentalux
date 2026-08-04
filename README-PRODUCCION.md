# Integración directa en producción — CliniqOne

Este parche está diseñado para el repositorio `nvo-dentalux` desplegado por Render.

## Aplicación

1. Clona o abre localmente `nvo-dentalux`.
2. Copia todo el contenido de este ZIP a la raíz del repositorio.
3. Ejecuta:

```powershell
node .\apply-production-patch.cjs
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install
npm run build
```

4. Confirma que estos archivos existen:

```text
public/models/hola-f1/hola-f1.onnx
public/models/hola-f1/hola-f1.onnx.data
public/models/hola-f1/manifest.json
```

5. Sube a GitHub:

```powershell
git add .
git commit -m "feat(f1): enable Hola F1 wake word in production"
git push origin main
```

Render detectará el commit, ejecutará `npm install` y `npm run build`, y publicará la versión nueva.

## Prueba en producción

Abre `https://nvo-dentalux-1.onrender.com`, activa el motor de voz desde el robot flotante, autoriza el micrófono y di “Hola F1”.

El navegador debe solicitar con HTTP 200:

```text
/models/hola-f1/manifest.json
/models/hola-f1/hola-f1.onnx
/models/hola-f1/hola-f1.onnx.data
```

## Advertencia

El modelo es piloto. El threshold 0.47 permite probarlo, pero puede producir falsas activaciones. No se recomienda habilitarlo automáticamente a todos los usuarios todavía.
