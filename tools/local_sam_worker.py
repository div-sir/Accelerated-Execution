#!/usr/bin/env python3
"""Minimal loopback SAM2 worker for Accelerated Execution.

Optional dependencies:
    pip install -r requirements-local-sam.txt

The worker loads the model lazily on the first segmentation request.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = "127.0.0.1"
PORT = int(os.environ.get("AE_LOCAL_SAM_PORT", "8765"))
MODEL_ID = os.environ.get("AE_LOCAL_SAM_MODEL", "facebook/sam2.1-hiera-tiny")
TOKEN = os.environ.get("AE_LOCAL_SAM_TOKEN", "")
_MODEL = None
_PROCESSOR = None
_DEVICE = None


def _json(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _authorized(handler: BaseHTTPRequestHandler) -> bool:
    if not TOKEN:
        return True
    return handler.headers.get("authorization") == f"Bearer {TOKEN}"


def _load_model():
    global _MODEL, _PROCESSOR, _DEVICE
    if _MODEL is not None:
        return _MODEL, _PROCESSOR, _DEVICE

    try:
        import torch
        from transformers import Sam2Model, Sam2Processor
    except Exception as exc:
        raise RuntimeError(
            "SAM2 dependencies are missing. Install requirements-local-sam.txt."
        ) from exc

    if torch.backends.mps.is_available():
        device = torch.device("mps")
    elif torch.cuda.is_available():
        device = torch.device("cuda")
    else:
        device = torch.device("cpu")

    model = Sam2Model.from_pretrained(MODEL_ID).to(device)
    model.eval()
    processor = Sam2Processor.from_pretrained(MODEL_ID)

    _MODEL = model
    _PROCESSOR = processor
    _DEVICE = device
    return model, processor, device


def _absolute_existing_file(value: Any) -> Path:
    path = Path(str(value or "")).expanduser().resolve()
    if not path.is_file():
        raise ValueError("imagePath must reference an existing file")
    return path


def _output_directory(value: Any, image_path: Path) -> Path:
    directory = Path(str(value or image_path.parent)).expanduser().resolve()
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _prompt_for_image(target: dict[str, Any], width: int, height: int) -> dict[str, Any]:
    kind = target.get("kind")
    if target.get("coordinateSpace") != "normalized-source":
        raise ValueError("target.coordinateSpace must be normalized-source")

    def coord(name: str) -> float:
        value = float(target[name])
        if value < 0 or value > 1:
            raise ValueError(f"target.{name} must be between 0 and 1")
        return value

    x = coord("x")
    y = coord("y")
    if kind == "point":
        return {
            "input_points": [[[[x * width, y * height]]]],
            "input_labels": [[[1]]],
        }

    if kind == "box":
        box_width = coord("width")
        box_height = coord("height")
        if box_width <= 0 or box_height <= 0 or x + box_width > 1.000001 or y + box_height > 1.000001:
            raise ValueError("target box must stay inside the source image")
        return {
            "input_boxes": [[[
                x * width,
                y * height,
                (x + box_width) * width,
                (y + box_height) * height,
            ]]]
        }

    raise ValueError("target.kind must be point or box")


def _segment(payload: dict[str, Any]) -> dict[str, Any]:
    import torch
    from PIL import Image

    image_path = _absolute_existing_file(payload.get("imagePath"))
    output_directory = _output_directory(payload.get("outputDirectory"), image_path)
    target = payload.get("target")
    if not isinstance(target, dict):
        raise ValueError("target must be an object")

    image = Image.open(image_path).convert("RGB")
    model, processor, device = _load_model()
    prompt = _prompt_for_image(target, image.width, image.height)

    inputs = processor(images=image, return_tensors="pt", **prompt).to(device)
    with torch.no_grad():
        outputs = model(**inputs)

    masks = processor.post_process_masks(outputs.pred_masks.cpu(), inputs["original_sizes"])[0]
    scores = outputs.iou_scores.detach().cpu().reshape(-1)
    best_index = int(torch.argmax(scores).item())

    # A single object produces [object, candidate, height, width].
    if masks.ndim == 4:
        mask = masks[0, best_index]
    elif masks.ndim == 3:
        mask = masks[best_index]
    else:
        raise RuntimeError(f"Unexpected SAM2 mask shape: {tuple(masks.shape)}")

    binary = (mask > 0).to(torch.uint8).mul(255).numpy()
    mask_name = f"{image_path.stem}.sam2-mask.png"
    mask_path = output_directory / mask_name
    Image.fromarray(binary, mode="L").save(mask_path)

    return {
        "ok": True,
        "maskPath": str(mask_path),
        "confidence": float(scores[best_index].item()),
        "provider": "huggingface-transformers",
        "model": MODEL_ID,
        "device": str(device),
        "width": image.width,
        "height": image.height,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "AcceleratedExecutionSAM/0.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[local-sam] " + (fmt % args) + "\n")

    def do_GET(self) -> None:
        if self.path != "/health":
            _json(self, 404, {"ok": False, "error": "not found"})
            return
        if not _authorized(self):
            _json(self, 401, {"ok": False, "error": "unauthorized"})
            return
        _json(self, 200, {
            "ok": True,
            "provider": "huggingface-transformers",
            "model": MODEL_ID,
            "loaded": _MODEL is not None,
            "device": str(_DEVICE) if _DEVICE is not None else None,
        })

    def do_POST(self) -> None:
        if self.path != "/segment":
            _json(self, 404, {"ok": False, "error": "not found"})
            return
        if not _authorized(self):
            _json(self, 401, {"ok": False, "error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 1024 * 1024:
                raise ValueError("invalid request size")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("request body must be an object")
            _json(self, 200, _segment(payload))
        except ValueError as exc:
            _json(self, 400, {"ok": False, "error": str(exc)})
        except Exception as exc:
            _json(self, 500, {"ok": False, "error": str(exc)})


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Accelerated Execution local SAM worker: http://{HOST}:{PORT}")
    print(f"Model: {MODEL_ID}")
    server.serve_forever()


if __name__ == "__main__":
    main()
