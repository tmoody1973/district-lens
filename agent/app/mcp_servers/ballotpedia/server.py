"""
Ballotpedia MCP Server
======================
A Model Context Protocol server that provides tools for fetching and parsing
election, candidate, and ballot measure data from Ballotpedia.

Compatible with Claude Desktop and Claude Code for agentic research workflows.
"""

import asyncio
import os
import re
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import quote, urlencode

import httpx
from bs4 import BeautifulSoup
from mcp.server.fastmcp import FastMCP

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ballotpedia-mcp")

# ── Server init ───────────────────────────────────────────────────────────────
mcp = FastMCP(
    "ballotpedia",
    instructions=(
        "Use this server to research U.S. elections, candidates, and ballot measures "
        "from Ballotpedia. Tools are available to look up ballots by zip code, search "
        "for candidates, retrieve candidate platform summaries, and list ballot measures "
        "by state or year. Prefer `get_ballot_by_zip` for voter-facing research, and "
        "`summarize_candidate_platform` for deep candidate research."
    ),
)

# ── HTTP helpers ──────────────────────────────────────────────────────────────
BASE_URL = "https://ballotpedia.org"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}
TIMEOUT = httpx.Timeout(20.0, connect=10.0)


FETCH_RETRIES = 3
RETRY_BACKOFF_SECONDS = 1.5
_FIRECRAWL_SCRAPE_ENDPOINT = "https://api.firecrawl.dev/v2/scrape"
FIRECRAWL_TIMEOUT = httpx.Timeout(60.0, connect=10.0)

# ── Optional Mongo HTML cache ─────────────────────────────────────────────────
# When MONGODB_URI is set (running inside the DistrictLens agent), cache fetched
# HTML so repeat Ballotpedia lookups skip the Firecrawl stealth fallback (~5
# credits + seconds each). Gated + lazy-imported so the standalone server (Claude
# Desktop, no Mongo/pymongo) behaves exactly as before.
_CACHE_DB_NAME = "districtlens"
_CACHE_COLLECTION_NAME = "ballotpedia_page_cache"
_CACHE_TTL_DAYS = int(os.environ.get("BALLOTPEDIA_CACHE_TTL_DAYS", "7"))
_CACHE_DEFAULT = object()  # sentinel meaning "resolve the real cache collection"
_page_cache_client: Any = None


def _page_cache_collection() -> Any:
    """Return the Mongo cache collection, or None when caching is unavailable."""
    global _page_cache_client
    uri = os.environ.get("MONGODB_URI", "")
    if not uri:
        return None
    try:
        import pymongo
    except ImportError:
        return None
    try:
        if _page_cache_client is None:
            _page_cache_client = pymongo.MongoClient(uri, serverSelectionTimeoutMS=3000)
        return _page_cache_client[_CACHE_DB_NAME][_CACHE_COLLECTION_NAME]
    except Exception as exc:
        logger.warning("Ballotpedia page cache unavailable: %s", exc)
        return None


def _cache_is_fresh(fetched_at: datetime, now: datetime) -> bool:
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    return (now - fetched_at) < timedelta(days=_CACHE_TTL_DAYS)


async def _cache_get(url: str, *, collection: Any) -> str | None:
    """Return fresh cached HTML for url, or None on miss/stale/error."""
    if collection is None:
        return None
    try:
        doc = await asyncio.to_thread(collection.find_one, {"url": url})
    except Exception as exc:
        logger.warning("Ballotpedia cache read failed for %s: %s", url, exc)
        return None
    if not doc or not doc.get("html") or not doc.get("fetched_at"):
        return None
    if not _cache_is_fresh(doc["fetched_at"], datetime.now(timezone.utc)):
        return None
    return doc["html"]


async def _cache_put(url: str, html: str, *, collection: Any) -> None:
    """Upsert fetched HTML into the cache; best-effort (never raises)."""
    if collection is None or not html:
        return
    try:
        await asyncio.to_thread(
            collection.update_one,
            {"url": url},
            {"$set": {"url": url, "html": html, "fetched_at": datetime.now(timezone.utc)}},
            upsert=True,
        )
    except Exception as exc:
        logger.warning("Ballotpedia cache write failed for %s: %s", url, exc)


async def _fetch_via_firecrawl(url: str, *, post: Any = None) -> str | None:
    """Fetch a page through Firecrawl's stealth proxy, returning rawHtml or None.

    Used as a fallback when a direct request is bot-challenged. Firecrawl runs a
    real browser through residential proxies, which clears Ballotpedia's Cloudflare
    challenge. We request `rawHtml` (not the cleaned `html`, which strips the
    MediaWiki structure the parsers rely on). Returns None — never raises — when
    the key is unset, the call errors, or the body is unusable, so the caller can
    surface one honest failure. Never logs the API key.
    """
    api_key = os.environ.get("FIRECRAWL_API_KEY", "")
    if not api_key:
        return None

    body = {"url": url, "formats": ["rawHtml"], "proxy": "stealth"}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        if post is not None:
            response = await post(_FIRECRAWL_SCRAPE_ENDPOINT, json=body, headers=headers)
        else:
            async with httpx.AsyncClient(timeout=FIRECRAWL_TIMEOUT) as client:
                response = await client.post(
                    _FIRECRAWL_SCRAPE_ENDPOINT, json=body, headers=headers
                )
    except Exception as exc:  # transport/timeout — degrade to None
        logger.warning("Firecrawl fallback error for %s: %s", url, exc)
        return None

    if response.status_code // 100 != 2:
        logger.warning(
            "Firecrawl fallback non-2xx for %s (status=%d)", url, response.status_code
        )
        return None
    try:
        payload = response.json()
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or payload.get("success") is not True:
        return None
    raw_html = (payload.get("data") or {}).get("rawHtml") or ""
    if not raw_html:
        return None
    logger.info("Firecrawl stealth fallback succeeded for %s", url)
    return raw_html


