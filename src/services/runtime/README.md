# @cliniqone/onnx-runtime

ONNX Runtime Web implementation of `WakeModelPort`.

```ts
import { OnnxWakeModel } from "@cliniqone/onnx-runtime";

const wakeModel = new OnnxWakeModel({
  modelUrl: "/models/hola-f1/hola-f1.onnx",
  manifestUrl: "/models/hola-f1/manifest.json",
  externalDataUrl: "/models/hola-f1/hola-f1.onnx.data",
  externalDataPath: "hola-f1.onnx.data",
});
```

The external data path must match the location stored inside the ONNX graph. The pilot exporter produced `hola-f1.onnx.data`.
