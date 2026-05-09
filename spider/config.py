"""Static configuration: paths, host, model, demo slice."""
from __future__ import annotations

from pathlib import Path

# --- Site ---------------------------------------------------------------
HOST = "https://www.service.nsw.gov.au"
SITEMAP_URL = f"{HOST}/sitemap.xml"
USER_AGENT = (
    "ServiceNSWCorpusBot/0.1 "
    "(+https://github.com/local/service-nsw-corpus; demo chatbot dataset)"
)

# robots.txt Disallow paths we honour. Anything under these is skipped.
ROBOTS_DISALLOW_PREFIXES: tuple[str, ...] = (
    "/core/",
    "/profiles/",
    "/admin/",
    "/comment/reply/",
    "/filter/tips/",
    "/node/add/",
    "/search/",
    "/search-results",
    "/user/register/",
    "/user/password/",
    "/user/login/",
    "/user/logout/",
    "/index.php/",
    "/error.html",
    "/service-centre/wauchope-service-centre",
    "/README.txt",
    "/web.config",
)

# --- LLM ----------------------------------------------------------------
OLLAMA_MODEL = "gemma4:e4b"
OLLAMA_HOST = "http://127.0.0.1:11434"
# A 26B Q4 model can take a minute or two to cold-load; we keep a roomy
# timeout to avoid spurious failures on the first call. Subsequent calls
# are typically 5-30 s once the model is resident.
OLLAMA_TIMEOUT_S = 900
OLLAMA_NUM_CTX = 8192

# --- Politeness ---------------------------------------------------------
DEFAULT_FETCH_WORKERS = 4
DEFAULT_ENRICH_WORKERS = 2
FETCH_DELAY_S = 0.4
FETCH_TIMEOUT_S = 30
FETCH_RETRIES = 3

# --- Paths --------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CACHE_DIR = ROOT / "cache"
CORPUS_DIR = ROOT / "corpus"

URLS_FILE = DATA_DIR / "urls.jsonl"
RAW_DIR = CACHE_DIR / "raw"
META_DIR = CACHE_DIR / "meta"
PARSED_DIR = DATA_DIR / "parsed"
ENRICHED_DIR = DATA_DIR / "enriched"

for _d in (DATA_DIR, CACHE_DIR, CORPUS_DIR, RAW_DIR, META_DIR, PARSED_DIR, ENRICHED_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# --- Categorisation -----------------------------------------------------
# Map first-segment prefixes to categories. Anything not listed becomes
# "other" and is excluded from the high_value scope.
HIGH_VALUE_CATEGORIES: tuple[str, ...] = (
    "transaction",
    "guide",
    "services",
    "business",
    "common-questions",
)

# --- Demo slice ---------------------------------------------------------
# All /guide/ pages are included automatically. Plus this curated set of
# transaction slugs, matched as case-insensitive substrings against the
# slug portion of the URL. We deliberately use substrings (not exact
# slugs) so the demo is robust to minor URL changes upstream.
#
# If a substring matches multiple URLs, all of them are included; if a
# substring matches none, `discover` warns but does not fail.
DEMO_TRANSACTION_SLUG_PATTERNS: tuple[str, ...] = (
    # Driver licences
    "renew-or-upgrade-a-nsw-driver-licence",
    "replace-a-nsw-driver-licence-online",
    "apply-for-a-learner-driver-licence",
    "apply-for-a-provisional-p1-driver-licence",
    "request-a-driving-record",
    "transfer-an-interstate-driver-licence",
    "transfer-an-overseas-driver-licence",
    "register-a-change-of-name",
    # Vehicle registration
    "renew-a-vehicle-registration",
    "transfer-a-vehicle-registration",
    "cancel-vehicle-registration-within-nsw",
    "check-a-vehicle-registration",
    "replace-number-plates",
    "digital-vehicle-registration",
    # Fines
    "pay-a-fine",
    "pay-an-overdue-fine",
    "request-a-review-for-a-fine",
    "apply-for-a-payment-plan-for-a-fine",
    "apply-to-go-to-court-for-a-fine",
    "nominate-someone-else-for-a-fine",
    # Births, deaths, marriages
    "apply-for-a-birth-certificate",
    "apply-for-a-death-certificate",
    "apply-for-a-marriage-certificate",
    "notice-of-intended-marriage-application",
    "register-a-birth",
    # Cards & checks
    "apply-for-a-nsw-seniors-card-or-nsw-senior-savers-card",
    "apply-for-a-nsw-photo-card",
    "replace-a-photocard",
    "apply-for-a-working-with-children-check",
    # Boating & recreation
    "apply-for-a-general-boat-driving-licence",
    "apply-for-a-recreational-fishing-licence-1-year-or-3-year",
    # Vouchers / rebates
    "apply-for-an-active-and-creative-kids-voucher",
    "apply-for-the-seniors-energy-rebate",
    "claim-the-toll-relief-cap",
)