async def _fetch_html(
    url: str,
    params: dict | None,
    *,
    transport: httpx.AsyncBaseTransport | None,
    firecrawl_post: Any,
) -> str:
    """Return page HTML via a direct request, falling back to Firecrawl stealth.

    Ballotpedia fronts pages with Cloudflare, which answers datacenter IPs (Cloud
    Run) with an HTTP 202 bot-challenge. raise_for_status() ignores 202, so we'd
    silently parse the challenge page. Retry non-200, then fall back to Firecrawl
    (real browser + residential IPs). Raise only if both paths fail.
    """
    async with httpx.AsyncClient(
        headers=HEADERS, timeout=TIMEOUT, follow_redirects=True, transport=transport
    ) as client:
        response = None
        for attempt in range(FETCH_RETRIES):
            response = await client.get(url, params=params)
            if response.status_code == 200:
                return response.text
            if attempt < FETCH_RETRIES - 1:
                await asyncio.sleep(RETRY_BACKOFF_SECONDS * (attempt + 1))

    # Direct fetch stayed non-200 (e.g. the 202 challenge). Pay for Firecrawl
    # stealth only now, on the full URL including any query params.
    firecrawl_url = f"{url}?{urlencode(params)}" if params else url
    raw_html = await _fetch_via_firecrawl(firecrawl_url, post=firecrawl_post)
    if raw_html is not None:
        return raw_html

    # Both paths failed — raise so the caller returns an honest error.
    response.raise_for_status()
    raise httpx.HTTPStatusError(
        f"Ballotpedia returned HTTP {response.status_code} (likely a bot "
        f"challenge) for {url}; Firecrawl fallback also failed",
        request=response.request,
        response=response,
    )


async def fetch_page(
    url: str,
    params: dict | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    firecrawl_post: Any = None,
    cache_collection: Any = _CACHE_DEFAULT,
) -> BeautifulSoup:
    """Fetch a Ballotpedia page (cached) and return a BeautifulSoup object.

    Reads an optional Mongo HTML cache first — so repeat lookups skip the Firecrawl
    fallback entirely — then fetches direct → Firecrawl on a miss and writes the
    result back. Pass cache_collection=None to bypass the cache.
    """
    cache_url = f"{url}?{urlencode(params)}" if params else url
    collection = (
        _page_cache_collection()
        if cache_collection is _CACHE_DEFAULT
        else cache_collection
    )

    cached = await _cache_get(cache_url, collection=collection)
    if cached is not None:
        return BeautifulSoup(cached, "html.parser")

    html = await _fetch_html(
        url, params, transport=transport, firecrawl_post=firecrawl_post
    )
    await _cache_put(cache_url, html, collection=collection)
    return BeautifulSoup(html, "html.parser")


def clean_text(text: str) -> str:
    """Normalise whitespace in extracted text."""
    return re.sub(r"\s+", " ", text).strip()


def soup_section_text(soup: BeautifulSoup, heading: str, max_chars: int = 2000) -> str:
    """Extract text from the section that follows a given heading."""
    for tag in soup.find_all(["h2", "h3", "h4"]):
        if heading.lower() in tag.get_text().lower():
            texts = []
            for sibling in tag.find_next_siblings():
                if sibling.name in ["h2", "h3", "h4"]:
                    break
                texts.append(clean_text(sibling.get_text()))
            combined = " ".join(t for t in texts if t)
            return combined[:max_chars]
    return ""


# Ballotpedia frames the Endorsements section with boilerplate we must strip:
# an intro ("X received the following endorsements.") and a call-to-action
# ("To send us additional endorsements, click here."). Remove those phrases
# explicitly (NOT by splitting on every period — that would break org names like
# "U.S. Chamber of Commerce").
_ENDORSE_INTRO = re.compile(
    r".*?received the following endorsements\.?\s*", re.IGNORECASE | re.DOTALL
)
_ENDORSE_INSTRUCTION = re.compile(
    r"to send us additional endorsements,?\s*click here\.?\s*", re.IGNORECASE
)
_ENDORSE_LEFTOVER = re.compile(
    r"click here|send us|received the following|see also|submit|^note\b",
    re.IGNORECASE,
)


def _parse_endorsements(section_text: str) -> list[str]:
    """Extract endorsement names from the Endorsements section text.

    Strips Ballotpedia's intro/instruction boilerplate, then splits the remainder
    on list delimiters (not periods, to preserve abbreviated org names).
    """
    if not section_text:
        return []
    text = _ENDORSE_INTRO.sub("", section_text)
    text = _ENDORSE_INSTRUCTION.sub("", text)
    names: list[str] = []
    for segment in re.split(r"[•·\n;]", text):
        name = clean_text(segment).rstrip(".").strip()
        if name and not _ENDORSE_LEFTOVER.search(name):
            names.append(name)
    return names[:15]


# ── Shared lookup: 2-letter state abbreviation → full state name ──────────────
STATE_ABBREVS = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}


