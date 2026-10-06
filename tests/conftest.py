import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# Tests never write to the real database (data/coronarytwin.db): every run gets its own file.
os.environ.setdefault("CORONARYTWIN_DB", str(Path(tempfile.mkdtemp(prefix="coronarytwin-test-")) / "test.db"))
