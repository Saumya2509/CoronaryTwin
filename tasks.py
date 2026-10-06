"""Cross-platform task runner (Windows has no `make` by default).

    python tasks.py setup      create .venv and install pinned dependencies
    python tasks.py data       download dataset, write data/processed/, manifest and audit report
    python tasks.py mock       regenerate mock API responses in fixtures/
    python tasks.py serve      run the API on http://127.0.0.1:8000 (docs at /docs)
    python tasks.py web        install and run the frontend on http://localhost:5173 (module 05)
    python tasks.py check      cross-check features.yaml, registry.json, anatomy.json, settings
    python tasks.py test       registry check, then Python and web tests
    python tasks.py train      train all models (module 02), then explain
    python tasks.py explain    SHAP background, global importance, stability report, demo patients, case base
    python tasks.py db         browse the SQLite database (python view_db.py --help for more)
    python tasks.py experiments  paired comparison, ablation, decision/learning curves, robustness,
                               OOD and next-best-test checks (~10 min) -> docs/experiments.md
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
PY = VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def python() -> str:
    return str(PY) if PY.exists() else sys.executable


def run(*args: str) -> None:
    print("+", " ".join(args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def setup() -> None:
    if not PY.exists():
        run(sys.executable, "-m", "venv", str(VENV))
    run(str(PY), "-m", "pip", "install", "--upgrade", "pip")
    run(str(PY), "-m", "pip", "install", "-r", "requirements.txt")


def data() -> None:
    run(python(), "-m", "src.data")
    run(python(), "-m", "src.audit")


def mock() -> None:
    run(python(), "scripts/make_mock_fixtures.py")


def serve() -> None:
    run(python(), "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000")


def web() -> None:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    if not (ROOT / "web" / "node_modules").exists():
        subprocess.run([npm, "ci"], cwd=ROOT / "web", check=True)
    subprocess.run([npm, "run", "dev"], cwd=ROOT / "web", check=True)


def check() -> None:
    run(python(), "scripts/check_registries.py")


def test() -> None:
    check()
    run(python(), "-m", "pytest", "-q")
    npm = "npm.cmd" if os.name == "nt" else "npm"
    if (ROOT / "web" / "node_modules").exists():
        subprocess.run([npm, "test"], cwd=ROOT / "web", check=True)


def train() -> None:
    train_py = ROOT / "src" / "train.py"
    if not train_py.exists():
        sys.exit("src/train.py does not exist yet; it is built in module 02.")
    run(python(), "-m", "src.train")
    explain()


def explain() -> None:
    run(python(), "-m", "src.explain")
    run(python(), "-m", "src.demo_patients")
    run(python(), "-m", "src.casebase")


def db() -> None:
    run(python(), "view_db.py")


def experiments() -> None:
    run(python(), "-m", "src.experiments")


TASKS = {f.__name__: f for f in (setup, data, mock, serve, web, check, test, train, explain, experiments, db)}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in TASKS:
        sys.exit(__doc__)
    try:
        TASKS[sys.argv[1]]()
    except subprocess.CalledProcessError as e:
        sys.exit(e.returncode)