def normalize_state(state: str) -> str:
    """Expand a 2-letter abbreviation to a full state name; pass full names through."""
    if not state:
        return ""
    return STATE_ABBREVS.get(state.strip().upper(), state.strip())


# ── Tool 1: Ballot lookup by zip code ────────────────────────────────────────
@mcp.tool()
async def get_ballot_by_zip(
    zip_code: str,
    state: str = "",
) -> dict[str, Any]:
    """
    Retrieve upcoming ballot information for a given U.S. zip code.

    Fetches current and upcoming elections, candidates, and ballot measures
    relevant to the provided zip code by querying Ballotpedia's sample ballot
    lookup and associated state election pages.

    Args:
        zip_code: 5-digit U.S. zip code (e.g. "53202")
        state:    Optional 2-letter state abbreviation to narrow results (e.g. "WI")

    Returns:
        A dict with keys:
          - zip_code: str
          - state_elections: list of dicts with title, url, date, office_type
          - ballot_measures: list of dicts with title, state, type, description, url
          - sources: list of URLs consulted
    """
    zip_code = zip_code.strip()
    if not re.fullmatch(r"\d{5}", zip_code):
        return {"error": f"Invalid zip code format: '{zip_code}'. Must be 5 digits."}

    # Map zip → state if not provided
    ZIP_STATE_MAP = {
        "53": "Wisconsin", "60": "Illinois", "55": "Minnesota",
        "48": "Michigan", "46": "Indiana", "43": "Ohio",
        "10": "New York", "90": "California", "77": "Texas",
        "30": "Georgia", "33": "Florida", "98": "Washington",
        "97": "Oregon", "80": "Colorado", "85": "Arizona",
        "70": "Louisiana", "28": "North Carolina", "20": "Maryland",
        "19": "Pennsylvania", "02": "Massachusetts",
    }
    prefix2 = zip_code[:2]
    derived_state = normalize_state(state) or ZIP_STATE_MAP.get(prefix2, "")

    sources: list[str] = []
    state_elections: list[dict] = []
    ballot_measures: list[dict] = []

    # ── Fetch state-level election index ──────────────────────────────────────
    year = 2026  # current cycle
    if derived_state:
        state_slug = derived_state.replace(" ", "_")
        elections_url = f"{BASE_URL}/{state_slug}_elections,_{year}"
        try:
            soup = await fetch_page(elections_url)
            sources.append(elections_url)

            # Parse election links from the page
            content_div = soup.find("div", {"id": "mw-content-text"})
            if content_div:
                for link in content_div.find_all("a", href=True):
                    href = link["href"]
                    text = clean_text(link.get_text())
                    if (
                        str(year) in href
                        and derived_state.split()[0] in href
                        and len(text) > 5
                        and text not in [e["title"] for e in state_elections]
                    ):
                        full_url = BASE_URL + href if href.startswith("/") else href
                        state_elections.append({
                            "title": text,
                            "url": full_url,
                            "date": "",
                            "office_type": _classify_office(text),
                        })
        except httpx.HTTPStatusError as e:
            logger.warning("State elections page not found: %s", e)
        except Exception as e:
            logger.error("Error fetching state elections: %s", e)

    # ── Fetch ballot measures for derived state ───────────────────────────────
    if derived_state:
        measures_url = f"{BASE_URL}/{year}_ballot_measures"
        try:
            soup = await fetch_page(measures_url)
            sources.append(measures_url)

            # Find state section
            for h2 in soup.find_all(["h2", "h3"]):
                if derived_state in h2.get_text():
                    for sibling in h2.find_next_siblings():
                        if sibling.name in ["h2", "h3"]:
                            break
                        if sibling.name == "table":
                            rows = sibling.find_all("tr")[1:]  # skip header
                            for row in rows:
                                cols = row.find_all(["td", "th"])
                                if len(cols) >= 2:
                                    title_td = cols[0]
                                    title_link = title_td.find("a")
                                    title = clean_text(title_td.get_text())
                                    measure_url = ""
                                    if title_link and title_link.get("href"):
                                        href = title_link["href"]
                                        measure_url = BASE_URL + href if href.startswith("/") else href
                                    mtype = clean_text(cols[1].get_text()) if len(cols) > 1 else ""
                                    desc = clean_text(cols[2].get_text()) if len(cols) > 2 else ""
                                    ballot_measures.append({
                                        "title": title,
                                        "state": derived_state,
                                        "type": mtype,
                                        "description": desc,
                                        "url": measure_url,
                                    })
        except Exception as e:
            logger.warning("Could not fetch ballot measures: %s", e)

    return {
        "zip_code": zip_code,
        "derived_state": derived_state,
        "state_elections": state_elections[:20],
        "ballot_measures": ballot_measures,
        "sources": sources,
        "note": (
            "Ballotpedia's sample ballot tool requires address-level geocoding; "
            "results here are state-level. For a full personalized ballot, visit "
            f"https://ballotpedia.org/Sample_Ballot_Lookup and enter your address."
        ),
    }


def _page_exists(soup: BeautifulSoup) -> bool:
    """False if this is a MediaWiki 'no such page' (redlink) page.

    Ballotpedia echoes the requested title in <h1> even for non-existent pages, so
    the title can't tell real from missing — but a missing page carries a
    `noarticletext` block. (Verified live: fake names render that block, ~5KB;
    real candidate pages don't, ~130KB.)
    """
    return soup.find(class_="noarticletext") is None


