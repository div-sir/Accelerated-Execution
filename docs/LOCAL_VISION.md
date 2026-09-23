# Local Vision Provider

Accelerated Execution keeps local vision outside the After Effects process.

## Contract

The extension sidecar talks only to a loopback service. The default endpoint is:

```text
http://127.0.0.1:8765
```

Override it with `AE_LOCAL_SAM_ENDPOINT`.

The endpoint MUST resolve to `localhost` or `127.0.0.1`. The adapter refuses remote hosts.

### Health

`GET /health`

Expected response:

```json
{
  "ok": true,
  "provider": "huggingface",
  "model": "sam-family-model"
}
```

### Segment

`POST /segment`

Request:

```json
{
  "imagePath": "/absolute/path/to/frame.png",
  "target": {
    "kind": "box",
    "coordinateSpace": "normalized-source",
    "x": 0.2,
    "y": 0.15,
    "width": 0.4,
    "height": 0.7
  },
  "outputDirectory": "/absolute/path/to/output"
}
```

Response:

```json
{
  "ok": true,
  "maskPath": "/absolute/path/to/output/mask.png",
  "confidence": 0.93
}
```

## Design rule

The local model is a fallback. AE native Object Matte or Roto Brush remains the preferred execution path when it is available and scriptable enough for the requested operation.

The provider protocol is model-agnostic. A later worker can use a Hugging Face SAM-family checkpoint, MLX/Core ML, or another local segmentation runtime without changing the AE panel.


## Included worker

The repository includes `tools/local_sam_worker.py`.

Install the optional dependencies:

```bash
python3 -m pip install -r requirements-local-sam.txt
```

Start the worker:

```bash
npm run sam:serve
```

The default model is `facebook/sam2.1-hiera-tiny`. Override it with `AE_LOCAL_SAM_MODEL`.

On Apple Silicon, the worker prefers PyTorch MPS when it is available. It uses CUDA when available and otherwise falls back to CPU.

For local process isolation, set the same `AE_LOCAL_SAM_TOKEN` environment variable for the extension process and the worker. The adapter sends it as a Bearer token.

The first segmentation request can take longer because the worker lazily downloads and loads the model.
