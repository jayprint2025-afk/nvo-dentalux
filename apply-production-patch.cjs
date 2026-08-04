const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const packagePath = path.join(root, "package.json");
if (!fs.existsSync(packagePath)) {
  throw new Error("Ejecuta este script desde la raíz de nvo-dentalux.");
}

const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));
pkg.dependencies ||= {};
Object.assign(pkg.dependencies, {
  "@cliniqone/audio-engine": "file:vendor/f1/audio-engine",
  "@cliniqone/vad": "file:vendor/f1/vad",
  "@cliniqone/wake-detector": "file:vendor/f1/wake-detector",
  "@cliniqone/f1-voice-engine": "file:vendor/f1/sdk",
  "@cliniqone/onnx-runtime": "file:vendor/f1/runtime",
  "onnxruntime-web": "1.22.0"
});
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

const widgetCandidates = [
  path.join(root, "src", "AIFloatingWidget.tsx"),
  path.join(root, "src", "components", "AIFloatingWidget.tsx")
];
const widgetPath = widgetCandidates.find(fs.existsSync);
if (!widgetPath) {
  throw new Error("No encontré src/AIFloatingWidget.tsx.");
}

let widget = fs.readFileSync(widgetPath, "utf8");
widget = widget.replace(/threshold:\s*0\.78/g, "threshold: 0.47");
widget = widget.replace(
  /void engine\.stop\(\);\s*\n\s*};\s*\n\s*}, \[connectVoice, f1VoiceEngineEnabled\]\);/,
  "void engine.dispose();\n    };\n  }, [connectVoice, f1VoiceEngineEnabled]);"
);
fs.writeFileSync(widgetPath, widget);

console.log("Patch aplicado:");
console.log("- dependencias locales F1 agregadas a package.json");
console.log("- threshold piloto cambiado a 0.47");
console.log("- modelo disponible en /models/hola-f1/");