def _normalize_party(party: str) -> str:
    """Map a Ballotpedia party string to the DEM/REP/IND codes the cards color."""
    lowered = party.lower()
    if "democratic" in lowered:
        return "DEM"
    if "republican" in lowered:
        return "REP"
    if "independent" in lowered:
        return "IND"
    return party


_PARTY_RE = re.compile(r"\((\w[\w\s]*Party)\)")
_OFFICE_PATTERNS = [
    ("U.S. Senate", ["u.s. senate", "united states senate"]),
    ("U.S. House", ["u.s. house", "house of representatives", "member of congress"]),
    ("Governor", ["governor"]),
    ("State Senate", ["state senate"]),
    ("State Assembly", ["state assembly", "state house"]),
    ("Mayor", ["mayor"]),
]


def _office_from_text(text: str) -> str:
    lowered = text.lower()
    for label, patterns in _OFFICE_PATTERNS:
        if any(pattern in lowered for pattern in patterns):
            return label
    return ""


def _candidate_from_profile_page(
    soup: BeautifulSoup, name: str, url: str, state: str
) -> dict:
    """Build a candidate record from a Ballotpedia person page's intro paragraphs."""
    title_tag = soup.find("h1", {"id": "firstHeading"})
    page_name = clean_text(title_tag.get_text()) if title_tag else name

    party = ""
    office = ""
    snippet = ""
    content = soup.find("div", {"id": "mw-content-text"})
    if content:
        for paragraph in content.find_all("p", limit=4):
            text = clean_text(paragraph.get_text())
            if len(text) <= 30:
                continue
            if not snippet:
                snippet = text
            if not party:
                match = _PARTY_RE.search(text)
                if match:
                    party = _normalize_party(match.group(1))
            if not office:
                office = _office_from_text(text)

    return {
        "name": page_name,
        "url": url,
        "party": party,
        "office": office,
        "state": state,
        "status": "found",
        "snippet": snippet[:300],
    }


def _classify_office(title: str) -> str:
    title_lower = title.lower()
    federal = (
        "u.s." in title_lower
        or "federal" in title_lower
        or "united states" in title_lower
        or "congress" in title_lower
    )
    if "senate" in title_lower and federal:
        return "U.S. Senate"
    if ("house" in title_lower or "representative" in title_lower) and federal:
        return "U.S. House"
    # State chambers must be matched before the generic house/senate fallbacks so
    # "State House" isn't misread as the U.S. House.
    if "assembly" in title_lower or "state house" in title_lower or "state rep" in title_lower:
        return "State Assembly"
    if "senate" in title_lower:
        return "State Senate"
    if "house" in title_lower or "representative" in title_lower:
        return "U.S. House"
    if "governor" in title_lower or "gubernatorial" in title_lower:
        return "Governor"
    if "ballot measure" in title_lower or "amendment" in title_lower or "proposition" in title_lower:
        return "Ballot Measure"
    if "school board" in title_lower:
        return "School Board"
    if "mayor" in title_lower:
        return "Mayor"
    return "Election"


# ── Tool 2: Search candidates ─────────────────────────────────────────────────
@mcp.tool()
async def search_candidates(
    name: str = "",
    state: str = "",
    office: str = "",
    year: int = 2026,
) -> dict[str, Any]:
    """
    Search Ballotpedia for candidates by name, state, office, and/or election year.

    At least one of `name`, `state`, or `office` must be provided.

    Args:
        name:   Candidate name or partial name (e.g. "Johnson", "Tony Evers")
        state:  Full state name or 2-letter abbreviation (e.g. "Wisconsin" or "WI")
        office: Office type to filter by (e.g. "Governor", "Senate", "House")
        year:   Election year (default 2026)

    Returns:
        A dict with:
          - query: dict of search parameters used
          - candidates: list of dicts with name, url, office, party, state, status
          - sources: list of URLs consulted
    """
    if not any([name, state, office]):
        return {"error": "Provide at least one of: name, state, or office."}

    state_full = normalize_state(state)

    candidates: list[dict] = []
    sources: list[str] = []

    # Strategy 1: Direct-name resolution.
    # Ballotpedia runs a customized MediaWiki with NO scrapeable search (its
    # /w/index.php?search, Special:Search, and api.php endpoints don't return
    # usable results). So resolve the name straight to its page and verify the
    # page exists — a redlink page means "no such candidate".
    if name:
        candidate_url = f"{BASE_URL}/{quote(name.replace(' ', '_'))}"
        try:
            soup = await fetch_page(candidate_url)
            sources.append(candidate_url)
            if _page_exists(soup):
                candidates.append(
                    _candidate_from_profile_page(soup, name, candidate_url, state_full)
                )
        except Exception as e:
            logger.warning("Candidate name lookup failed for %s: %s", name, e)

    # Strategy 2: State election page candidate tables
    if state_full and (office or not name):
        office_slug_map = {
            "governor": f"{state_full}_gubernatorial_election,_{year}",
            "senate": f"{state_full}_State_Senate_elections,_{year}",
            "house": f"{state_full}_State_Assembly_elections,_{year}",
            "u.s. senate": f"United_States_Senate_election_in_{state_full},_{year}",
            "u.s. house": f"United_States_House_of_Representatives_elections_in_{state_full},_{year}",
        }
        slugs_to_try = []
        office_lower = office.lower() if office else ""
        if office_lower:
            for key, slug in office_slug_map.items():
                if key in office_lower or office_lower in key:
                    slugs_to_try.append(slug)
        if not slugs_to_try:
            # Try generic state elections page
            slugs_to_try = [f"{state_full.replace(' ', '_')}_elections,_{year}"]

        for slug in slugs_to_try[:2]:
            url = f"{BASE_URL}/{slug.replace(' ', '_')}"
            try:
                soup = await fetch_page(url)
                sources.append(url)
                extracted = _extract_candidates_from_election_page(soup, state_full, year)
                for c in extracted:
                    if c["name"] not in [x["name"] for x in candidates]:
                        candidates.append(c)
            except Exception as e:
                logger.warning("State election page %s failed: %s", url, e)

    # Filter by name if both name and state were given
    if name and candidates:
        name_lower = name.lower()
        filtered = [c for c in candidates if name_lower in c["name"].lower()]
        candidates = filtered if filtered else candidates

    return {
        "query": {"name": name, "state": state_full, "office": office, "year": year},
        "candidates": candidates[:20],
        "sources": sources,
    }


