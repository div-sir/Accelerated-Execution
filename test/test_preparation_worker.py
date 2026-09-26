import json
import tempfile
import unittest
from pathlib import Path

from tools.preparation_worker import write_manifest


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


if __name__ == "__main__":
    unittest.main()
