import json
import tempfile
import unittest
from pathlib import Path

from tools.preparation_worker import frame_metrics, score_batch_payload, score_candidate, write_manifest


class PreparationWorkerTest(unittest.TestCase):
    def test_worker_creates_reusable_prepare_only_package(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "clip.mov"
            source.write_bytes(b"test")
            output = root / "prepared"

            manifest_path = write_manifest(output, source, {"shots": 2})
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

            self.assertEqual(manifest["mode"], "prepare-only")
            self.assertFalse(manifest["policy"]["applyToAfterEffects"])
            self.assertFalse(manifest["policy"]["renderFinalFrames"])
            self.assertEqual(manifest["analysis"]["shots"], 2)
            for name in ("frames", "masks", "tracks", "previews"):
                self.assertTrue((output / name).is_dir())

    def test_frame_metrics_and_score_match_candidate_contract(self):
        width = 160
        height = 90
        flat = bytes([127] * (width * height))
        checker = bytes(
            255 if ((x // 4) + (y // 4)) % 2 else 0
            for y in range(height)
            for x in range(width)
        )
        flat_metrics = frame_metrics(flat, flat, flat, width, height)
        checker_metrics = frame_metrics(checker, checker, checker, width, height)
        self.assertGreater(checker_metrics["sharpness"], flat_metrics["sharpness"])
        self.assertGreater(checker_metrics["trackability"], flat_metrics["trackability"])
        self.assertEqual(flat_metrics["stability"], 1)
        self.assertAlmostEqual(
            score_candidate({
                "sharpness": 2,
                "stability": 1,
                "visibility": 1,
                "trackability": 1,
                "occlusion": 0,
            }),
            0.9,
        )

    def test_score_batch_validates_and_scores_base64_frames(self):
        import base64

        frame = bytes([127] * 9)
        encoded = base64.b64encode(frame).decode("ascii")
        result = score_batch_payload({
            "version": 1,
            "width": 3,
            "height": 3,
            "candidates": [{"previous": encoded, "current": encoded, "next": encoded}],
        })
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["candidates"]), 1)
        self.assertEqual(result["candidates"][0]["metrics"]["stability"], 1)


if __name__ == "__main__":
    unittest.main()