def _extract_candidates_from_election_page(
    soup: BeautifulSoup, state: str, year: int
) -> list[dict]:
    """Parse candidate tables from a Ballotpedia election overview page."""
    candidates = []
    # Look for wikitable with candidate rows
    for table in soup.find_all("table", {"class": re.compile(r"wikitable", re.I)}):
        headers = [clean_text(th.get_text()) for th in table.find_all("th")]
        if not any(h in headers for h in ["Democratic", "Republican", "Candidate", "Office"]):
            continue
        for row in table.find_all("tr")[1:]:
            cols = row.find_all(["td", "th"])
            if not cols:
                continue
            for i, col in enumerate(cols):
                for link in col.find_all("a", href=True):
                    candidate_name = clean_text(link.get_text())
                    href = link["href"]
                    if not candidate_name or len(candidate_name) < 3:
                        continue
                    # Heuristic: candidate links point to /FirstName_LastName pages
                    if re.match(r"^/[A-Z][a-z]+_[A-Z]", href):
                        party = headers[i] if i < len(headers) else ""
                        candidates.append({
                            "name": candidate_name,
                            "url": BASE_URL + href,
                            "party": party,
                            "state": state,
                            "office": "",
                            "status": "from_election_page",
                        })
    return candidates


# ── Tool 3: Candidate platform summary ───────────────────────────────────────
@mcp.tool()
async def summarize_candidate_platform(
    candidate_name: str,
    candidate_url: str = "",
) -> dict[str, Any]:
    """
    Retrieve and summarise a candidate's platform, bio, key votes, and campaign themes
    from their Ballotpedia profile page.

    Args:
        candidate_name: Full name of the candidate (e.g. "Tony Evers")
        candidate_url:  Direct Ballotpedia URL (optional; auto-derived from name if omitted)

    Returns:
        A dict with:
          - name: str
          - url: str
          - party: str
          - office: str
          - state: str
          - bio: str
          - campaign_themes: str (platform statements and survey responses)
          - key_votes: list of dicts with bill, position, description
          - election_history: list of dicts with year, office, result
          - endorsements: list of str
          - committee_assignments: list of str
          - contact: dict with website, email, social
          - source: str (URL used)
    """
    if not candidate_url:
        slug = candidate_name.strip().replace(" ", "_")
        candidate_url = f"{BASE_URL}/{quote(slug)}"

    try:
        soup = await fetch_page(candidate_url)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            # Try search fallback
            result = await search_candidates(name=candidate_name)
            hits = result.get("candidates", [])
            if hits and hits[0].get("url"):
                candidate_url = hits[0]["url"]
                try:
                    soup = await fetch_page(candidate_url)
                except Exception as e2:
                    return {"error": f"Could not load page for '{candidate_name}': {e2}"}
            else:
                return {"error": f"No Ballotpedia page found for '{candidate_name}'."}
        else:
            return {"error": f"HTTP {e.response.status_code} fetching '{candidate_url}'."}
    except Exception as e:
        return {"error": f"Network error: {e}"}

    # ── Extract page title ────────────────────────────────────────────────────
    title_tag = soup.find("h1", {"id": "firstHeading"})
    name = clean_text(title_tag.get_text()) if title_tag else candidate_name

    # ── Extract intro / bio paragraph ─────────────────────────────────────────
    intro_section = soup.find("div", {"id": "mw-content-text"})
    bio = ""
    party = ""
    office = ""
    state = ""

    if intro_section:
        first_paras = intro_section.find_all("p", limit=4)
        bio_parts = []
        for p in first_paras:
            text = clean_text(p.get_text())
            if text and len(text) > 30:
                bio_parts.append(text)
                # Parse party / office / state from first paragraph
                if not party:
                    m = re.search(r"\((\w[\w\s]*Party)\)", text)
                    if m:
                        party = m.group(1)
                if not office:
                    for keyword in ["Senator", "Representative", "Governor", "Mayor", "Assembly"]:
                        if keyword in text:
                            office = keyword
                            break
                if not state:
                    state_match = re.search(
                        r"\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|"
                        r"Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|"
                        r"Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|"
                        r"Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|"
                        r"New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|"
                        r"Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|"
                        r"Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b",
                        text,
                    )
                    if state_match:
                        state = state_match.group(1)
        bio = " ".join(bio_parts)[:2500]

    # ── Campaign themes / platform ────────────────────────────────────────────
    campaign_themes = soup_section_text(soup, "Campaign themes", max_chars=3000)
    if not campaign_themes:
        campaign_themes = soup_section_text(soup, "Candidate Connection", max_chars=3000)
    if not campaign_themes:
        campaign_themes = soup_section_text(soup, "Campaign website", max_chars=2000)

    # ── Key votes ─────────────────────────────────────────────────────────────
    key_votes: list[dict] = []
    for h in soup.find_all(["h2", "h3"]):
        if "key votes" in h.get_text().lower():
            for sibling in h.find_next_siblings():
                if sibling.name in ["h2", "h3"]:
                    break
                if sibling.name == "table":
                    rows = sibling.find_all("tr")
                    headers = [clean_text(th.get_text()) for th in rows[0].find_all("th")] if rows else []
                    for row in rows[1:]:
                        cols = [clean_text(td.get_text()) for td in row.find_all("td")]
                        if cols:
                            vote_dict: dict[str, str] = {}
                            for i, h_name in enumerate(headers):
                                if i < len(cols):
                                    vote_dict[h_name.lower().replace(" ", "_")] = cols[i]
                            if vote_dict:
                                key_votes.append(vote_dict)
            break

    # ── Election history ──────────────────────────────────────────────────────
    election_history: list[dict] = []
    for h in soup.find_all(["h2", "h3"]):
        if h.get_text().strip().lower() in ["elections", "full history"]:
            for sibling in h.find_next_siblings():
                if sibling.name in ["h2", "h3"]:
                    break
                text = clean_text(sibling.get_text())
                # Heuristic: lines like "Nov. 5, 2024 — won election..."
                for match in re.finditer(
                    r"(19|20)\d{2}[^\n]{5,120}", text
                ):
                    entry = match.group(0).strip()
                    election_history.append({"summary": entry})
            break

    # ── Endorsements ─────────────────────────────────────────────────────────
    endorsements = _parse_endorsements(
        soup_section_text(soup, "Endorsements", max_chars=1500)
    )

    # ── Committee assignments ─────────────────────────────────────────────────
    committees: list[str] = []
    committee_text = soup_section_text(soup, "Committee assignments", max_chars=2000)
    if committee_text:
        raw = re.split(r"[;,\n]", committee_text)
        committees = [clean_text(c) for c in raw if len(clean_text(c)) > 5][:20]

    # ── Contact info ──────────────────────────────────────────────────────────
    contact: dict[str, str] = {}
    for link in soup.find_all("a", href=True):
        href = link["href"]
        text = clean_text(link.get_text())
        if "campaign" in text.lower() and href.startswith("http") and "ballotpedia" not in href:
            contact["campaign_website"] = href
        if "twitter.com" in href or "x.com" in href:
            contact["twitter"] = href
        if "facebook.com" in href:
            contact["facebook"] = href
        if href.startswith("mailto:"):
            contact["email"] = href.replace("mailto:", "")

    return {
        "name": name,
        "url": candidate_url,
        "party": party,
        "office": office,
        "state": state,
        "bio": bio,
        "campaign_themes": campaign_themes or "(No campaign theme data found on Ballotpedia.)",
        "key_votes": key_votes[:15],
        "election_history": election_history[:10],
        "endorsements": endorsements,
        "committee_assignments": committees,
        "contact": contact,
        "source": candidate_url,
    }


