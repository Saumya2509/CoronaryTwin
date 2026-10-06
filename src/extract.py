"""Read clinical reports into model inputs (feature 2: multimodal input).

A clinician drops lab, ECG, echo or referral reports (PDF, photo/scan, or text). This module turns
them into proposed values for the patient record. Nothing is applied automatically: the UI shows
every value with the line it came from, and the user confirms each one.

    reports -> text  (PDF text layer; images and scanned PDF pages via local OCR, RapidOCR/ONNX)
            -> values (rules below: synonyms, units, negation, ranges from features.yaml)

Optional, opt-in: Claude vision reads the files instead (`use_claude`). It is off unless the server
sets CORONARYTWIN_CLAUDE_EXTRACT=1 and has Anthropic credentials, because it sends the documents to
Anthropic. Its answers go through the same unit conversion and range checks.

Privacy: files are processed in memory and never written to disk, the database or logs.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import threading
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import Any, Callable

from . import data

log = logging.getLogger("coronarytwin.extract")

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_FILES = 8
CLAUDE_MODEL = "claude-opus-5-5"
IMAGE_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}


@dataclass
class Finding:
    name: str
    value: float | int | str
    evidence: str                  # the line the value was read from
    source: str                    # file name
    method: str                    # "text" | "ocr" | "claude"
    confidence: str = "high"       # "high" | "medium" | "low"
    note: str = ""                 # e.g. "converted from 7.4 mmol/L"


@dataclass
class Result:
    findings: list[Finding] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    files: list[dict] = field(default_factory=list)


# ---------------------------------------------------------------- reading files

_ocr = None
_ocr_lock = threading.Lock()


def ocr_disabled() -> bool:
    """CORONARYTWIN_OCR=off turns photo/scan reading off (small hosts: OCR needs ~600 MB at its peak)."""
    return os.environ.get("CORONARYTWIN_OCR", "").strip().lower() in {"off", "0", "false", "no"}


def ocr_engine():
    """Lazily loaded local OCR engine (bundled ONNX models, no network). None if not installed or turned off."""
    global _ocr
    if ocr_disabled():
        return None
    with _ocr_lock:
        if _ocr is None:
            try:
                from rapidocr import RapidOCR
                # CORONARYTWIN_OCR_THREADS=1 keeps memory low on small hosts (default: all cores)
                threads = int(os.environ.get("CORONARYTWIN_OCR_THREADS", "-1"))
                _ocr = RapidOCR(params={"Global.log_level": "warning",
                                        "EngineConfig.onnxruntime.intra_op_num_threads": threads,
                                        "EngineConfig.onnxruntime.inter_op_num_threads": threads if threads > 0 else -1})
            except Exception as e:  # missing package or model
                log.warning("OCR unavailable: %s", e)
                _ocr = False
        return _ocr or None


MAX_OCR_SIDE = 2000   # px; report text stays legible, and a 12 MP phone photo no longer needs ~1 GB to read


def _shrink(image_bytes: bytes) -> bytes:
    """Downscale large photos before OCR (memory and time grow with pixel count)."""
    try:
        from PIL import Image
        im = Image.open(io.BytesIO(image_bytes))
        if max(im.size) <= MAX_OCR_SIDE:
            return image_bytes
        im = im.convert("RGB")
        im.thumbnail((MAX_OCR_SIDE, MAX_OCR_SIDE), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return image_bytes


def ocr_lines(image_bytes: bytes) -> list[str]:
    """OCR an image and rebuild reading-order lines: boxes whose vertical centers are close are one
    line, left to right, joined by wide gaps so table columns stay separable."""
    eng = ocr_engine()
    if eng is None:
        if ocr_disabled():
            raise RuntimeError("reading photos and scans is turned off on this server; PDFs with text and text files still work")
        raise RuntimeError("Local OCR is not installed (pip install rapidocr onnxruntime).")
    res = eng(_shrink(image_bytes))
    if res is None or res.boxes is None or res.txts is None:
        return []
    items = []
    for box, txt, score in zip(res.boxes, res.txts, res.scores):
        if float(score) < 0.5:
            continue
        ys, xs = [p[1] for p in box], [p[0] for p in box]
        items.append(((min(ys) + max(ys)) / 2, max(ys) - min(ys), min(xs), txt))
    items.sort()
    lines: list[list[tuple]] = []
    for it in items:
        if lines and abs(it[0] - lines[-1][0][0]) < 0.6 * max(it[1], lines[-1][0][1]):
            lines[-1].append(it)
        else:
            lines.append([it])
    return ["    ".join(t for *_, t in sorted(line, key=lambda i: i[2])) for line in lines]


def _kind(content: bytes, filename: str) -> str:
    if content[:5] == b"%PDF-":
        return "pdf"
    head = content[:12]
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if head[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        return "unknown"
    printable = sum(ch.isprintable() or ch in "\r\n\t" for ch in text[:4000])
    return "text" if text and printable >= 0.95 * min(len(text), 4000) else "unknown"


def read_file(content: bytes, filename: str) -> tuple[list[str], str]:
    """File -> (lines, method)."""
    kind = _kind(content, filename)
    if kind == "text":
        return content.decode("utf-8").splitlines(), "text"
    if kind in IMAGE_TYPES:
        return ocr_lines(content), "ocr"
    if kind == "pdf":
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        lines: list[str] = []
        for page in reader.pages[:20]:
            lines += (page.extract_text() or "").splitlines()
        if sum(len(x.strip()) for x in lines) >= 40:
            return lines, "text"
        lines = []  # scanned PDF: OCR the page images
        for page in reader.pages[:10]:
            for img in page.images:
                lines += ocr_lines(img.data)
        return lines, "ocr"
    raise ValueError("unsupported file type (use PDF, PNG, JPEG, WEBP or text)")


# ---------------------------------------------------------------- units

NUM = r"(\d+(?:[.,]\d+)?)"
UNIT_RE = re.compile(
    r"^\s*(?P<u>mmol\s*/\s*l|[µμu]mol\s*/\s*l|mg\s*/\s*dl|g\s*/\s*dl|g\s*/\s*l|meq\s*/\s*l|mm\s*/\s*h(?:r)?|"
    r"mm\s*hg|bpm|kg\s*/\s*m2|%|"
    r"(?:x|×|\*)\s*10\s*(?:\^|e|\*\*)?\s*(?:9|⁹)\s*/\s*l|(?:x|×|\*)\s*10\s*(?:\^|e|\*\*)?\s*(?:3|³)\s*/\s*[µμu]l|"
    r"/\s*[µμu]l|/\s*mm3|k\s*/\s*[µμu]l)", re.I)


def _unit(after: str) -> str:
    m = UNIT_RE.match(after)
    if not m:
        return ""
    u = re.sub(r"\s+", "", m.group("u").lower()).replace("μ", "µ").replace("umol", "µmol").replace("ul", "µl")
    u = u.replace("×", "x").replace("*", "x").replace("⁹", "9").replace("³", "3")
    if "10" in u and "9" in u:
        return "x10^9/l"
    if "10" in u and "3" in u:
        return "x10^3/µl"
    return u


# target unit per feature, and factor from other units
CONVERT: dict[str, dict[str, float]] = {
    "fbs": {"mmol/l": 18.016},
    "tg": {"mmol/l": 88.57},
    "ldl": {"mmol/l": 38.67},
    "hdl": {"mmol/l": 38.67},
    "creatinine": {"µmol/l": 1 / 88.42},
    "bun": {"mmol/l": 2.8},                 # urea mmol/L -> BUN mg/dL
    "hb": {"g/l": 0.1},
    "wbc": {"x10^9/l": 1000, "x10^3/µl": 1000, "k/µl": 1000},
    "plt": {"/µl": 0.001, "/mm3": 0.001},  # target is x1000/µL; x10^9/L is already that
}


def _num(s: str) -> float:
    return float(s.replace(",", "."))


def to_model_units(name: str, value: float, unit: str) -> tuple[float, str, str] | None:
    """(value, note, confidence) in features.yaml units, or None if no plausible reading exists."""
    spec = _specs()[name]
    lo, hi = spec.get("valid_range") or (float("-inf"), float("inf"))
    conv = CONVERT.get(name, {})
    if unit in conv:
        v = value * conv[unit]
        return (v, f"converted from {value:g} {unit}", "high") if lo <= v <= hi else None
    if lo <= value <= hi:
        return value, "", "high"
    for u, f in conv.items():  # unit missing or unrecognized: try the alternative units
        v = value * f
        if lo <= v <= hi:
            return v, f"assumed {u} (no unit found): converted from {value:g}", "low"
    return None


# ---------------------------------------------------------------- rules

def _w(*terms: str) -> re.Pattern:
    return re.compile(r"(?<![a-z])(?:" + "|".join(terms) + r")(?![a-z])", re.I)


NUMERIC: dict[str, re.Pattern] = {
    "age": _w(r"age", r"aged"),
    "bmi": _w(r"bmi", r"body mass index"),
    "pulse_rate": _w(r"pulse(?: rate)?", r"heart rate", r"hr", r"ventricular rate"),
    "fbs": _w(r"fasting (?:blood |plasma )?(?:glucose|sugar)", r"glucose,? fasting", r"fbs", r"fpg", r"fbg"),
    "creatinine": _w(r"(?:serum )?creatinine(?! clearance)", r"creat", r"cr"),
    "tg": _w(r"triglycerides?", r"tg", r"trig"),
    "ldl": _w(r"ldl(?:-c)?(?: cholesterol)?", r"low[- ]density lipoprotein(?: cholesterol)?"),
    "hdl": _w(r"hdl(?:-c)?(?: cholesterol)?", r"high[- ]density lipoprotein(?: cholesterol)?"),
    "bun": _w(r"bun", r"(?:blood )?urea nitrogen", r"urea"),
    "esr": _w(r"esr", r"(?:erythrocyte )?sedimentation rate"),
    "hb": _w(r"ha?emoglobin(?! a1c)", r"hgb", r"hb(?!a1c)"),
    "k": _w(r"potassium", r"k\+?"),
    "na": _w(r"sodium", r"na\+?"),
    "wbc": _w(r"white (?:blood )?cells?(?: count)?", r"wbc", r"leu[ck]ocytes?", r"total leu[ck]ocyte count", r"tlc"),
    "lymph": _w(r"lymphocytes?", r"lymph"),
    "neut": _w(r"neutrophils?", r"neut", r"polymorphs"),
    "plt": _w(r"platelets?(?: count)?", r"plt"),
    "ef_tte": _w(r"lvef", r"ef", r"ejection fraction"),
}
BP = re.compile(r"(?<![a-z])(?:blood pressure|bp|b\.p\.)(?![a-z])[^\d\n]{0,12}(\d{2,3})\s*/\s*(\d{2,3})", re.I)
AGE_OLD = re.compile(r"(\d{2,3})[- ]?(?:years?|yrs?|y)[- ]?(?:old|/o)", re.I)
SEX = re.compile(r"(?<![a-z])(?:sex|gender)\s*[:=]?\s*(male|female|m|f)(?![a-z])", re.I)
SEX_WORD = re.compile(r"\d{2,3}[- ]?(?:years?|yrs?|y)[- ]?(?:old)?\s+(man|woman|male|female|gentleman|lady)", re.I)

# binary features: (pattern, value when positive). Several features can share one finding.
BINARY: dict[str, list[re.Pattern]] = {
    "diabetes": [_w(r"diabetes(?: mellitus)?", r"diabetic", r"dm", r"t2dm", r"type 2 diabetes")],
    "hypertension": [_w(r"hypertension", r"hypertensive", r"htn")],
    "current_smoker": [_w(r"current(?:ly)? smok(?:er|ing)", r"active smoker", r"smokes")],
    "ex_smoker": [_w(r"ex[- ]?smoker", r"former smoker", r"quit smoking", r"past smoker")],
    "family_history": [_w(r"family history(?: of (?:cad|coronary artery disease|premature cad|heart disease|ihd))?", r"fh")],
    "dyslipidemia": [_w(r"dyslipid(?:a)?emia", r"hyperlipid(?:a)?emia", r"hypercholesterol(?:a)?emia", r"dlp")],
    "chronic_renal_failure": [_w(r"chronic (?:renal|kidney) (?:failure|disease)", r"ckd", r"crf")],
    "cva": [_w(r"stroke", r"cva", r"cerebrovascular accident")],
    "thyroid_disease": [_w(r"(?:hypo|hyper)thyroidism", r"thyroid disease")],
    "chf": [_w(r"(?:congestive )?heart failure", r"chf")],
    "airway_disease": [_w(r"asthma", r"copd", r"airway disease")],
    "edema": [_w(r"o?edema", r"pedal o?edema", r"leg swelling")],
    "dyspnea": [_w(r"dyspn(?:o)?ea", r"shortness of breath", r"breathlessness", r"sob")],
    "low_threshold_angina": [_w(r"low[- ]threshold angina", r"angina (?:at|on) (?:low|minimal) (?:workload|exertion|effort)")],
    "q_wave": [_w(r"(?:pathological |significant )?q[- ]?waves?")],
    "st_elevation": [_w(r"st[- ](?:segment )?elevations?", r"st elevated")],
    "st_depression": [_w(r"st[- ](?:segment )?depressions?", r"st depressed")],
    "t_inversion": [_w(r"t[- ]?wave inversions?", r"inverted t[- ]?waves?", r"t inversions?")],
    "lvh": [_w(r"left ventricular hypertrophy", r"lvh")],
    "poor_r_progression": [_w(r"poor r[- ]?wave progression", r"poor r progression")],
    "weak_peripheral_pulse": [_w(r"weak peripheral pulses?", r"diminished peripheral pulses?")],
    "lung_rales": [_w(r"(?:lung |basal )?(?:rales|crackles|crepitations)")],
    "systolic_murmur": [_w(r"systolic murmur")],
    "diastolic_murmur": [_w(r"diastolic murmur")],
}
CHEST_PAIN = [  # first match wins; sets all three chest-pain flags
    ("atypical_chest_pain", _w(r"atypical (?:angina|chest pain)")),
    ("nonanginal_chest_pain", _w(r"non[- ]?anginal(?: chest pain| pain)?", r"non[- ]?cardiac chest pain")),
    ("typical_chest_pain", re.compile(r"(?<![a-z])typical (?:angina|chest pain)|(?<![a-z])(?:exertional|stable) angina", re.I)),
]
ST_T = _w(r"st[- ]?t (?:wave )?changes", r"st changes", r"ischa?emic changes")
BBB_LEFT = _w(r"left bundle branch block", r"lbbb")
BBB_RIGHT = _w(r"right bundle branch block", r"rbbb")
BBB_ANY = _w(r"bundle branch block", r"bbb")
NORMAL_R = _w(r"normal r[- ]?wave progression")
RWMA = _w(r"(?:regional )?wall[- ]motion abnormalit(?:y|ies)", r"rwma", r"hypokines(?:is|ia)", r"akines(?:is|ia)", r"dyskines(?:is|ia)")
RWMA_COUNT = re.compile(r"(\d)\s*(?:regions?|segments?|walls?|territor(?:y|ies))", re.I)
VALVE = re.compile(r"(?<![a-z])(trace|trivial|mild|moderate|moderately severe|severe)(?:\s+to\s+(?:moderate|severe))?\s+"
                   r"(?:mitral|aortic|tricuspid|pulmonary|pulmonic|valv\w*)(?:\s+valve)?\s*(?:regurgitation|stenosis|insufficiency|disease|incompetence)?", re.I)
VALVE_NONE = _w(r"no (?:significant )?valv(?:e|ular) (?:disease|abnormality|lesions?)", r"valves? (?:are |were )?normal",
                r"valvular heart disease\s*[:=]\s*(?:none|no|n)")
VHD_SCALE = {"trace": 0, "trivial": 0, "mild": 1, "moderate": 2, "moderately severe": 3, "severe": 3}

YES = re.compile(r"^\s*[:=\-]?\s*\(?\s*(yes|y|present|positive|\+)(?![a-z])", re.I)
NO = re.compile(r"^\s*[:=\-]?\s*\(?\s*(no|n|absent|negative|nil|none|-)(?![a-z])", re.I)
NEG = re.compile(r"(?<![a-z])(no|not|without|negative for|denies|denied|absence of|free of|nor|ruled out)(?![a-z])", re.I)
CLAUSE_SPLIT = re.compile(r"[.;•·•]|\s{3,}|,\s+(?=[A-Z])")


def _clause_before(line: str, start: int) -> str:
    seg = CLAUSE_SPLIT.split(line[:start])[-1]
    return seg[-40:]


def _polarity(line: str, m: re.Match) -> int:
    after = line[m.end():m.end() + 20]
    if YES.match(after):
        return 1
    if NO.match(after):
        return 0
    return 0 if NEG.search(_clause_before(line, m.start())) else 1


@lru_cache(maxsize=1)
def _specs() -> dict[str, dict]:
    return {f["name"]: f for f in data.features()}


def _tidy(name: str, value: Any) -> Any:
    """Whole numbers become ints (61.0 -> 61); converted values keep one decimal (34.8 mg/dL)."""
    if isinstance(value, str) or _specs()[name]["type"] != "numeric":
        return value
    v = round(float(value), 2 if abs(value) < 10 else 1)
    return int(v) if v.is_integer() else v


def parse_lines(lines: list[str], source: str, method: str) -> list[Finding]:
    """Rule-based reading of report lines into findings (first occurrence per feature wins)."""
    conf = "high" if method == "text" else "medium"
    found: dict[str, Finding] = {}

    def add(name: str, value: Any, line: str, confidence: str = conf, note: str = "") -> None:
        value = _tidy(name, value)
        if name not in found:
            found[name] = Finding(name, value, line.strip()[:160], source, method, confidence, note)

    for raw in lines:
        line = raw.replace("\u00a0", " ")
        if not line.strip():
            continue
        if (m := BP.search(line)):
            add("bp", int(m.group(1)), line, note=f"systolic of {m.group(1)}/{m.group(2)} mmHg")
        if (m := AGE_OLD.search(line)):
            add("age", int(m.group(1)), line)
        if (m := SEX.search(line)) or (m := SEX_WORD.search(line)):
            add("sex_male", int(m.group(1).lower() in ("male", "m", "man", "gentleman")), line)
        for name, pat in NUMERIC.items():
            if name in found:
                continue
            for m in pat.finditer(line):
                nm = re.match(r"[^\d\n]{0,25}?" + NUM, line[m.end():])
                if not nm or re.search(r"[a-z]{3,}\s*[:=]", nm.group(0)[:-len(nm.group(1))], re.I):
                    continue  # no number, or the number belongs to a later label
                after = line[m.end() + nm.end():]
                if name == "ef_tte" and (rng := re.match(r"\s*[-–]\s*" + NUM, after)):
                    value = (_num(nm.group(1)) + _num(rng.group(1))) / 2
                    after = after[rng.end():]
                    note = f"midpoint of {nm.group(1)}–{rng.group(1)}"
                else:
                    value, note = _num(nm.group(1)), ""
                unit = _unit(after)
                if name in ("lymph", "neut") and unit and unit != "%":
                    continue  # absolute count, not the percentage the model uses
                conv = to_model_units(name, value, unit)
                if conv is None:
                    continue
                v, cnote, cconf = conv
                add(name, round(v, 2), line, conf if cconf == "high" else "low", "; ".join(x for x in (note, cnote) if x))
                break
        for name, pats in BINARY.items():
            for pat in pats:
                if name not in found and (m := pat.search(line)):
                    add(name, _polarity(line, m), line)
        for name, pat in CHEST_PAIN:
            if (m := pat.search(line)) and _polarity(line, m) == 1 and "typical_chest_pain" not in found:
                for other, _ in CHEST_PAIN:
                    add(other, int(other == name), line)
        if (m := ST_T.search(line)) and _polarity(line, m) == 0:
            for name in ("st_elevation", "st_depression", "t_inversion"):
                add(name, 0, line, note="from 'no ST-T changes'")
        if (m := BBB_LEFT.search(line)) and _polarity(line, m):
            add("bbb", "left", line)
        elif (m := BBB_RIGHT.search(line)) and _polarity(line, m):
            add("bbb", "right", line)
        elif (m := BBB_ANY.search(line)) and _polarity(line, m) == 0:
            add("bbb", "none", line)
        if NORMAL_R.search(line):
            add("poor_r_progression", 0, line)
        if (m := RWMA.search(line)):
            if _polarity(line, m) == 0:
                add("region_rwma", 0, line)
            elif (c := RWMA_COUNT.search(line)):
                add("region_rwma", min(4, int(c.group(1))), line)
            else:
                add("region_rwma", 1, line, "low", "abnormality reported without a region count: assumed 1")
        sev = [VHD_SCALE[s.lower()] for s in (v.group(1) for v in VALVE.finditer(line))]
        if sev:
            cur = found.get("vhd")
            if cur is None or max(sev) > cur.value:
                found.pop("vhd", None)
                add("vhd", max(sev), line, note="most severe valve finding")
        elif VALVE_NONE.search(line):
            add("vhd", 0, line)
    return list(found.values())


# ---------------------------------------------------------------- Claude vision (opt-in)

def claude_available() -> bool:
    if os.environ.get("CORONARYTWIN_CLAUDE_EXTRACT") != "1":
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")
                or os.environ.get("ANTHROPIC_PROFILE"))


def _claude_schema() -> dict:
    names = data.feature_names()
    return {
        "type": "object",
        "properties": {"values": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "feature": {"type": "string", "enum": names},
                "value": {"type": "string", "description": "number as written, or yes/no, or none/left/right for bbb"},
                "unit": {"type": "string", "description": "unit as written next to the value, empty if none"},
                "evidence": {"type": "string", "description": "the exact line of the document the value comes from"},
            },
            "required": ["feature", "value", "unit", "evidence"],
            "additionalProperties": False,
        }}},
        "required": ["values"],
        "additionalProperties": False,
    }


def _claude_prompt() -> str:
    rows = []
    for f in data.features():
        unit = f" [{f['unit']}]" if f.get("unit") else ""
        kind = {"binary": "yes/no", "categorical": "none/left/right", "ordinal": "integer"}.get(f["type"], "number")
        rows.append(f"- {f['name']}: {f['label']}{unit} ({kind})")
    return ("These are clinical reports for one patient. Extract only values that are explicitly written in them, "
            "for the fields below. Report a finding as 'no' only when the document states it is absent "
            "(e.g. 'no ST elevation'). Do not infer, estimate or fill in anything that is not written. "
            "Give the value and its unit exactly as written; unit conversion is done afterwards. For bp give the "
            "systolic value. For vhd give 0-3 (none, mild, moderate, severe; the most severe valve). For region_rwma "
            "give the number of regions with wall-motion abnormality. Skip function_class.\n\nFields:\n" + "\n".join(rows))


def claude_extract(files: list[tuple[str, bytes]], client: Any = None) -> list[Finding]:
    import anthropic
    client = client or anthropic.Anthropic()
    content: list[dict] = []
    for name, b in files:
        kind = _kind(b, name)
        b64 = base64.standard_b64encode(b).decode("ascii")
        if kind == "pdf":
            content.append({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
                            "title": name})
        elif kind in IMAGE_TYPES:
            content.append({"type": "image", "source": {"type": "base64", "media_type": IMAGE_TYPES[kind], "data": b64}})
        elif kind == "text":
            content.append({"type": "text", "text": f"<document name={json.dumps(name)}>\n{b.decode('utf-8')}\n</document>"})
    content.append({"type": "text", "text": _claude_prompt()})
    resp = client.beta.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": _claude_schema()}},
        messages=[{"role": "user", "content": content}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("Claude declined to read these documents.")
    text = next((blk.text for blk in resp.content if blk.type == "text"), "")
    out = json.loads(text) if text else {"values": []}
    return normalize_claims(out["values"], source=", ".join(n for n, _ in files))


def normalize_claims(values: list[dict], source: str, method: str = "claude") -> list[Finding]:
    """Structured claims (feature, value, unit, evidence) -> findings, with the same unit conversion
    and validation as the rule-based reader. Unparseable or out-of-range claims are dropped."""
    specs, out, seen = _specs(), [], set()
    for c in values:
        name, raw = c.get("feature"), str(c.get("value", "")).strip()
        spec = specs.get(name)
        if spec is None or name in seen or name == "function_class" or not raw:
            continue
        ev, note = str(c.get("evidence", ""))[:160], ""
        if spec["type"] == "binary":
            low = raw.lower()
            v: Any = 1 if low in ("yes", "y", "1", "true", "present", "positive", "male", "m") else \
                0 if low in ("no", "n", "0", "false", "absent", "negative", "female", "f") else None
        elif spec["type"] == "categorical":
            v = {"none": "none", "no": "none", "n": "none", "left": "left", "lbbb": "left",
                 "right": "right", "rbbb": "right"}.get(raw.lower())
        else:
            m = re.search(NUM, raw)
            if not m:
                continue
            conv = to_model_units(name, _num(m.group(1)), _unit(str(c.get("unit", "")) or raw[m.end():]))
            if conv is None:
                continue
            v, note = _tidy(name, conv[0]), conv[1]
            if spec["type"] == "ordinal":
                v = int(round(v))
        if v is None:
            continue
        seen.add(name)
        out.append(Finding(name, v, ev, source, method, "medium", note))
    return out


# ---------------------------------------------------------------- entry point

def extract(files: list[tuple[str, bytes]], use_claude: bool = False,
            claude: Callable[[list[tuple[str, bytes]]], list[Finding]] | None = None) -> dict:
    """[(filename, bytes)] -> {"findings": [...], "warnings": [...], "files": [...]}."""
    res = Result()
    if not files:
        raise ValueError("No files uploaded.")
    if len(files) > MAX_FILES:
        raise ValueError(f"At most {MAX_FILES} files per upload.")
    for name, b in files:
        if len(b) > MAX_FILE_BYTES:
            raise ValueError(f"{name}: larger than {MAX_FILE_BYTES // (1024 * 1024)} MB.")

    per_file: list[list[Finding]] = []
    if use_claude:
        found = (claude or claude_extract)(files)
        per_file.append(found)
        res.files = [{"name": n, "method": "claude", "lines": None, "found": None} for n, _ in files]
    else:
        for name, b in files:
            try:
                lines, method = read_file(b, name)
            except Exception as e:
                res.warnings.append(f"{name}: {e}")
                res.files.append({"name": name, "method": None, "lines": 0, "found": 0})
                continue
            fs = parse_lines(lines, name, method)
            per_file.append(fs)
            res.files.append({"name": name, "method": method, "lines": len(lines), "found": len(fs)})
            if not lines:
                res.warnings.append(f"{name}: no readable text found.")

    labels = {f["name"]: f["label"] for f in data.features()}
    merged: dict[str, Finding] = {}
    for fs in per_file:
        for f in fs:
            prev = merged.get(f.name)
            if prev is None:
                merged[f.name] = f
            elif prev.value != f.value:
                res.warnings.append(f"{labels[f.name]}: {prev.source} says {prev.value}, {f.source} says {f.value}. "
                                    f"The first is proposed; check which is current.")
    order = {n: i for i, n in enumerate(data.feature_names())}
    res.findings = sorted(merged.values(), key=lambda f: order[f.name])
    return {"findings": [asdict(f) for f in res.findings], "warnings": res.warnings, "files": res.files,
            "claude_used": bool(use_claude), "stored": False}


def capabilities() -> dict:
    ocr = False
    if not ocr_disabled():
        try:
            import rapidocr  # noqa: F401
            ocr = True
        except ImportError:
            pass
    try:
        import pypdf  # noqa: F401
        pdf = True
    except ImportError:
        pdf = False
    return {"ocr": ocr, "pdf": pdf, "claude": claude_available(), "claude_model": CLAUDE_MODEL,
            "max_files": MAX_FILES, "max_file_mb": MAX_FILE_BYTES // (1024 * 1024)}