# ── Tool 4: Ballot measures by state ─────────────────────────────────────────
@mcp.tool()
async def get_ballot_measures(
    state: str = "",
    year: int = 2026,
    measure_type: str = "",
) -> dict[str, Any]:
    """
    List ballot measures for a given state and election year.

    Args:
        state:        Full state name or 2-letter abbreviation (e.g. "Wisconsin" or "WI")
        year:         Election year (default 2026)
        measure_type: Optional filter — "constitutional amendment", "initiative",
                      "referendum", "bond", "veto referendum", etc.

    Returns:
        A dict with:
          - state: str
          - year: int
          - measures: list of dicts with title, type, description, status, url
          - sources: list of URLs consulted
    """
    state_full = normalize_state(state)

    measures: list[dict] = []
    sources: list[str] = []

    # Try state-specific measures page first
    if state_full:
        state_slug = state_full.replace(" ", "_")
        state_measures_url = f"{BASE_URL}/{state_slug}_{year}_ballot_measures"
        try:
            soup = await fetch_page(state_measures_url)
            sources.append(state_measures_url)
            measures.extend(_parse_measures_page(soup, state_full, year))
        except Exception:
            pass  # Fall through to national page

    # Also try national year index
    national_url = f"{BASE_URL}/{year}_ballot_measures"
    try:
        soup = await fetch_page(national_url)
        sources.append(national_url)

        if state_full:
            # Extract just the state section
            for h in soup.find_all(["h2", "h3"]):
                if state_full.lower() in h.get_text().lower():
                    for sibling in h.find_next_siblings():
                        if sibling.name in ["h2", "h3"]:
                            break
                        if sibling.name == "table":
                            rows = sibling.find_all("tr")
                            if not rows:
                                continue
                            headers = [
                                clean_text(c.get_text()).lower()
                                for c in rows[0].find_all(["th", "td"])
                            ]
                            header_index = {h: i for i, h in enumerate(headers)}

                            def cell_for(cols, *names):
                                for name in names:
                                    i = header_index.get(name)
                                    if i is not None and i < len(cols):
                                        return cols[i]
                                return None

                            for row in rows[1:]:
                                cols = row.find_all(["td", "th"])
                                if len(cols) >= 2:
                                    title_td = cell_for(cols, "title", "measure") or cols[0]
                                    type_td = cell_for(cols, "type")
                                    subject_td = cell_for(cols, "subject")
                                    desc_td = cell_for(cols, "description", "summary")
                                    link = title_td.find("a")
                                    title = clean_text(title_td.get_text())
                                    href = link["href"] if link and link.get("href") else ""
                                    measure_url = BASE_URL + href if href.startswith("/") else href
                                    mtype = clean_text(type_td.get_text()) if type_td else ""
                                    subject = clean_text(subject_td.get_text()) if subject_td else ""
                                    desc = clean_text(desc_td.get_text()) if desc_td else ""
                                    # Fall back to subject text for description only when
                                    # there is no dedicated description column.
                                    if not desc and subject:
                                        desc = subject
                                    if title and title not in [m["title"] for m in measures]:
                                        measures.append({
                                            "title": title,
                                            "state": state_full,
                                            "type": mtype,
                                            "subject": subject,
                                            "description": desc,
                                            "status": "on_ballot",
                                            "url": measure_url,
                                        })
        else:
            # No state filter — return all from national page
            measures.extend(_parse_measures_page(soup, "", year))
    except Exception as e:
        logger.warning("Ballot measures fetch error: %s", e)

    # Filter by type if requested
    if measure_type and measures:
        mt_lower = measure_type.lower()
        filtered = [m for m in measures if mt_lower in m.get("type", "").lower()
                    or mt_lower in m.get("title", "").lower()]
        measures = filtered if filtered else measures

    return {
        "state": state_full or "All States",
        "year": year,
        "measures": measures,
        "sources": sources,
    }


def _parse_measures_page(soup: BeautifulSoup, state: str, year: int) -> list[dict]:
    """Generic parser for Ballotpedia ballot measures pages."""
    measures = []
    for table in soup.find_all("table", {"class": re.compile(r"wikitable", re.I)}):
        rows = table.find_all("tr")
        if not rows:
            continue
        header_row = rows[0]
        headers = [clean_text(th.get_text()).lower() for th in header_row.find_all(["th", "td"])]
        if not any(h in headers for h in ["title", "measure", "type", "description"]):
            continue
        for row in rows[1:]:
            cols = row.find_all(["td", "th"])
            row_data: dict[str, str] = {}
            for i, col in enumerate(cols):
                if i < len(headers):
                    link = col.find("a")
                    text = clean_text(col.get_text())
                    href = link["href"] if link and link.get("href") else ""
                    full_url = BASE_URL + href if href.startswith("/") else href
                    row_data[headers[i]] = text
                    if href:
                        row_data[headers[i] + "_url"] = full_url
            if row_data:
                title = row_data.get("title", row_data.get("measure", ""))
                measures.append({
                    "title": title,
                    "state": state,
                    "type": row_data.get("type", ""),
                    # Subject is its own column; keep it distinct from description
                    # so the generative-UI card can group measures by subject.
                    "subject": row_data.get("subject", ""),
                    "description": row_data.get("description", row_data.get("summary", "")),
                    "status": row_data.get("status", ""),
                    "url": row_data.get("title_url", row_data.get("measure_url", "")),
                })
    return measures


# Anchor link text Ballotpedia repeats next to each office ("Click here") plus
# common call-to-action labels — never an office name.
_GENERIC_LINK_TEXT = {"click here", "click", "learn more", "here", "read more"}


def _is_office_link(text: str, href: str, year: int) -> bool:
    """True if a link in the 'Offices on the ballot' section names a real race.

    Real office links point at an internal race page whose slug carries both an
    election token and the year (e.g. /Wisconsin_State_Senate_elections,_2026).
    This rejects the duplicate "Click here" anchors and editorial links such as
    "Ballotpedia's scope" → /Elections_editorial_approach (no year).
    """
    label = text.strip().lower()
    if len(label) < 3 or label in _GENERIC_LINK_TEXT:
        return False
    # Accept internal Ballotpedia links whether relative ("/Foo") or absolute
    # ("https://ballotpedia.org/Foo") — a raw httpx fetch returns relative hrefs,
    # but a browser-rendered fetch (e.g. via Firecrawl) returns absolute ones.
    if href.startswith(BASE_URL):
        path = href[len(BASE_URL):]
    elif href.startswith("/"):
        path = href
    else:
        return False
    # Match against the path only — ignore #anchors/?query, and reject MediaWiki
    # namespaces (/Category:, /File:) without tripping on the URL scheme's colon.
    path = path.split("#")[0].split("?")[0]
    if ":" in path:
        return False
    path_lower = path.lower()
    is_election_page = "election" in path_lower or "gubernatorial" in path_lower
    return is_election_page and str(year) in path


def _find_section_heading(content: BeautifulSoup, target: str):
    """Return the first h2/h3 whose text contains `target` (case-insensitive)."""
    for heading in content.find_all(["h2", "h3"]):
        if target.lower() in heading.get_text().lower():
            return heading
    return None


def _parse_state_elections_page(soup: BeautifulSoup, year: int) -> list[dict]:
    """Extract the real races from a state's '..._elections,_YEAR' page.

    Ballotpedia lists the offices actually on the ballot as a link list under the
    'Offices on the ballot' heading. The page's other h2/h3 headings ('What's on
    your ballot?', 'List of candidates', ...) are section labels, NOT races — the
    old parser mistook them for races. We walk only the offices section.
    """
    content = soup.find("div", {"id": "mw-content-text"}) or soup
    heading = _find_section_heading(content, "Offices on the ballot")
    if heading is None:
        return []

    # The heading may be bare, or wrapped in a <div class="mw-heading"> (newer
    # MediaWiki). Walk siblings of whichever node actually sits in the flow.
    parent = heading.parent
    is_mw_heading_wrapper = (
        parent is not None
        and parent.name == "div"
        and "mw-heading" in (parent.get("class") or [])
    )
    start = parent if is_mw_heading_wrapper else heading

    races: list[dict] = []
    seen: set[str] = set()
    for sibling in start.next_siblings:
        name = getattr(sibling, "name", None)
        if name is None:
            continue
        is_next_heading = name == "h2" or (
            name == "div" and "mw-heading" in (sibling.get("class") or [])
        )
        if is_next_heading:
            break
        if not hasattr(sibling, "find_all"):
            continue
        for link in sibling.find_all("a", href=True):
            text = clean_text(link.get_text())
            href = link["href"]
            if not _is_office_link(text, href, year):
                continue
            full_url = BASE_URL + href if href.startswith("/") else href
            dedupe_key = full_url.split("#")[0]
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            races.append({
                "title": text,
                "url": full_url,
                "date": f"November 3, {year}",
                "office_type": _classify_office(text),
                "candidates_preview": [],
            })
    return races


# ── Tool 5: Election overview by state ───────────────────────────────────────
@mcp.tool()
async def get_elections_by_state(
    state: str,
    year: int = 2026,
    office_filter: str = "",
) -> dict[str, Any]:
    """
    Get an overview of all elections happening in a state for a given year.

    Args:
        state:         Full state name or 2-letter abbreviation (e.g. "Wisconsin" or "WI")
        year:          Election year (default 2026)
        office_filter: Optional filter — "governor", "senate", "house", "school board", etc.

    Returns:
        A dict with:
          - state: str
          - year: int
          - elections: list of dicts with title, url, date, office_type, candidates_preview
          - sources: list of URLs consulted
    """
    state_full = normalize_state(state)

    elections: list[dict] = []
    sources: list[str] = []
    state_slug = state_full.replace(" ", "_")

    # Parse the offices actually on the ballot from the state elections index page.
    url = f"{BASE_URL}/{state_slug}_elections,_{year}"
    try:
        soup = await fetch_page(url)
        sources.append(url)
        elections = _parse_state_elections_page(soup, year)
    except Exception as e:
        return {"error": f"Could not load elections for {state_full} {year}: {e}", "sources": sources}

    # Apply office filter
    if office_filter and elections:
        of_lower = office_filter.lower()
        filtered = [e for e in elections if of_lower in e["title"].lower()
                    or of_lower in e["office_type"].lower()]
        elections = filtered if filtered else elections

    return {
        "state": state_full,
        "year": year,
        "elections": elections[:30],
        "sources": sources,
    }


# ── Tool 6: Candidate comparison ─────────────────────────────────────────────
@mcp.tool()
async def compare_candidates(
    candidate_names: list[str],
    topics: list[str] | None = None,
) -> dict[str, Any]:
    """
    Fetch profiles for multiple candidates and compare them side-by-side.

    Useful for agentic research workflows where you want to quickly contrast
    platforms, parties, and backgrounds for candidates in the same race.

    Args:
        candidate_names: List of candidate full names (2–6 names recommended)
        topics:          Optional list of topics to focus comparison on
                         (e.g. ["economy", "healthcare", "climate"])

    Returns:
        A dict with:
          - comparison: list of condensed candidate profiles
          - topics_covered: list of topics found across all profiles
          - sources: list of URLs consulted
    """
    if not candidate_names:
        return {"error": "Provide at least one candidate name."}
    if len(candidate_names) > 6:
        return {"error": "Maximum 6 candidates per comparison. Split into multiple calls."}

    profiles = []
    sources = []

    # Fetch all profiles concurrently
    tasks = [summarize_candidate_platform(name) for name in candidate_names]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for name, result in zip(candidate_names, results):
        if isinstance(result, Exception):
            profiles.append({"name": name, "error": str(result)})
        elif isinstance(result, dict) and "error" in result:
            profiles.append({"name": name, "error": result["error"]})
        else:
            sources.append(result.get("source", ""))
            # Build condensed profile
            profile = {
                "name": result.get("name", name),
                "party": result.get("party", ""),
                "office": result.get("office", ""),
                "state": result.get("state", ""),
                "bio_summary": result.get("bio", "")[:600],
                "platform_summary": result.get("campaign_themes", "")[:800],
                "election_history_count": len(result.get("election_history", [])),
                "endorsements": result.get("endorsements", [])[:5],
                "url": result.get("url", ""),
            }
            # Topic-focused extraction if requested
            if topics:
                topic_notes = {}
                for topic in topics:
                    combined = (
                        result.get("campaign_themes", "") + " " +
                        result.get("bio", "")
                    )
                    t_lower = topic.lower()
                    sentences = re.split(r"(?<=[.!?])\s+", combined)
                    relevant = [s for s in sentences if t_lower in s.lower()]
                    topic_notes[topic] = " ".join(relevant[:3])[:400] if relevant else ""
                profile["topic_notes"] = topic_notes
            profiles.append(profile)

    topics_covered = list({
        topic for profile in profiles
        for topic in (profile.get("topic_notes", {}) or {}).keys()
    })

    return {
        "comparison": profiles,
        "topics_covered": topics_covered,
        "sources": [s for s in sources if s],
    }


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    mcp.run(transport="stdio")
