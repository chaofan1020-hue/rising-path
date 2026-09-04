"""Public ATS adapters. Add company-specific adapters without changing the pipeline."""
from abc import ABC, abstractmethod
import asyncio
from dataclasses import dataclass
from html import unescape
from html.parser import HTMLParser
import json
import re
from typing import Any, Mapping
from urllib.parse import parse_qs, parse_qsl, unquote, urlencode, urljoin, urlparse, urlsplit, urlunsplit
import xml.etree.ElementTree as ET

import httpx

from app.config import get_settings


@dataclass(frozen=True)
class RawJob:
    external_job_id: str | None
    title: str
    url: str
    location: str | None
    department: str | None
    description: str | None
    payload: dict[str, Any]


def _official_listing_payload(payload: dict[str, Any], description: Any) -> dict[str, Any]:
    """Mark an official ATS response as detail-backed when it includes a body."""

    result = dict(payload or {})
    if description not in (None, "") and str(description).strip():
        result.setdefault("detail_status", "fetched_json")
        result.setdefault("metadata_quality", "official_ats_detail")
    return result


class _JsonLdParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_script = False
        self.parts: list[str] = []
        self.documents: list[Any] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and dict(attrs).get("type", "").lower() == "application/ld+json":
            self.in_script = True; self.parts = []

    def handle_data(self, data: str) -> None:
        if self.in_script:
            self.parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.in_script:
            try:
                self.documents.append(json.loads("".join(self.parts)))
            except json.JSONDecodeError:
                pass
            self.in_script = False


class _TalentBrewParser(HTMLParser):
    """Parser for TalentBrew's public job-search markup and AJAX fragments."""

    void_tags = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__()
        self.search_attrs: dict[str, str] = {}
        self.filter_attrs: dict[str, str] = {}
        self.jobs: list[dict[str, str]] = []
        self.in_job = False
        self.job_depth = 0
        self.current: dict[str, str] = {}
        self.tag_stack: list[tuple[str, str | None, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if values.get("id") == "search-results":
            self.search_attrs = values
        elif values.get("id") == "search-filters":
            self.filter_attrs = values
        classes = values.get("class", "").split()
        if tag == "li" and "section3__search-results-li" in classes:
            self.in_job, self.job_depth, self.current, self.tag_stack = True, 1, {}, []
            return
        if not self.in_job:
            return
        if tag not in self.void_tags:
            self.job_depth += 1
        parent_context = self.tag_stack[-1][1] if self.tag_stack else None
        context = parent_context
        target: str | None = None
        if tag == "a" and "section3__search-results-a" in classes:
            self.current["url"] = values.get("href", "")
            self.current["id"] = values.get("data-job-id", "")
        if tag == "h2" and "section3__job-title" in classes:
            target = "title"
        elif tag == "span" and "job-location" in classes:
            context = "location"
        elif tag == "span" and "job-category" in classes:
            context = "department"
        elif tag == "span" and "section3__job-info" in classes:
            target = parent_context
        if tag not in self.void_tags:
            self.tag_stack.append((tag, context, target))

    def handle_data(self, data: str) -> None:
        if not self.in_job or not self.tag_stack:
            return
        text = data.strip()
        target = self.tag_stack[-1][2]
        if text and target:
            self.current[target] = f"{self.current.get(target, '')} {text}".strip()

    def handle_endtag(self, tag: str) -> None:
        if not self.in_job:
            return
        if tag != "li" and self.tag_stack:
            self.tag_stack.pop()
        self.job_depth -= 1
        if tag == "li" and self.job_depth == 0:
            if self.current.get("title") and self.current.get("url"):
                self.jobs.append(self.current)
            self.in_job = False
            self.current, self.tag_stack = {}, []


class _AvatureJobParser(HTMLParser):
    """Parse publicly rendered Avature search-result cards."""

    def __init__(self) -> None:
        super().__init__()
        self.jobs: list[dict[str, str]] = []
        self.in_result = False
        self.depth = 0
        self.in_title = False
        self.in_subtitle = False
        self.in_location = False
        self.current: dict[str, str] = {}
        self.subtitle_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        classes = values.get("class", "").split()
        if tag == "article" and "article--result" in classes:
            self.in_result, self.depth, self.current, self.subtitle_parts = True, 1, {}, []
            self.in_location = False
            return
        if not self.in_result:
            return
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}:
            self.depth += 1
        if tag == "h3" and "article__header__text__title" in classes:
            self.in_title = True
        elif tag == "div" and "article__header__text__subtitle" in classes:
            self.in_subtitle = True
        elif tag == "span" and "paragraph_inner-span" in classes and not self.current.get("location"):
            # Avature portals commonly publish location as the first plain paragraph span.
            self.in_location = True
        elif tag == "a" and self.in_title and values.get("href"):
            self.current["url"] = values["href"]

    def handle_data(self, data: str) -> None:
        if not self.in_result:
            return
        text = data.strip()
        if not text:
            return
        if self.in_title:
            self.current["title"] = f"{self.current.get('title', '')} {text}".strip()
        elif self.in_location:
            self.current["location"] = f"{self.current.get('location', '')} {text}".strip()
        elif self.in_subtitle:
            self.subtitle_parts.append(text)

    def handle_endtag(self, tag: str) -> None:
        if not self.in_result:
            return
        if tag == "h3":
            self.in_title = False
        elif tag == "span" and self.in_location:
            self.in_location = False
        elif tag == "div" and self.in_subtitle:
            self.in_subtitle = False
        self.depth -= 1
        if tag == "article" and self.depth == 0:
            if self.current.get("title") and self.current.get("url"):
                if self.subtitle_parts:
                    self.current["subtitle"] = " | ".join(dict.fromkeys(self.subtitle_parts))
                self.jobs.append(self.current)
            self.in_result = False


class Connector(ABC):
    @abstractmethod
    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]: ...

    async def get_json(self, url: str) -> Any:
        source = urlparse(url)
        origin = f"{source.scheme}://{source.netloc}" if source.netloc else None
        headers = {
            "User-Agent": get_settings().crawler_user_agent,
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
        }
        if origin:
            headers.update({"Origin": origin, "Referer": url})
        async with httpx.AsyncClient(headers=headers, timeout=30, follow_redirects=True) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()


class _VisibleTextParser(HTMLParser):
    """Extract readable text from a public detail page without script chrome."""

    ignored_tags = {"script", "style", "noscript", "svg", "header", "footer", "nav", "form"}

    def __init__(self) -> None:
        super().__init__()
        self._ignored = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.ignored_tags:
            self._ignored += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in self.ignored_tags and self._ignored:
            self._ignored -= 1

    def handle_data(self, data: str) -> None:
        if not self._ignored:
            text = re.sub(r"\s+", " ", unescape(data)).strip()
            if text:
                self.parts.append(text)

    @property
    def text(self) -> str:
        return "\n".join(dict.fromkeys(self.parts))


class _TalDetailParser(HTMLParser):
    """Extract explicitly labelled fields from Oleeo/TAL detail pages.

    TAL's legacy candidate template exposes job data as labelled form groups
    rather than JSON-LD.  Keeping the parser label-driven avoids inferring a
    location or department from a title slug or surrounding page chrome.
    """

    void_tags = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
    ignored_tags = {"script", "style", "noscript", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.fields: dict[str, str] = {}
        self._depth = 0
        self._ignored = 0
        self._group_depth: int | None = None
        self._label_depth: int | None = None
        self._value_depth: int | None = None
        self._label_parts: list[str] = []
        self._value_parts: list[str] = []

    @staticmethod
    def _classes(attrs: list[tuple[str, str | None]]) -> set[str]:
        return {item.lower() for item in (dict(attrs).get("class") or "").split()}

    @staticmethod
    def _clean(parts: list[str]) -> str:
        return re.sub(r"\s+", " ", unescape(" ".join(parts))).strip()

    def _finish_group(self) -> None:
        label = self._clean(self._label_parts)
        value = self._clean(self._value_parts)
        if label and value:
            self.fields[label.casefold()] = value
        self._group_depth = None
        self._label_depth = None
        self._value_depth = None
        self._label_parts = []
        self._value_parts = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in self.ignored_tags:
            self._ignored += 1
            return
        if self._ignored:
            return
        if tag not in self.void_tags:
            self._depth += 1
        classes = self._classes(attrs)
        if tag == "div" and "form-group" in classes and self._group_depth is None:
            self._group_depth = self._depth
            self._label_parts = []
            self._value_parts = []
        elif self._group_depth is not None and tag == "span" and "hform_lbl_text" in classes and self._label_depth is None:
            self._label_depth = self._depth
        elif self._group_depth is not None and tag == "div" and "form-control-static" in classes and self._value_depth is None:
            self._value_depth = self._depth

    def handle_data(self, data: str) -> None:
        if self._ignored or self._group_depth is None:
            return
        text = re.sub(r"\s+", " ", unescape(data)).strip()
        if not text:
            return
        if self._label_depth is not None and self._depth >= self._label_depth:
            self._label_parts.append(text)
        elif self._value_depth is not None and self._depth >= self._value_depth:
            self._value_parts.append(text)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in self.ignored_tags:
            if self._ignored:
                self._ignored -= 1
            return
        if self._ignored or tag in self.void_tags:
            return
        closing_depth = self._depth
        if self._label_depth == closing_depth:
            self._label_depth = None
        if self._value_depth == closing_depth:
            self._value_depth = None
        if self._group_depth == closing_depth:
            self._finish_group()
        self._depth = max(0, self._depth - 1)


def _canonical_detail_request_url(url: str) -> str:
    """Remove TAL's ``instant=apply`` flag while preserving the canonical URL."""

    parsed = urlsplit(url)
    hostname = (parsed.hostname or "").lower()
    if not (hostname == "tal.net" or hostname.endswith(".tal.net")):
        return url
    query = urlencode(
        [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)
         if not (key.casefold() == "instant" and value.casefold() == "apply")],
        doseq=True,
    )
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, query, parsed.fragment))


def _tal_inline_field(text: str | None, label: str) -> str | None:
    """Read a field only when the TAL body labels it explicitly."""

    if not text:
        return None
    labels = (
        "job title", "division", "location", "start date", "application deadline",
        "duration", "country", "programme", "department", "business unit",
    )
    stop = "|".join(re.escape(item) for item in labels if item.casefold() != label.casefold())
    match = re.search(
        rf"\b{re.escape(label)}\s*:\s*(.+?)(?=\s+(?:{stop})\s*:|$)",
        text,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"\s+", " ", match.group(1)).strip() if match else ""
    return value or None


async def fetch_public_detail(url: str, *, timeout: float = 30,
                              client: httpx.AsyncClient | None = None,
                              headers: Mapping[str, str] | None = None) -> tuple[str | None, dict[str, Any]]:
    """Fetch a permitted public job page and extract JobPosting or readable text."""

    request_url = _canonical_detail_request_url(url)
    if client is None:
        async with httpx.AsyncClient(
            headers=dict(headers or {"User-Agent": get_settings().crawler_user_agent}),
            timeout=timeout, follow_redirects=True
        ) as owned_client:
            response = await owned_client.get(request_url)
            response.raise_for_status()
    else:
        response = await client.get(request_url, headers=dict(headers) if headers else None)
        response.raise_for_status()
    parser = _JsonLdParser()
    parser.feed(response.text)
    jsonld_candidate: tuple[str, dict[str, Any]] | None = None
    for document in parser.documents:
        candidates = document if isinstance(document, list) else [document]
        for item in candidates:
            if not isinstance(item, dict):
                continue
            item_type = item.get("@type")
            if item_type == "JobPosting" or (isinstance(item_type, list) and "JobPosting" in item_type):
                description = item.get("description")
                if description:
                    location = item.get("jobLocation") or {}
                    address = location.get("address", {}) if isinstance(location, dict) else {}
                    detail_location = ", ".join(str(value) for value in (
                        address.get("addressLocality"), address.get("addressRegion"), address.get("addressCountry")
                    ) if value) or None
                    detail_meta = {
                        "detail_status": "fetched_jsonld",
                        "detail_payload": item,
                        **({"detail_location": detail_location} if detail_location else {}),
                        **({"detail_department": str(item.get("industry"))} if item.get("industry") else {}),
                    }
                    description_text = str(description)
                    if len(description_text.strip()) < 300:
                        # Meta keeps the meta description short but publishes
                        # the responsibilities and qualifications alongside it
                        # in the same public JobPosting JSON-LD document.
                        # Combine those explicitly labelled fields so the
                        # feature store receives the complete official body.
                        labelled_parts = [description_text]
                        for field in (
                            "responsibilities", "qualifications", "preferredQualifications",
                            "experienceRequirements", "educationRequirements", "skills",
                        ):
                            value = item.get(field)
                            if value not in (None, "", []):
                                if isinstance(value, list):
                                    value = "\n".join(str(part) for part in value)
                                labelled_parts.append(re.sub(r"\\s+", " ", unescape(str(value))).strip())
                        description_text = "\n".join(
                            part for part in dict.fromkeys(labelled_parts) if part
                        )
                    # Some publishers put only a teaser in JSON-LD while the
                    # same public page contains the full readable body.
                    # Keep the candidate and let the visible-text pass below
                    # choose the longer official representation.
                    if len(description_text.strip()) >= 300:
                        return description_text, detail_meta
                    jsonld_candidate = (description_text, detail_meta)

    hostname = (urlparse(request_url).hostname or "").lower()
    if hostname.endswith(".tal.net") or hostname == "tal.net":
        tal_parser = _TalDetailParser()
        tal_parser.feed(response.text)
        fields = tal_parser.fields
        description = fields.get("job description") or fields.get("description")
        if not description:
            description = next(
                (value for label, value in fields.items()
                 if "description" in label or "overview" in label),
                None,
            )
        location = fields.get("location") or _tal_inline_field(description, "location") or fields.get("country")
        # Jefferies and some other TAL tenants publish an explicit
        # "Business Unit(s)" label instead of "Department". Treat it as a
        # department only because the field is explicitly labelled by the ATS.
        department = (
            fields.get("department")
            or fields.get("group")
            or fields.get("division")
            or fields.get("business unit(s)")
            or fields.get("business unit")
        )
        if description:
            return description, {
                "detail_status": "fetched_html",
                "detail_location": location,
                "detail_department": department,
                "detail_request_url": request_url,
            }
    text_parser = _VisibleTextParser()
    text_parser.feed(response.text)
    text = text_parser.text
    if len(text) >= 300 and (jsonld_candidate is None or len(text) > len(jsonld_candidate[0])):
        return text, {"detail_status": "fetched_html"}
    if jsonld_candidate is not None:
        return jsonld_candidate
    return (text if len(text) >= 300 else None), {"detail_status": "fetched_html" if len(text) >= 300 else "detail_partial"}

class PhenomConnector(Connector):
    """Read Phenom's server-rendered public search result payload."""

    default_page_size = 10
    default_max_pages = 500

    @staticmethod
    def _ddo(text: str) -> dict[str, Any]:
        marker = "phApp.ddo"
        index = text.find(marker)
        if index < 0:
            raise ValueError("Phenom page did not contain phApp.ddo")
        start = text.find("=", index) + 1
        if start <= 0:
            raise ValueError("Phenom page did not contain a DDO assignment")
        value, _ = json.JSONDecoder().raw_decode(text[start:].lstrip())
        if not isinstance(value, dict):
            raise ValueError("Phenom DDO was not an object")
        return value

    @staticmethod
    def _location(job: dict[str, Any]) -> str | None:
        values: list[str] = []
        for key in ("location", "cityStateCountry", "address", "cityState", "country", "state", "city"):
            value = job.get(key)
            if isinstance(value, list):
                values.extend(str(item).strip() for item in value if str(item).strip())
            elif value not in (None, ""):
                values.append(str(value).strip())
        for key in ("multi_location", "multi_location_array"):
            value = job.get(key)
            if isinstance(value, list):
                values.extend(str(item).strip() for item in value if str(item).strip())
        return "; ".join(dict.fromkeys(item for item in values if item)) or None

    @staticmethod
    def _slug(value: Any) -> str:
        return re.sub(r"[^a-z0-9]+", "-", str(value or "job").lower()).strip("-") or "job"

    @classmethod
    def _raw_job(cls, source_url: str, job: dict[str, Any], config: dict[str, Any], total: int | None) -> RawJob:
        sequence = str(job.get("jobSeqNo") or job.get("jobId") or job.get("reqId") or "").strip() or None
        job_id = str(job.get("jobId") or job.get("reqId") or sequence or "").strip() or None
        title = str(job.get("title") or "Untitled").strip()
        template = config.get("detail_url_template")
        if template and sequence:
            url = str(template).format(job_seq_no=sequence, job_id=job_id or sequence, slug=cls._slug(title))
        else:
            url = unescape(str(job.get("applyUrl") or source_url))
        categories = job.get("multi_category") or job.get("multi_category_array") or []
        department = str(job.get("category") or (categories[0] if categories else "")).strip() or None
        description = job.get("descriptionTeaser")
        if not description and isinstance(job.get("ml_job_parser"), dict):
            description = job["ml_job_parser"].get("descriptionTeaser")
        payload = _official_listing_payload(job, description)
        payload.update({
            "phenom_job_id": job_id,
            "phenom_job_seq_no": sequence,
            "phenom_apply_url": unescape(str(job.get("applyUrl") or "")),
            "source_provider_total": total,
            "source_scope": config.get("source_scope", "global"),
        })
        return RawJob(sequence or job_id, title, url, cls._location(job), department,
                       str(description) if description not in (None, "") else None, payload)

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = max(1, min(int(config.get("page_size", self.default_page_size)), 50))
        max_pages = max(1, min(int(config.get("max_pages", self.default_max_pages)), 1000))
        params = dict(config.get("params") or {})
        raw_rows: list[dict[str, Any]] = []
        reported_total: int | None = None
        headers = {
            "User-Agent": str(config.get("user_agent") or "Mozilla/5.0 (compatible; GlobalJobsPlatform/1.0)"),
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        }
        async with httpx.AsyncClient(headers=headers, timeout=float(config.get("timeout", 45)), follow_redirects=True) as client:
            for page in range(max_pages):
                page_params = dict(params)
                if page > 0:
                    page_params.update({"from": page * page_size, "s": "1"})
                response = await client.get(source_url, params=page_params or None)
                response.raise_for_status()
                ddo = self._ddo(response.text)
                search = ddo.get("eagerLoadRefineSearch") or {}
                data = search.get("data") if isinstance(search, dict) else None
                rows = data.get("jobs") if isinstance(data, dict) else None
                if not isinstance(rows, list):
                    raise ValueError("Phenom DDO did not contain eagerLoadRefineSearch.data.jobs")
                if reported_total is None:
                    try:
                        reported_total = int(search.get("totalHits")) if search.get("totalHits") is not None else None
                    except (TypeError, ValueError):
                        reported_total = None
                raw_rows.extend(row for row in rows if isinstance(row, dict))
                if not rows:
                    break
                if reported_total is not None and len(raw_rows) >= reported_total:
                    break
                if len(rows) < page_size and reported_total is None:
                    break
            else:
                raise ValueError(f"Phenom pagination exceeded max_pages={max_pages}")
        if reported_total is not None and len(raw_rows) < reported_total:
            raise ValueError(f"Phenom pagination ended early: fetched={len(raw_rows)}, reported={reported_total}")
        jobs_by_id: dict[str, RawJob] = {}
        invalid = 0
        for row in raw_rows:
            job = self._raw_job(source_url, row, config, reported_total)
            if not job.external_job_id:
                invalid += 1
                continue
            jobs_by_id.setdefault(job.external_job_id, job)
        jobs = list(jobs_by_id.values())
        if not jobs:
            raise ValueError("Phenom returned an empty job snapshot")
        duplicate = max(len(raw_rows) - len(jobs) - invalid, 0)
        complete = reported_total is None or len(jobs) >= reported_total
        for job in jobs:
            job.payload.update({
                "source_reported_count": len(jobs),
                "source_expected_count": reported_total or len(jobs),
                "source_complete": complete,
                "source_invalid_count": invalid,
                "source_duplicate_count": duplicate,
                "source_missing_count": max((reported_total or len(jobs)) - len(jobs), 0),
            })
        return jobs


class OfficialConnector(Connector):
    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        async with httpx.AsyncClient(headers={"User-Agent": get_settings().crawler_user_agent}, timeout=30, follow_redirects=True) as client:
            response = await client.get(source_url)
            response.raise_for_status()
        parser = _JsonLdParser(); parser.feed(response.text)
        documents: list[dict[str, Any]] = []
        for document in parser.documents:
            candidates = document if isinstance(document, list) else [document]
            documents.extend(item for item in candidates if isinstance(item, dict))
        jobs = [item for item in documents if item.get("@type") in ("JobPosting", ["JobPosting"])]
        return [RawJob(str(job.get("identifier", {}).get("value") or job.get("url") or job.get("title")), job.get("title", "Untitled"),
                       job.get("url") or source_url, self._location(job), job.get("industry"), self._description(job), job) for job in jobs]

    @staticmethod
    def _location(job: dict[str, Any]) -> str | None:
        location = job.get("jobLocation") or {}
        address = location.get("address", {}) if isinstance(location, dict) else {}
        return ", ".join(str(value) for value in (address.get("addressLocality"), address.get("addressCountry")) if value)

    @staticmethod
    def _description(job: dict[str, Any]) -> str | None:
        return job.get("description")


class GoldmanSachsConnector(Connector):
    endpoint = "https://api-higher.gs.com/gateway/api/v1/graphql"
    query = """query GetRoles($searchQueryInput: RoleSearchQueryInput!) {
      roleSearch(searchQueryInput: $searchQueryInput) {
        totalCount
        items {
          roleId corporateTitle jobTitle jobFunction division
          locations { primary country city state }
          jobType { code description }
          externalSource { sourceId }
        }
      }
    }"""

    def request_payload(self, page_number: int, page_size: int, experiences: list[str]) -> dict[str, Any]:
        return {
            "operationName": "GetRoles",
            "variables": {"searchQueryInput": {"page": {"pageSize": page_size, "pageNumber": page_number}, "sort": {"sortStrategy": "RELEVANCE", "sortOrder": "DESC"}, "filters": [], "experiences": experiences, "searchTerm": ""}},
            "query": self.query,
        }

    async def early_career_role_ids(self, client: httpx.AsyncClient, page_size: int) -> set[str]:
        """Retrieve the public Early Career category separately for reliable filtering."""
        role_ids: set[str] = set()
        page_number = 0
        while True:
            response = await client.post(self.endpoint, json=self.request_payload(page_number, page_size, ["EARLY_CAREER"]))
            response.raise_for_status()
            result = response.json().get("data", {}).get("roleSearch", {})
            page = result.get("items", [])
            role_ids.update(str(job["roleId"]) for job in page if job.get("roleId"))
            if not page or len(role_ids) >= int(result.get("totalCount") or 0) or len(page) < page_size:
                return role_ids
            page_number += 1

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = 100
        page_number = 0
        raw_jobs: list[RawJob] = []
        async with httpx.AsyncClient(headers={"User-Agent": get_settings().crawler_user_agent, "Content-Type": "application/json"}, timeout=30) as client:
            early_career_ids = await self.early_career_role_ids(client, page_size)
            while True:
                response = await client.post(self.endpoint, json=self.request_payload(page_number, page_size, ["EARLY_CAREER", "PROFESSIONAL"]))
                response.raise_for_status()
                result = response.json().get("data", {}).get("roleSearch", {})
                page = result.get("items", [])
                if not page:
                    break
                for job in page:
                    role_id = job.get("roleId") or job.get("externalSource", {}).get("sourceId")
                    source_id = job.get("externalSource", {}).get("sourceId") or role_id
                    locations = job.get("locations") or []
                    location = "; ".join(
                        ", ".join(str(value) for value in (item.get("city"), item.get("state"), item.get("country")) if value)
                        for item in locations
                    ) or None
                    raw_jobs.append(RawJob(str(role_id) if role_id else None, job.get("jobTitle", "Untitled"),
                                           f"https://higher.gs.com/roles/{source_id}", location, job.get("division"),
                                           None, {**job, "experienceCategory": "EARLY_CAREER" if str(role_id) in early_career_ids else "PROFESSIONAL"}))
                page_number += 1
                if len(raw_jobs) >= int(result.get("totalCount") or 0) or len(page) < page_size:
                    break
        return raw_jobs


class TalentBrewConnector(Connector):
    """Fetch public job listings from TalentBrew-powered career sites."""

    @staticmethod
    def _request_params(search: dict[str, str], filters: dict[str, str], page: int) -> dict[str, str | int]:
        return {
            "ActiveFacetID": search.get("data-active-facet-id", "0"),
            "CurrentPage": page,
            "RecordsPerPage": search.get("data-records-per-page", "10"),
            "Distance": search.get("data-distance", "50"),
            "RadiusUnitType": filters.get("data-radius-unit-type", "2"),
            "Keywords": search.get("data-keywords", ""), "Location": search.get("data-location", ""),
            "Latitude": search.get("data-latitude", ""), "Longitude": search.get("data-longitude", ""),
            "ShowRadius": search.get("data-show-radius", "False"), "IsPagination": "False",
            "CustomFacetName": search.get("data-custom-facet-name", ""), "FacetTerm": search.get("data-facet-term", ""),
            "FacetType": search.get("data-facet-type", "0"), "FacetFilters": "", "StaticFacets": "",
            "SearchResultsModuleName": search.get("data-search-results-module-name", ""),
            "SearchFiltersModuleName": filters.get("data-search-filters-module-name", ""),
            "SortCriteria": search.get("data-sort-criteria", "0"), "SortDirection": search.get("data-sort-direction", "0"),
            "SearchType": search.get("data-search-type", "1"),
            "CategoryFacetTerm": search.get("data-category-facet-term", ""), "CategoryFacetType": search.get("data-category-facet-type", ""),
            "LocationFacetTerm": search.get("data-location-facet-term", ""), "LocationFacetType": search.get("data-location-facet-type", ""),
            "KeywordType": search.get("data-keyword-type", ""), "LocationType": search.get("data-location-type", ""),
            "LocationPath": search.get("data-location-path", ""), "OrganizationIds": search.get("data-organization-ids", ""),
            "RefinedKeywords": "", "PostalCode": search.get("data-postal-code", ""), "ResultsType": search.get("data-results-type", "0"),
            "fc": filters.get("data-filtered-categories", ""), "fl": filters.get("data-filtered-locations", ""),
            "fcf": filters.get("data-filtered-custom-facet", ""), "afc": filters.get("data-filtered-advanced-categories", ""),
            "afl": filters.get("data-filtered-advanced-locations", ""), "afcf": filters.get("data-filtered-advanced-custom-facet", ""),
        }

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        async with httpx.AsyncClient(headers={"User-Agent": get_settings().crawler_user_agent}, timeout=30, follow_redirects=True) as client:
            response = await client.get(source_url)
            response.raise_for_status()
            parser = _TalentBrewParser(); parser.feed(response.text)
            if not parser.search_attrs:
                raise ValueError("TalentBrew search page did not contain public search-result metadata")
            pages = int(parser.search_attrs.get("data-total-pages") or 1)
            all_jobs = list(parser.jobs)
            results_url = config.get("results_url") or f"{source_url.rstrip('/')}/results"
            for page in range(2, pages + 1):
                result_response = await client.get(results_url, params=self._request_params(parser.search_attrs, parser.filter_attrs, page))
                result_response.raise_for_status()
                fragment = result_response.json().get("results", "")
                page_parser = _TalentBrewParser(); page_parser.feed(fragment)
                all_jobs.extend(page_parser.jobs)
        unique: dict[str, dict[str, str]] = {job.get("id") or job["url"]: job for job in all_jobs}
        return [RawJob(job.get("id") or None, job["title"], urljoin(source_url, job["url"]), job.get("location") or None,
                       job.get("department") or None, None, {"talentbrew_job_id": job.get("id")}) for job in unique.values()]


class GreenhouseConnector(Connector):
    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        board = config.get("board_token") or source_url.rstrip("/").split("/")[-1]
        data = await self.get_json(f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true")
        jobs: list[RawJob] = []
        for j in data.get("jobs", []):
            location = j.get("location") or {}
            departments = j.get("departments") or [{}]
            description = j.get("content")
            jobs.append(RawJob(str(j.get("id")) if j.get("id") is not None else None, j.get("title", "Untitled"),
                               j.get("absolute_url") or source_url, location.get("name"), departments[0].get("name"),
                               description, _official_listing_payload(j, description)))
        return jobs


class LeverConnector(Connector):
    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        site = config.get("site") or source_url.rstrip("/").split("/")[-1]
        data = await self.get_json(f"https://api.lever.co/v0/postings/{site}?mode=json")
        jobs: list[RawJob] = []
        for j in data:
            description = j.get("descriptionPlain") or j.get("descriptionBodyPlain")
            jobs.append(RawJob(
                j.get("id"), j.get("text", "Untitled"), j.get("hostedUrl") or source_url,
                (j.get("categories") or {}).get("location"), (j.get("categories") or {}).get("team"),
                description, _official_listing_payload(j, description),
            ))
        return jobs


class AshbyConnector(Connector):
    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        board = config.get("board_name") or source_url.rstrip("/").split("/")[-1]
        data = await self.get_json(f"https://api.ashbyhq.com/posting-api/job-board/{board}")
        return [RawJob(j.get("id"), j.get("title", "Untitled"), j.get("jobUrl") or source_url, j.get("location"), j.get("department"),
                       j.get("descriptionHtml"), j) for j in data["jobs"]]


class SmartRecruitersConnector(Connector):
    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        company = config.get("company") or source_url.rstrip("/").split("/")[-1]
        page_size = min(max(int(config.get("page_size", 100)), 1), 100)
        endpoint = f"https://api.smartrecruiters.com/v1/companies/{company}/postings"
        jobs: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        offset = 0
        total: int | None = None
        while True:
            data = await self.get_json(f"{endpoint}?limit={page_size}&offset={offset}")
            page = data.get("content", []) if isinstance(data, dict) else []
            if not isinstance(page, list) or not page:
                break
            page_ids = [str(item.get("id")) for item in page if isinstance(item, dict) and item.get("id") is not None]
            if page_ids and all(item_id in seen_ids for item_id in page_ids):
                raise ValueError("SmartRecruiters pagination repeated a page; source coverage is unverified")
            seen_ids.update(page_ids)
            jobs.extend(item for item in page if isinstance(item, dict))
            if total is None:
                metadata = data.get("totalFound") or data.get("total") or (data.get("meta") or {}).get("totalFound")
                try:
                    total = int(metadata) if metadata is not None else None
                except (TypeError, ValueError):
                    total = None
            offset += len(page)
            if total is not None and offset >= total:
                break
            if len(page) < page_size:
                break
        if total is not None and len(jobs) < total:
            raise ValueError(f"SmartRecruiters returned {len(jobs)} of {total} postings")
        return [RawJob(str(j.get("id")), j.get("name", "Untitled"), j.get("ref", {}).get("url") or source_url,
                       j.get("location", {}).get("city") or j.get("location", {}).get("country"),
                       j.get("department", {}).get("label"), None, j) for j in jobs]


class SymphonyTalentConnector(Connector):
    """Fetch jobs from Symphony Talent's public Talent Cloud search API."""

    @staticmethod
    def _decode_jsonp(payload: str) -> dict[str, Any]:
        start = payload.find("(")
        end = payload.rfind(")")
        if start < 0 or end <= start:
            raise ValueError("Symphony Talent response was not valid JSONP")
        data = json.loads(payload[start + 1:end])
        if not isinstance(data, dict):
            raise ValueError("Symphony Talent response did not contain an object")
        return data

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        api_url = config.get("api_url")
        company_name = config.get("company_name")
        if not api_url or not company_name:
            raise ValueError("Symphony Talent requires connector_config.api_url and company_name")
        page_size = min(int(config.get("page_size", 100)), 100)
        headers = {"User-Agent": get_settings().crawler_user_agent, "Referer": source_url}
        raw_jobs: list[dict[str, Any]] = []
        offset = 0
        total: int | None = None
        async with httpx.AsyncClient(headers=headers, timeout=45) as client:
            while True:
                response = await client.get(api_url, params={
                    "companyName": company_name, "pageSize": page_size, "offset": offset,
                    "orderBy": "posting_publish_time desc", "callback": "global_jobs_callback",
                })
                response.raise_for_status()
                data = self._decode_jsonp(response.text)
                if total is None:
                    total = int(data.get("totalHits") or 0)
                page = [item.get("job", item) for item in data.get("searchResults", []) if isinstance(item, dict)]
                if not page:
                    break
                raw_jobs.extend(item for item in page if isinstance(item, dict))
                offset += len(page)
                if total is not None and offset >= total:
                    break
        jobs: list[RawJob] = []
        for job in raw_jobs:
            location = ", ".join(str(value) for value in (job.get("primary_city"), job.get("primary_state"), job.get("primary_country")) if value)
            description = job.get("description")
            jobs.append(RawJob(str(job.get("id") or job.get("ref")) if job.get("id") or job.get("ref") else None,
                               job.get("title", "Untitled"), job.get("seo_url") or job.get("url") or source_url,
                               location or None, job.get("primary_category"), description,
                               _official_listing_payload(job, description)))
        return jobs


class OracleHCMConnector(Connector):
    """Fetch jobs from Oracle HCM Candidate Experience's public REST endpoint."""

    @staticmethod
    def resource_base_url(api_base_url: str) -> str:
        """Return Oracle's public Candidate Experience REST resource base."""
        base = str(api_base_url or "").rstrip("/")
        if base.endswith("/hcmRestApi/resources/latest"):
            return base
        if base.endswith("/hcmRestApi"):
            return f"{base}/resources/latest"
        return f"{base}/hcmRestApi/resources/latest"

    @staticmethod
    def detail_finder(job_id: str, site_number: str) -> str:
        # This is the finder shape emitted by Oracle's Candidate Experience
        # frontend. The quoted Id is accepted with or without URL encoding.
        return f'ById;Id="{job_id}",siteNumber={site_number}'

    @staticmethod
    def _plain_text(value: Any) -> str | None:
        if value in (None, ""):
            return None
        parser = _VisibleTextParser()
        parser.feed(str(value))
        text = parser.text.strip()
        return text or str(value).strip() or None

    @classmethod
    def _detail_location(cls, detail: dict[str, Any]) -> str | None:
        values: list[str] = []
        for key in ("PrimaryLocation",):
            if detail.get(key):
                values.append(str(detail[key]))
        for key in ("secondaryLocations", "otherWorkLocations"):
            entries = detail.get(key) or []
            if isinstance(entries, dict):
                entries = [entries]
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                value = entry.get("Name") or entry.get("LocationName") or entry.get("TownOrCity")
                if value:
                    values.append(str(value))
        work_location = detail.get("workLocation")
        if isinstance(work_location, dict):
            value = work_location.get("LocationName") or work_location.get("Name")
            if value:
                values.append(str(value))
        return "; ".join(dict.fromkeys(value.strip() for value in values if value.strip())) or None

    @staticmethod
    def _detail_department(detail: dict[str, Any]) -> str | None:
        for key in ("Department", "JobFamily", "JobFunction", "Category", "BusinessUnit", "Organization"):
            value = detail.get(key)
            if value:
                return str(value)
        return None

    @classmethod
    def _detail_description(cls, detail: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
        description_html = detail.get("ExternalDescriptionStr") or detail.get("ExternalResponsibilitiesStr")
        description = cls._plain_text(description_html)
        sections: list[tuple[str, str | None]] = [("Description", description)]
        responsibilities = cls._plain_text(detail.get("ExternalResponsibilitiesStr"))
        qualifications = cls._plain_text(detail.get("ExternalQualificationsStr"))
        if responsibilities and responsibilities != description:
            sections.append(("Responsibilities", responsibilities))
        if qualifications:
            sections.append(("Qualifications", qualifications))
        if not description:
            short = cls._plain_text(detail.get("ShortDescriptionStr"))
            if short:
                sections[0] = ("Description", short)
        merged = "\n\n".join(f"{label}:\n{value}" for label, value in sections if value)
        normalized = {
            "description_html": str(description_html) if description_html else None,
            "responsibilities": responsibilities,
            "qualifications": qualifications,
            "education": cls._plain_text(detail.get("StudyLevel")),
            "experience": cls._plain_text(detail.get("Experience")),
            "employment_type": detail.get("JobSchedule") or detail.get("WorkerType") or detail.get("JobType"),
            "workplace_type": detail.get("WorkplaceType") or detail.get("WorkplaceTypeCode"),
            "date_posted": detail.get("ExternalPostedStartDate"),
            "valid_through": detail.get("ExternalPostedEndDate"),
            "additional_locations": detail.get("secondaryLocations") or detail.get("otherWorkLocations") or [],
        }
        return merged or None, normalized

    @classmethod
    async def fetch_detail(cls, client: httpx.AsyncClient, raw: RawJob, config: dict[str, Any]) -> RawJob:
        api_base_url = str(config.get("api_base_url") or "").rstrip("/")
        site_number = str(config.get("site_number") or "")
        job_id = str(raw.external_job_id or raw.payload.get("Id") or "")
        if not api_base_url or not site_number or not job_id:
            raise ValueError("Oracle HCM detail requires api_base_url, site_number and job ID")
        endpoint = f"{cls.resource_base_url(api_base_url)}/recruitingCEJobRequisitionDetails"
        headers = {
            "Accept": "application/json",
            "Accept-Language": str(config.get("language", "en")),
            "Ora-Irc-Language": str(config.get("language", "en")),
        }
        attempts = max(1, min(int(config.get("detail_retry_attempts", 3)), 5))
        response: httpx.Response | None = None
        for attempt in range(attempts):
            response = await client.get(endpoint, params={
                "expand": "all",
                "onlyData": "true",
                "finder": cls.detail_finder(job_id, site_number),
            }, headers=headers)
            if response.status_code < 500 and response.status_code != 429:
                break
            if attempt < attempts - 1:
                await asyncio.sleep(0.5 * (attempt + 1))
        if response is None:
            raise RuntimeError("Oracle HCM detail request did not return a response")
        response.raise_for_status()
        data = response.json()
        items = data.get("items", []) if isinstance(data, dict) else []
        if not items or not isinstance(items[0], dict):
            raise ValueError("Oracle HCM detail response did not contain a requisition")
        detail = items[0]
        description, normalized = cls._detail_description(detail)
        payload = dict(raw.payload or {})
        payload.update(normalized)
        payload.update({
            "detail_status": "fetched",
            "detail_url": str(response.url),
            "detail_payload": detail,
            "oracle_requisition_id": detail.get("RequisitionId"),
        })
        return RawJob(
            raw.external_job_id,
            str(detail.get("Title") or raw.title),
            raw.url,
            raw.location or cls._detail_location(detail),
            raw.department or cls._detail_department(detail),
            description or raw.description,
            payload,
        )

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        api_base_url = str(config.get("api_base_url") or "").rstrip("/")
        site_number = config.get("site_number")
        if not api_base_url or not site_number:
            raise ValueError("Oracle HCM requires connector_config.api_base_url and site_number")
        page_size = max(1, min(int(config.get("page_size", 100)), 100))
        request_retries = max(1, min(int(config.get("listing_retry_attempts", 4)), 6))
        # A few Workday tenants return a transient empty page at a valid
        # offset (often around the 1,000th result). Treat it as a transport
        # boundary and retry with backoff before declaring the feed partial.
        pagination_retries = max(0, min(int(config.get("pagination_retry_attempts", 6)), 8))
        coverage_retry_passes = max(0, min(int(config.get("coverage_retry_passes", 1)), 3))
        endpoint = (
            f"{self.resource_base_url(api_base_url)}/recruitingCEJobRequisitions"
            "?onlyData=true&expand=requisitionList.workLocation,requisitionList.otherWorkLocations,"
            "requisitionList.secondaryLocations,requisitionList.requisitionFlexFields&finder=findReqs"
        )
        headers = {
            "User-Agent": get_settings().crawler_user_agent, "Accept-Language": str(config.get("language", "en")),
            "Ora-Irc-Language": str(config.get("language", "en")),
        }
        raw_jobs: list[dict[str, Any]] = []
        seen_keys: set[str] = set()
        duplicate_count = 0
        invalid_count = 0
        total: int | None = None
        source_complete = False
        jobs_base_url = source_url.rstrip("/")
        if jobs_base_url.endswith("/jobs"):
            jobs_base_url = jobs_base_url[:-5]

        async def fetch_page(client: httpx.AsyncClient, offset: int) -> tuple[list[dict[str, Any]], int | None]:
            response: httpx.Response | None = None
            for attempt in range(request_retries):
                try:
                    response = await client.get(f"{endpoint};siteNumber={site_number},limit={page_size},offset={offset}")
                    if response.status_code < 500 and response.status_code != 429:
                        break
                except httpx.HTTPError:
                    if attempt == request_retries - 1:
                        raise
                if attempt < request_retries - 1:
                    await asyncio.sleep(0.5 * (attempt + 1))
            if response is None:
                raise RuntimeError("Oracle HCM listing request did not return a response")
            response.raise_for_status()
            items = response.json().get("items", [])
            if not isinstance(items, list) or not items or not isinstance(items[0], dict):
                return [], None
            result = items[0]
            reported = result.get("TotalJobsCount")
            try:
                page_total = int(reported or 0) or None
            except (TypeError, ValueError):
                page_total = None
            page = result.get("requisitionList", [])
            return ([item for item in page if isinstance(item, dict)] if isinstance(page, list) else []), page_total

        async with httpx.AsyncClient(headers=headers, timeout=45) as client:
            for pass_number in range(coverage_retry_passes + 1):
                offset = 0
                boundary_retries = 0
                pass_complete = False
                pass_seen_keys: set[str] = set()
                pass_duplicate_count = 0
                pass_invalid_count = 0
                while True:
                    page, page_total = await fetch_page(client, offset)
                    if page_total:
                        total = max(total or 0, page_total)
                    if not page:
                        if total is not None and offset < total and boundary_retries < pagination_retries:
                            boundary_retries += 1
                            await asyncio.sleep(0.5 * boundary_retries)
                            continue
                        break
                    for item in page:
                        job_id = item.get("Id") or item.get("RequisitionId") or item.get("JobId")
                        if not job_id:
                            pass_invalid_count += 1
                            continue
                        key = str(job_id)
                        if key in pass_seen_keys:
                            pass_duplicate_count += 1
                        pass_seen_keys.add(key)
                        if key in seen_keys:
                            continue
                        seen_keys.add(key)
                        raw_jobs.append(item)
                    offset += len(page)
                    if total is not None and offset >= total:
                        pass_complete = True
                        break
                    if len(page) < page_size:
                        if total is not None and offset < total and boundary_retries < pagination_retries:
                            boundary_retries += 1
                            await asyncio.sleep(0.5 * boundary_retries)
                            continue
                        break
                    boundary_retries = 0
                # Oracle's reported total includes duplicate listings. A short
                # final page is complete when this pass has accounted for the
                # reported rows, even if the canonical ID count is smaller.
                if total is not None and len(pass_seen_keys) + pass_duplicate_count >= total:
                    pass_complete = True
                duplicate_count = max(duplicate_count, pass_duplicate_count)
                invalid_count = max(invalid_count, pass_invalid_count)
                source_complete = source_complete or pass_complete
                if (
                    total is None
                    or len(seen_keys) >= total
                    # A publisher total may count duplicate listings. Once
                    # this complete pass accounts for those rows, another
                    # full retry pass only adds latency without coverage.
                    or (pass_complete and len(seen_keys) + pass_duplicate_count >= total)
                    or pass_number >= coverage_retry_passes
                ):
                    break
                # Oracle can change the result set while it is being paged. A
                # complete retry pass recovers IDs omitted by a transient page
                # response without treating a small mismatch as an empty feed.
                await asyncio.sleep(0.75 * (pass_number + 1))

        canonical_count = len(raw_jobs)
        # A source total is a publisher-reported count, not a guaranteed
        # stable snapshot. Preserve the usable rows and expose the exact
        # mismatch instead of failing the whole company crawl and losing the
        # records that were returned.
        coverage_complete = bool(
            total is not None
            and canonical_count + duplicate_count >= total
            and source_complete
        )
        if total is not None:
            for item in raw_jobs:
                item["source_reported_count"] = total
                item["source_expected_count"] = canonical_count
                item["source_complete"] = coverage_complete
                item["source_invalid_count"] = invalid_count
                item["source_duplicate_count"] = duplicate_count
                item["source_missing_count"] = max(total - canonical_count, 0)
        jobs: list[RawJob] = []
        for job in raw_jobs:
            # The listing de-duplication above accepts Oracle's alternate
            # requisition identifiers too. Preserve the same stable key when
            # constructing the canonical URL, otherwise records without
            # ``Id`` collapse into the source URL during remote ingest.
            job_id = job.get("Id") or job.get("RequisitionId") or job.get("JobId")
            locations = [job.get("PrimaryLocation")]
            locations.extend(item.get("Name") for item in job.get("secondaryLocations", []) if isinstance(item, dict))
            locations.extend(item.get("TownOrCity") for item in job.get("otherWorkLocations", []) if isinstance(item, dict))
            location = "; ".join(str(value) for value in dict.fromkeys(locations) if value)
            description = job.get("ShortDescriptionStr") or job.get("ExternalResponsibilitiesStr") or job.get("ExternalQualificationsStr")
            jobs.append(RawJob(str(job_id) if job_id else None, job.get("Title", "Untitled"),
                               f"{jobs_base_url}/job/{job_id}" if job_id else source_url, location or None,
                               job.get("JobFamily") or job.get("JobFunction"), description, job))
        return jobs


class AvatureConnector(Connector):
    """Fetch the public, server-rendered job listings from an Avature portal."""

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = int(config.get("page_size", 10))
        if page_size < 1:
            raise ValueError("Avature page_size must be positive")
        params = dict(config.get("params", {}))
        params.setdefault("jobSort", "relevancy")
        page_size_param = str(config.get("page_size_param", "jobRecordsPerPage"))
        offset_param = str(config.get("offset_param", "jobOffset"))
        headers = {"User-Agent": get_settings().crawler_user_agent}
        total: int | None = None
        raw_jobs: list[dict[str, str]] = []

        async with httpx.AsyncClient(headers=headers, timeout=45, follow_redirects=True) as client:
            async def fetch_page(offset: int) -> tuple[int, list[dict[str, str]], int | None]:
                response: httpx.Response | None = None
                for attempt in range(3):
                    try:
                        response = await client.get(source_url, params={**params, page_size_param: page_size, offset_param: offset})
                        response.raise_for_status()
                        break
                    except httpx.HTTPError:
                        if attempt == 2:
                            raise
                if response is None:
                    raise RuntimeError("Avature request did not return a response")
                parser = _AvatureJobParser(); parser.feed(response.text)
                page_total: int | None = None
                match = re.search(r'data-total="(\d+)(\+)?"', response.text)
                if match and not match.group(2):
                    page_total = int(match.group(1))
                else:
                    match = re.search(r"\b\d+\s*-\s*\d+\s+of\s+(\d+)\s+results?\b", response.text, re.IGNORECASE)
                    if match:
                        page_total = int(match.group(1))
                return offset, parser.jobs, page_total

            # Large Avature boards expose `999+` instead of an exact total.
            # Fetch offset pages in bounded concurrent batches and stop on an
            # empty or repeated page instead of silently stopping at page one.
            next_offset = 0
            seen_urls: set[str] = set()
            while True:
                offsets = list(range(next_offset, next_offset + page_size * 8, page_size))
                pages = await asyncio.gather(*(fetch_page(offset) for offset in offsets))
                stop = False
                for offset, jobs, page_total in pages:
                    if page_total is not None:
                        total = page_total
                    if not jobs:
                        stop = True
                        break
                    page_urls = {job.get("url") for job in jobs if job.get("url")}
                    if page_urls and page_urls.issubset(seen_urls):
                        stop = True
                        break
                    raw_jobs.extend(job for job in jobs if job.get("url") and job.get("url") not in seen_urls)
                    seen_urls.update(page_urls)
                    if total is not None and offset + len(jobs) >= total:
                        stop = True
                        break
                if stop:
                    break
                next_offset += page_size * 8

        unique = {job["url"]: job for job in raw_jobs if job.get("url")}
        jobs: list[RawJob] = []
        for job in unique.values():
            external_id = job["url"].rstrip("/").rsplit("/", 1)[-1]
            parts = [part.strip() for part in job.get("subtitle", "").split("|") if part.strip()]
            location = job.get("location") or (parts[-1] if parts else None)
            # Deloitte's US Avature portal uses this label for US roles whose
            # listing covers more than one domestic office.
            if location == "Multiple Locations" and "apply.deloitte.com" in source_url:
                location = "United States (Multiple Locations)"
            jobs.append(RawJob(external_id, job["title"], urljoin(source_url, job["url"]),
                               location, parts[-2] if len(parts) > 1 else None,
                               None, {"avature_subtitle": job.get("subtitle") or None,
                                      "avature_location": job.get("location") or None}))
        return jobs


class BeesiteConnector(Connector):
    """Fetch jobs from a public Milch & Zucker Beesite search endpoint."""

    matched_object_descriptor = [
        "PositionID", "PositionTitle", "PositionURI", "ApplyURI",
        "PositionLocation.CityName", "PositionLocation.CountryName",
        "PositionLocation.CountryCode", "ProfessionName",
        "ProfessionCategoryName", "JobCategory.Name", "CareerLevel.Name",
        "PublicationStartDate",
    ]

    @staticmethod
    def valid_listing(item: Any) -> bool:
        """Return whether a Beesite row has an identity usable by the feed."""
        if not isinstance(item, dict):
            return False
        if item.get("MatchedObjectId") not in (None, "", []):
            return True
        descriptor = item.get("MatchedObjectDescriptor")
        return isinstance(descriptor, dict) and any(
            descriptor.get(key) not in (None, "", [])
            for key in ("PositionID", "PositionTitle", "PositionURI", "ApplyURI")
        )

    @classmethod
    def raw_job(cls, item: dict[str, Any], source_url: str, detail_url_template: str | None = None) -> RawJob:
        descriptor = item.get("MatchedObjectDescriptor", item)
        position_id = descriptor.get("PositionID") or item.get("MatchedObjectId")
        apply_urls = descriptor.get("ApplyURI") or []
        if isinstance(apply_urls, str):
            apply_urls = [apply_urls]
        position_url = (
            detail_url_template.format(job_id=position_id)
            if detail_url_template and position_id
            else apply_urls[0] if apply_urls else descriptor.get("PositionURI")
        )
        locations = descriptor.get("PositionLocation") or []
        if isinstance(locations, dict):
            locations = [locations]
        location = "; ".join(
            ", ".join(str(place.get(key)) for key in ("CityName", "CountryName") if place.get(key))
            for place in locations if isinstance(place, dict)
        ) or None
        career_levels = descriptor.get("CareerLevel") or []
        if isinstance(career_levels, dict):
            career_levels = [career_levels]
        categories = descriptor.get("JobCategory") or []
        if isinstance(categories, dict):
            categories = [categories]
        department = (
            descriptor.get("ProfessionCategoryName")
            or descriptor.get("ProfessionName")
            or next((category.get("Name") for category in categories if isinstance(category, dict) and category.get("Name")), None)
            or next((level.get("Name") for level in career_levels if isinstance(level, dict) and level.get("Name")), None)
        )
        return RawJob(
            str(position_id) if position_id else None,
            descriptor.get("PositionTitle", "Untitled"),
            urljoin(source_url, position_url) if position_url else source_url,
            location,
            department,
            None,
            descriptor,
        )

    @classmethod
    async def fetch_detail(cls, client: httpx.AsyncClient, raw: RawJob, config: dict[str, Any]) -> RawJob:
        """Fetch the official Beesite JSON detail resource for a position."""
        position_id = raw.payload.get("PositionID") or raw.external_job_id
        if not position_id:
            raise ValueError("Beesite listing has no PositionID for detail fetch")
        template = config.get("detail_api_url_template")
        if template:
            detail_url = str(template).format(job_id=position_id, position_id=position_id)
        else:
            parsed = urlparse(str(config.get("api_url") or ""))
            if not parsed.scheme or not parsed.netloc:
                raise ValueError("Beesite requires api_url or detail_api_url_template for detail fetch")
            detail_url = f"{parsed.scheme}://{parsed.netloc}/jobhtml/{position_id}.json"
        response = await client.get(detail_url)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("Beesite detail response was not an object")
        description = payload.get("html") or payload.get("description")
        detail_payload = dict(raw.payload or {})
        detail_payload["detail_url"] = detail_url
        detail_payload["detail_payload"] = payload
        if description:
            detail_payload["detail_status"] = "fetched_json"
        else:
            detail_payload["detail_status"] = "detail_unavailable"
            detail_payload["detail_status_reason"] = "Beesite detail JSON contained no public HTML"
        department = raw.department or payload.get("pro_div_name") or payload.get("profession_category")
        return RawJob(raw.external_job_id, raw.title, raw.url, raw.location, department,
                      str(description) if description else None, detail_payload)

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = int(config.get("page_size", 100))
        if page_size < 1:
            raise ValueError("Beesite page_size must be positive")
        language_code = str(config.get("language_code", "EN")).upper()
        endpoint = config.get("api_url") or source_url
        raw_jobs: list[dict[str, Any]] = []
        first_item = 1
        total: int | None = None
        headers = {"User-Agent": get_settings().crawler_user_agent}
        async with httpx.AsyncClient(headers=headers, timeout=45, follow_redirects=True) as client:
            while True:
                payload = {
                    "LanguageCode": language_code,
                    "SearchParameters": {
                        "FirstItem": first_item,
                        "CountItem": page_size,
                        "MatchedObjectDescriptor": self.matched_object_descriptor,
                        "Sort": [{"Criterion": "PublicationStartDate", "Direction": "DESC"}],
                    },
                    "SearchCriteria": config.get("search_criteria", []),
                }
                response = await client.get(f"{endpoint.rstrip('/')}/", params={"data": json.dumps(payload, separators=(",", ":"))})
                response.raise_for_status()
                result = response.json().get("SearchResult", {})
                page = result.get("SearchResultItems", [])
                if not isinstance(page, list) or not page:
                    break
                # Beesite wraps the stable id and title inside
                # ``MatchedObjectDescriptor`` rather than returning the flat
                # Workday fields. Keep only rows with a usable Beesite
                # identity; malformed placeholders must not be treated as a
                # complete source.
                raw_jobs.extend(
                    item for item in page
                    if self.valid_listing(item)
                )
                if total is None:
                    total = int(result.get("SearchResultCountAll") or result.get("SearchResultCount") or 0)
                first_item += len(page)
                if total and len(raw_jobs) >= total:
                    break
        return [self.raw_job(item, source_url, config.get("detail_url_template")) for item in raw_jobs]


class TalentGatewayConnector(Connector):
    """Fetch jobs from the public Talent Gateway search flow."""

    @staticmethod
    def _hidden_value(page: str, field_name: str) -> str:
        match = re.search(
            rf'<input[^>]+(?:id|name)=["\']{re.escape(field_name)}["\'][^>]*?value=["\']([^"\']*)',
            page,
            re.IGNORECASE,
        )
        if not match:
            raise ValueError(f"Talent Gateway page did not contain {field_name}")
        return unescape(match.group(1))

    @classmethod
    def _preload_data(cls, page: str) -> dict[str, Any]:
        value = cls._hidden_value(page, "preLoadJSON")
        data = json.loads(value)
        if not isinstance(data, dict):
            raise ValueError("Talent Gateway preload payload was not an object")
        search = data.get("SmartSearchJSONValue")
        if isinstance(search, str):
            data["SmartSearchJSONValue"] = json.loads(search)
        return data

    @staticmethod
    def _question_values(job: dict[str, Any]) -> dict[str, str]:
        return {
            str(question.get("QuestionName", "")).lower(): str(question.get("Value", "")).strip()
            for question in job.get("Questions", [])
            if isinstance(question, dict) and question.get("QuestionName") and question.get("Value") is not None
        }

    @classmethod
    def raw_job(cls, job: dict[str, Any], source_url: str) -> RawJob:
        values = cls._question_values(job)
        job_id = values.get("reqid")
        location = values.get("location") or values.get("formtext23") or values.get("country")
        description = values.get("jobdescription") or None
        return RawJob(
            job_id or None,
            values.get("jobtitle") or "Untitled",
            job.get("Link") or source_url,
            location or None,
            values.get("department") or values.get("formtext21") or None,
            description,
            _official_listing_payload(job, description),
        )

    @staticmethod
    def _page_jobs(data: dict[str, Any]) -> list[dict[str, Any]]:
        jobs_container = data.get("Jobs") or {}
        jobs = jobs_container.get("Job", []) if isinstance(jobs_container, dict) else []
        return jobs if isinstance(jobs, list) else []

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        headers = {"User-Agent": get_settings().crawler_user_agent, "Referer": source_url}
        async with httpx.AsyncClient(headers=headers, timeout=45, follow_redirects=True) as client:
            response = await client.get(source_url)
            response.raise_for_status()
            preload = self._preload_data(response.text)
            search = preload.get("SmartSearchJSONValue", {})
            first_page = preload.get("searchResultsResponse", {})
            if not isinstance(search, dict) or not isinstance(first_page, dict):
                raise ValueError("Talent Gateway preload response was incomplete")
            token = self._hidden_value(response.text, "__RequestVerificationToken")
            page_size = max(1, len(self._page_jobs(first_page)))
            total = int(first_page.get("JobsCount") or preload.get("TotalCount") or 0)
            raw_jobs = self._page_jobs(first_page)
            if total <= 0:
                return []
            page_count = (total + page_size - 1) // page_size
            endpoint = str(config.get("pagination_endpoint") or "/TgNewUI/Search/Ajax/ProcessSortAndShowMoreJobs")
            endpoint_url = urljoin(source_url, endpoint)
            link_id = str(config.get("link_id") or parse_qs(urlparse(source_url).query).get("LinkID", [""])[0] or search.get("LinkID") or "")
            for page_number in range(2, page_count + 1):
                payload = {
                    "partnerId": search.get("PartnerId"), "siteId": search.get("SiteId"),
                    "keyword": search.get("Keyword") or "", "location": search.get("Location") or "",
                    "keywordCustomSolrFields": search.get("KeywordCustomSolrFields"),
                    "locationCustomSolrFields": search.get("LocationCustomSolrFields"),
                    "facetfilterfields": search.get("FacetFilterFields") or {"Facet": []},
                    "powersearchoptions": search.get("PowerSearchOptions") or {"PowerSearchOption": []},
                    "linkId": link_id, "Latitude": search.get("Latitude") or 0,
                    "Longitude": search.get("Longitude") or 0, "SortType": search.get("SortType") or "LastUpdated",
                    "pageNumber": page_number, "encryptedSessionValue": search.get("EncryptedSessionValue"),
                }
                page_response = await client.post(endpoint_url, json=payload, headers={"RFT": token})
                page_response.raise_for_status()
                page_jobs = self._page_jobs(page_response.json())
                if not page_jobs:
                    break
                raw_jobs.extend(page_jobs)
        unique = {
            self._question_values(job).get("reqid") or str(index): job
            for index, job in enumerate(raw_jobs)
            if isinstance(job, dict)
        }
        return [self.raw_job(job, source_url) for job in unique.values()]


class RssConnector(Connector):
    """Fetch a public RSS job feed published by an employer portal."""

    @staticmethod
    def _request_targets(source_url: str, config: dict[str, Any]) -> list[dict[str, Any]]:
        """Build ordered official request targets for restricted deployments.

        A target may be a URL string or an object with per-target headers and TLS
        settings. The canonical source URL remains the provenance URL; alternate
        targets are only transport addresses for the same official feed.
        """
        base_headers: dict[str, str] = {"User-Agent": get_settings().crawler_user_agent}
        configured_headers = config.get("headers", {})
        if isinstance(configured_headers, dict):
            base_headers.update({str(key): str(value) for key, value in configured_headers.items()})
        base_verify = config.get("verify_tls", True)
        configured_targets = config.get("fetch_targets")
        if isinstance(configured_targets, list) and configured_targets:
            targets: list[dict[str, Any]] = []
            for item in configured_targets:
                if isinstance(item, str) and item.strip():
                    targets.append({"url": item.strip(), "headers": dict(base_headers), "verify": base_verify})
                elif isinstance(item, dict) and str(item.get("url") or "").strip():
                    headers = dict(base_headers)
                    item_headers = item.get("headers", {})
                    if isinstance(item_headers, dict):
                        headers.update({str(key): str(value) for key, value in item_headers.items()})
                    targets.append({
                        "url": str(item["url"]).strip(),
                        "headers": headers,
                        "verify": item.get("verify_tls", base_verify),
                    })
            if targets:
                return targets
        urls = [str(config.get("fetch_url") or source_url)]
        fallback_urls = config.get("fallback_fetch_urls", [])
        if isinstance(fallback_urls, list):
            urls.extend(str(url).strip() for url in fallback_urls if str(url).strip())
        unique_urls = list(dict.fromkeys(urls))
        return [{"url": url, "headers": dict(base_headers), "verify": base_verify} for url in unique_urls]

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        timeout = float(config.get("timeout", 45))
        retry_attempts = max(1, min(int(config.get("retry_attempts", 2)), 4))
        # A source may publish a canonical hostname while a permitted fixed
        # endpoint is needed from a restricted network. TLS verification is
        # enabled by default and must be explicitly disabled for such a source.
        response = None
        request_url = source_url
        target_errors: list[str] = []
        for target in self._request_targets(source_url, config):
            request_url = str(target["url"])
            try:
                async with httpx.AsyncClient(
                    headers=target["headers"], timeout=timeout, follow_redirects=True, verify=target["verify"]
                ) as client:
                    for attempt in range(retry_attempts):
                        try:
                            candidate = await client.get(request_url)
                            candidate.raise_for_status()
                            response = candidate
                            break
                        except httpx.HTTPStatusError as exc:
                            # Client errors such as 403 are deterministic for a
                            # target; retry only transient 5xx responses.
                            status_code = exc.response.status_code if exc.response is not None else None
                            if status_code is not None and status_code < 500:
                                raise
                            if attempt == retry_attempts - 1:
                                raise
                            await asyncio.sleep(0.5 * (attempt + 1))
                        except httpx.HTTPError:
                            if attempt == retry_attempts - 1:
                                raise
                            await asyncio.sleep(0.5 * (attempt + 1))
                if response is not None:
                    break
            except Exception as exc:
                target_errors.append(f"{request_url}: {type(exc).__name__}")
        if response is None:
            detail = "; ".join(target_errors)
            raise RuntimeError(f"RSS source did not return a response{': ' + detail if detail else ''}")
        record_endpoint = request_url != source_url or bool(config.get("fetch_url")) or bool(config.get("fetch_targets"))
        root = ET.fromstring(response.content)
        # Oleeo/TAL publishes Atom feeds while several other ATSs publish RSS
        # 2.0. Keep one adapter for both public XML formats.
        atom_entries = [node for node in root if node.tag.rsplit("}", 1)[-1] == "entry"]
        if atom_entries:
            jobs: list[RawJob] = []
            for entry in atom_entries:
                children = {node.tag.rsplit("}", 1)[-1]: node for node in entry}
                title = (children.get("title").text if children.get("title") is not None else None) or "Untitled"
                link_node = children.get("link")
                url = ((link_node.get("href") if link_node is not None else None)
                       or (children.get("id").text if children.get("id") is not None else None)
                       or source_url).strip()
                match = re.search(r"/opp/(\d+)(?:-|/)", url)
                job_id = match.group(1) if match else url.rstrip("/").rsplit("/", 1)[-1]
                description_node = children.get("summary")
                if description_node is None:
                    description_node = children.get("content")
                description = "".join(description_node.itertext()).strip() if description_node is not None else None
                jobs.append(RawJob(job_id or None, title.strip(), url, None, None, description or None, {
                    "published_at": (children.get("published").text if children.get("published") is not None else None),
                    "updated_at": (children.get("updated").text if children.get("updated") is not None else None),
                    "rss_guid": (children.get("id").text if children.get("id") is not None else None),
                }))
            if record_endpoint:
                for job in jobs:
                    job.payload["fetch_endpoint"] = request_url
            return jobs
        jobs: list[RawJob] = []
        for item in root.findall("./channel/item"):
            title = (item.findtext("title") or "Untitled").strip()
            url = (item.findtext("link") or item.findtext("guid") or source_url).strip()
            job_id = url.rstrip("/").rsplit("/", 1)[-1]
            location = (item.findtext("description") or "").strip() or None
            jobs.append(RawJob(job_id or None, title, url, location, None, None, {
                "published_at": item.findtext("pubDate"), "rss_guid": item.findtext("guid"),
            }))
        if record_endpoint:
            for job in jobs:
                job.payload["fetch_endpoint"] = request_url
        return jobs


class SitemapConnector(Connector):
    """Read roles exposed in an employer's official XML sitemap.

    Some career sites protect the listing page but publish a crawlable career
    sitemap. The sitemap URL and slug are still official, verifiable job
    records; optional title/location rules are kept in source configuration.
    """

    @staticmethod
    def _slug_title(url: str) -> str:
        slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1]
        return re.sub(r"\s+", " ", slug.replace("-", " ").replace("_", " ")).strip().title() or "Untitled"

    @staticmethod
    def _infer_location(url: str, config: dict[str, Any]) -> str | None:
        """Infer only a region explicitly encoded in the official URL slug.

        This is intentionally conservative: a missing location stays missing;
        the connector never invents a city from an unrelated job title.
        """
        slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1].lower()
        configured = config.get("location_map", {})
        if isinstance(configured, dict):
            for token, label in configured.items():
                if re.search(rf"(?:^|-){re.escape(str(token).lower())}(?:-|$)", slug):
                    return str(label)
        for token, label in (
            ("new-york", "New York"), ("hong-kong", "Hong Kong"),
            ("san-francisco", "San Francisco"), ("singapore", "Singapore"),
            ("london", "London"), ("chicago", "Chicago"),
            ("miami", "Miami"), ("toronto", "Toronto"),
            ("shanghai", "Shanghai"), ("zurich", "Zurich"),
            ("dubai", "Dubai"), ("paris", "Paris"),
            ("asia", "Asia"), ("europe", "Europe"),
            ("americas", "Americas"), ("us", "United States"),
        ):
            if re.search(rf"(?:^|-){re.escape(token)}(?:-|$)", slug):
                return label
        return None

    @staticmethod
    def _infer_department(url: str, config: dict[str, Any]) -> str | None:
        slug = urlparse(url).path.rstrip("/").rsplit("/", 1)[-1].lower()
        configured = config.get("department_map", {})
        if isinstance(configured, dict):
            for prefix, label in configured.items():
                if slug.startswith(str(prefix).lower()):
                    return str(label)
        for prefix, label in (
            ("global-quantitative-strategies", "Global Quantitative Strategies"),
            ("international-equities", "International Equities"),
            ("investment-trading", "Investment & Trading"),
            ("commodities", "Commodities"), ("equities", "Equities"),
            ("operations", "Operations"), ("campus-referrals", "Campus Recruiting"),
        ):
            if slug.startswith(prefix):
                return label
        return None

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        timeout = float(config.get("timeout", 45))
        retry_attempts = max(1, min(int(config.get("retry_attempts", 2)), 4))
        request_headers = {"User-Agent": get_settings().crawler_user_agent}
        configured_headers = config.get("headers", {})
        if isinstance(configured_headers, dict):
            request_headers.update({str(key): str(value) for key, value in configured_headers.items()})
        async with httpx.AsyncClient(headers=request_headers, timeout=timeout, follow_redirects=True) as client:
            response: httpx.Response | None = None
            for attempt in range(retry_attempts):
                try:
                    candidate = await client.get(source_url)
                    candidate.raise_for_status()
                    response = candidate
                    break
                except httpx.HTTPStatusError as exc:
                    status_code = exc.response.status_code if exc.response is not None else None
                    if status_code is not None and status_code < 500:
                        raise
                    if attempt == retry_attempts - 1:
                        raise
                    await asyncio.sleep(0.5 * (attempt + 1))
                except httpx.HTTPError:
                    if attempt == retry_attempts - 1:
                        raise
                    await asyncio.sleep(0.5 * (attempt + 1))
            if response is None:
                raise RuntimeError("Sitemap source did not return a response")
        root = ET.fromstring(response.content)
        urls = []
        for node in root.iter():
            if node.tag.rsplit("}", 1)[-1] == "url":
                loc = next((child.text.strip() for child in node if child.tag.rsplit("}", 1)[-1] == "loc" and child.text), None)
                lastmod = next((child.text.strip() for child in node if child.tag.rsplit("}", 1)[-1] == "lastmod" and child.text), None)
                if loc:
                    urls.append((loc, lastmod))
        prefix = str(config.get("url_prefix", ""))
        if prefix:
            urls = [(url, lastmod) for url, lastmod in urls if url.startswith(prefix)]
        max_jobs = max(1, int(config.get("max_jobs", 1000)))
        urls = urls[:max_jobs]
        title_template = config.get("title_template")
        jobs: list[RawJob] = []
        for url, lastmod in urls:
            title = str(title_template).format(url=url) if title_template else self._slug_title(url)
            external_id = url.rstrip("/").rsplit("/", 1)[-1]
            location = config.get("location") or self._infer_location(url, config)
            department = config.get("department") or self._infer_department(url, config)
            jobs.append(RawJob(external_id or None, title, url, location, department, None,
                               {"sitemap_url": source_url, "sitemap_lastmod": lastmod,
                                "metadata_quality": "sitemap_only",
                                "detail_status": "not_fetched",
                                "detail_status_reason": "Official detail page is protected by upstream access control"}))
        return jobs


class _RothschildListingParser(HTMLParser):
    """Parse Rothschild & Co's public career listing cards."""

    void_tags = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

    def __init__(self) -> None:
        super().__init__()
        self.in_card = False
        self.depth = 0
        self.field: str | None = None
        self.current: dict[str, str] = {}
        self.jobs: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        classes = values.get("class", "").split()
        if tag == "article" and "roths-career-office-event-card" in classes:
            self.in_card, self.depth, self.field, self.current = True, 1, None, {}
            return
        if not self.in_card:
            return
        if tag not in self.void_tags:
            self.depth += 1
        if tag == "h3" and "roths-career-office-event-card-title" in classes:
            self.field = "title"
        elif tag == "span" and "roths-career-office-event-card-tag" in classes:
            self.field = "department"
        elif tag == "li" and "roths-career-office-event-card-detail" in classes:
            self.field = "location"
        elif tag == "a" and "uid-clickable" in classes and values.get("href"):
            self.current["url"] = values["href"]

    def handle_data(self, data: str) -> None:
        if self.in_card and self.field:
            value = " ".join(data.split())
            if value:
                self.current[self.field] = f"{self.current.get(self.field, '')} {value}".strip()

    def handle_endtag(self, tag: str) -> None:
        if not self.in_card:
            return
        if tag in {"h3", "span", "li"}:
            self.field = None
        if tag != "article" and tag not in self.void_tags:
            self.depth -= 1
        if tag == "article" and self.depth == 1:
            if self.current.get("title") and self.current.get("url"):
                self.jobs.append(self.current)
            self.in_card, self.depth, self.field, self.current = False, 0, None, {}


class RothschildWebConnector(Connector):
    """Fetch public Rothschild & Co opportunity cards from its official site."""

    @staticmethod
    def raw_job(item: dict[str, str], source_url: str) -> RawJob:
        original_url = urljoin(source_url, item["url"])
        external_id = original_url.rstrip("/").rsplit("/", 1)[-1]
        # Tal links intermittently time out from server/cloud egress. Keep a
        # stable, clickable official listing fallback when no first-party
        # opportunity page exists; the original link remains auditable.
        if "tal.net" in (urlparse(original_url).netloc or "").lower():
            url = f"{source_url.split('?', 1)[0]}?{urlencode({'job': external_id})}"
            payload = {**item, "original_job_url": original_url,
                       "link_repaired": True, "link_repair_reason": "official_listing_fallback"}
        else:
            url = original_url
            payload = item
        return RawJob(external_id or None, item.get("title", "Untitled"), url,
                      item.get("location"), item.get("department"), None, payload)

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = max(1, int(config.get("page_size", 50)))
        max_pages = max(1, int(config.get("max_pages", 20)))
        attempts = max(1, int(config.get("retry_attempts", 2)))
        page_number = max(1, int(config.get("start_page", 1)))
        raw_jobs: list[dict[str, str]] = []
        async with httpx.AsyncClient(headers={"User-Agent": get_settings().crawler_user_agent}, timeout=float(config.get("timeout", 30)), follow_redirects=True) as client:
            for _ in range(max_pages):
                response: httpx.Response | None = None
                for attempt in range(attempts):
                    try:
                        response = await client.get(source_url, params={"page": page_number})
                        response.raise_for_status()
                        break
                    except httpx.HTTPError:
                        if attempt == attempts - 1:
                            raise
                        await asyncio.sleep(0.5 * (attempt + 1))
                if response is None:
                    raise RuntimeError("Rothschild request did not return a response")
                parser = _RothschildListingParser()
                parser.feed(response.text)
                if not parser.jobs:
                    break
                raw_jobs.extend(parser.jobs)
                if len(parser.jobs) < page_size:
                    break
                page_number += 1
        # A role can be published twice: once on the official Rothschild page
        # and once on Tal. Prefer the first-party URL for the same title/location
        # so a later crawl cannot reopen a duplicate dead-link record.
        unique: dict[str, dict[str, str]] = {}
        for item in raw_jobs:
            if not item.get("url"):
                continue
            key = re.sub(r"\s+", " ", f"{item.get('title', '')}\x00{item.get('location', '')}".casefold()).strip()
            previous = unique.get(key)
            if previous is None or ("tal.net" in str(previous.get("url", "")) and "tal.net" not in str(item.get("url", ""))):
                unique[key] = item
        return [self.raw_job(item, source_url) for item in unique.values()]


class BainConnector(Connector):
    """Fetch roles from Bain & Company's public careers JSON endpoint."""

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = min(max(int(config.get("page_size", 100)), 1), 100)
        raw_jobs: list[dict[str, Any]] = []
        page_number = int(config.get("start", 0))
        total: int | None = None
        params = {"results": page_size, "filters": str(config.get("filters", "")), "searchValue": str(config.get("search_value", ""))}
        async with httpx.AsyncClient(headers={
            "User-Agent": get_settings().crawler_user_agent,
            "Accept": "application/json",
            "Referer": str(config.get("referer") or "https://www.bain.com/careers/find-a-role/"),
        }, timeout=45, follow_redirects=True) as client:
            while True:
                response = await client.get(source_url, params={**params, "start": page_number})
                response.raise_for_status()
                data = response.json()
                page = data.get("results", []) if isinstance(data, dict) else []
                if not isinstance(page, list) or not page:
                    break
                raw_jobs.extend(item for item in page if isinstance(item, dict))
                total = total if total is not None else int(data.get("totalResults") or 0)
                page_number += 1
                if total and len(raw_jobs) >= total:
                    break
                if len(page) < page_size:
                    break
        jobs: list[RawJob] = []
        for item in raw_jobs:
            job_id = item.get("JobId")
            location = item.get("Location")
            if isinstance(location, list):
                location = "; ".join(str(value) for value in location if value)
            category = item.get("Categories")
            if isinstance(category, list):
                category = "; ".join(str(value) for value in category if value)
            jobs.append(RawJob(str(job_id) if job_id is not None else None,
                               item.get("JobTitle", "Untitled"), item.get("Link") or source_url,
                               location or None, category or item.get("EmployeeType"),
                               item.get("JobDescription"), item))
        unique = {str(job.external_job_id or job.url): job for job in jobs}
        return list(unique.values())


class McKinseyConnector(Connector):
    """Fetch roles from McKinsey's public careers search API."""

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = min(max(int(config.get("page_size", 100)), 1), 100)
        language = str(config.get("language", "en"))
        raw_jobs: list[dict[str, Any]] = []
        start = int(config.get("start", 1))
        total: int | None = None
        fetched = 0
        query = str(config.get("query", ""))
        async with httpx.AsyncClient(headers={
            "User-Agent": get_settings().crawler_user_agent,
            "Accept": "application/json",
            "Referer": "https://www.mckinsey.com/careers/search-jobs",
        }, timeout=45, follow_redirects=True) as client:
            while True:
                params: dict[str, Any] = {"pageSize": page_size, "start": start, "lang": language}
                if query:
                    params["query"] = query
                response = await client.get(source_url, params=params)
                response.raise_for_status()
                data = response.json()
                page = data.get("docs", []) if isinstance(data, dict) else []
                if not isinstance(page, list) or not page:
                    break
                raw_jobs.extend(item for item in page if isinstance(item, dict))
                total = total if total is not None else int(data.get("numFound") or 0)
                fetched += len(page)
                start += 1
                if total and fetched >= total:
                    break
                if len(page) < page_size:
                    break
        jobs: list[RawJob] = []
        for item in raw_jobs:
            job_id = item.get("jobID")
            cities = item.get("cities") or []
            countries = item.get("countries") or []
            locations = cities if isinstance(cities, list) else [cities]
            location = "; ".join(str(value) for value in locations if value)
            department = item.get("interest") or item.get("interestCategory")
            url = item.get("jobApplyURL") or (f"https://www.mckinsey.com/careers/search-jobs/jobs/{item.get('friendlyURL')}" if item.get("friendlyURL") else source_url)
            description = item.get("whatYouWillDo") or item.get("yourBackground") or item.get("whoYouWillWorkWith")
            jobs.append(RawJob(str(job_id) if job_id is not None else None,
                               item.get("title", "Untitled"), url, location or None,
                               department, description, _official_listing_payload(item, description)))
        unique = {str(job.external_job_id or job.url): job for job in jobs}
        return list(unique.values())


class EightfoldConnector(Connector):
    """Fetch public positions embedded in an Eightfold career page."""

    @staticmethod
    def _page_data(page: str) -> dict[str, Any]:
        match = re.search(r'<code id=["\']smartApplyData["\'][^>]*>(.*?)</code>', page, re.IGNORECASE | re.DOTALL)
        if not match:
            raise ValueError("Eightfold page did not contain smartApplyData")
        data = json.loads(unescape(match.group(1)))
        if not isinstance(data, dict):
            raise ValueError("Eightfold smartApplyData was not an object")
        return data

    @staticmethod
    def raw_job(position: dict[str, Any], source_url: str) -> RawJob:
        locations = position.get("locations") or []
        location = position.get("location") or ("; ".join(str(value) for value in locations if value) or None)
        external_id = position.get("ats_job_id") or position.get("display_job_id") or position.get("id")
        position_id = position.get("id")
        public_url = position.get("publicUrl")
        if not public_url and position_id:
            public_url = f"https://{urlparse(source_url).hostname or 'morganstanley.eightfold.ai'}/careers/job/{position_id}"
        return RawJob(
            str(external_id) if external_id is not None else None,
            position.get("posting_name") or position.get("name") or "Untitled",
            position.get("canonicalPositionUrl") or public_url or source_url,
            location,
            position.get("department") or position.get("business_unit"),
            position.get("job_description") or None,
            position,
        )

    @classmethod
    async def fetch_detail(cls, client: httpx.AsyncClient, raw: RawJob, config: dict[str, Any]) -> RawJob:
        """Fetch Eightfold PCS position details from the public JSON endpoint."""
        position_id = raw.payload.get("id") or raw.payload.get("position_id") or raw.external_job_id
        domain = str(config.get("domain") or "")
        api_host = str(config.get("api_host") or urlparse(raw.url).hostname or "").rstrip("/")
        if not position_id or not api_host or not domain:
            raise ValueError("Eightfold detail requires position ID, api_host and domain")
        endpoint = str(config.get("detail_api_url") or f"https://{api_host}/api/pcsx/position_details")
        response = await client.get(endpoint, params={"position_id": position_id, "domain": domain, "hl": str(config.get("language") or "en")})
        response.raise_for_status()
        body = response.json()
        data = body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), dict) else body
        if not isinstance(data, dict):
            raise ValueError("Eightfold detail response did not contain a position")
        payload = dict(raw.payload or {})
        payload.update(data)
        payload["detail_status"] = "fetched_json"
        payload["detail_url"] = endpoint
        description = data.get("jobDescription") or data.get("job_description") or data.get("description")
        return RawJob(raw.external_job_id, data.get("name") or raw.title, raw.url,
                      data.get("location") or raw.location,
                      data.get("department") or raw.department,
                      description, payload)

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = max(1, int(config.get("page_size", 10)))
        raw_positions: list[dict[str, Any]] = []
        offset = 0
        total: int | None = None
        async with httpx.AsyncClient(headers={"User-Agent": get_settings().crawler_user_agent}, timeout=45, follow_redirects=True) as client:
            api_url = config.get("api_url")
            if api_url:
                # Eightfold exposes the same public endpoint used by the career page's
                # "show more" control. It is paginated by start/num and reports the
                # complete count in the JSON response.
                api_params = dict(config.get("params", {}))
                api_params.setdefault("domain", config.get("domain") or urlparse(source_url).hostname or "")
                sort_by = config.get("sort_by", "relevance")
                while True:
                    response = await client.get(api_url, params={**api_params, "start": offset, "num": page_size, "sort_by": sort_by})
                    response.raise_for_status()
                    envelope = response.json()
                    data = envelope.get("data", envelope) if isinstance(envelope, dict) else envelope
                    page = data.get("positions", []) if isinstance(data, dict) else []
                    if not isinstance(page, list) or not page:
                        break
                    raw_positions.extend(position for position in page if isinstance(position, dict))
                    if total is None and isinstance(data, dict):
                        try:
                            total = int(data.get("count") or 0)
                        except (TypeError, ValueError):
                            total = 0
                    offset += len(page)
                    if total and offset >= total:
                        break
                    # This PCS endpoint currently caps responses at ten rows
                    # even when it accepts a larger `num`.  Its advertised
                    # total is authoritative, so a short page is not EOF.
            else:
                while True:
                    response = await client.get(source_url, params={"start": offset} if offset else None)
                    response.raise_for_status()
                    data = self._page_data(response.text)
                    page = data.get("positions", [])
                    if not isinstance(page, list) or not page:
                        break
                    raw_positions.extend(position for position in page if isinstance(position, dict))
                    total = total if total is not None else int(data.get("count") or 0)
                    offset += len(page)
                    if total and offset >= total:
                        break
                    if len(page) < page_size:
                        break
        unique = {str(position.get("id") or position.get("ats_job_id") or index): position for index, position in enumerate(raw_positions)}
        return [self.raw_job(position, source_url) for position in unique.values()]


class WorkdayConnector(Connector):
    # Workday's listing response is not consistent across tenants. Some
    # tenants expose an explicit department/job-family field, while others
    # only expose ``bulletFields`` containing a requisition id plus a human
    # readable classification. Keep this extraction deliberately conservative:
    # a missing department is preferable to turning an id, date, or city into
    # a misleading department.
    _CLASSIFICATION_KEYS = (
        "department", "jobFamily", "jobFunction", "jobCategory", "category",
        "businessUnit", "businessUnitName", "division", "organization",
        "jobProfile",
    )
    _CLASSIFICATION_STOPWORDS = {
        "featured job", "spotlight job", "new job", "hot job", "remote",
        "hybrid", "on-site", "onsite", "full time", "part time", "temporary",
        "regular", "contract", "location negotiable",
    }

    @staticmethod
    def _text_values(value: Any):
        """Yield human-readable values from Workday scalar/list/object fields."""
        if isinstance(value, (list, tuple, set)):
            for item in value:
                yield from WorkdayConnector._text_values(item)
            return
        if isinstance(value, dict):
            for key in ("descriptor", "displayValue", "name", "value", "text"):
                if value.get(key) not in (None, "", []):
                    yield from WorkdayConnector._text_values(value[key])
            return
        if value not in (None, ""):
            yield str(value)

    @staticmethod
    def _normalized(value: str) -> str:
        return re.sub(r"\s+", " ", value).strip().casefold()

    @classmethod
    def _location_values(cls, job: dict[str, Any], location: str | None) -> set[str]:
        values: list[str] = []
        for key in (
            "location", "locationsText", "primaryLocation", "locationDescriptor",
            "jobRequisitionLocation", "additionalLocations", "locations",
        ):
            values.extend(cls._text_values(job.get(key)))
        if location:
            values.append(location)
        normalized: set[str] = set()
        for value in values:
            for part in re.split(r"[;|]", value):
                item = cls._normalized(part)
                if item:
                    normalized.add(item)
        return normalized

    @classmethod
    def _valid_classification(cls, value: str, location_values: set[str]) -> str | None:
        cleaned = re.sub(r"\s+", " ", value).strip(" ,;|")
        if not cleaned or len(cleaned) > 255:
            return None
        normalized = cls._normalized(cleaned)
        if normalized in cls._CLASSIFICATION_STOPWORDS:
            return None
        if normalized in location_values:
            return None
        # Requisition ids and date/status markers are common bullet fields.
        # Reject any numeric or URL-like value rather than guessing its meaning.
        if re.search(r"\d|https?://|www\.|@", cleaned, re.IGNORECASE):
            return None
        if re.search(r"posting\s+end\s+date|posted\s+\d+|^location\b", normalized):
            return None
        if not re.search(r"[A-Za-z]", cleaned):
            return None
        return cleaned

    @classmethod
    def extract_department(cls, job: dict[str, Any], location: str | None = None) -> str | None:
        """Extract only an explicit, non-id Workday classification label."""
        sources = [job]
        detail_payload = job.get("detail_payload")
        if isinstance(detail_payload, dict):
            sources.append(detail_payload)
        location_values = cls._location_values(job, location)
        # Explicit fields are authoritative and are checked before the
        # less-structured bullet list.
        for source in sources:
            for key in cls._CLASSIFICATION_KEYS:
                for value in cls._text_values(source.get(key)):
                    valid = cls._valid_classification(value, location_values)
                    if valid:
                        return valid
        for source in sources:
            for value in cls._text_values(source.get("bulletFields")):
                valid = cls._valid_classification(value, location_values)
                if valid:
                    return valid
        return None

    @staticmethod
    def detail_api_url(api_url: str, external_path: str | None) -> str | None:
        if not external_path:
            return None
        base = api_url.rstrip("/")
        if base.endswith("/jobs"):
            base = base[:-5]
        path = str(external_path).strip()
        return f"{base}/{path.lstrip('/')}"

    @staticmethod
    def public_job_url(source_url: str, external_path: str | None) -> str:
        if not external_path:
            return source_url
        parsed_path = urlparse(external_path)
        if parsed_path.scheme and parsed_path.netloc:
            return external_path
        source = urlparse(source_url)
        parts = [part for part in source.path.split("/") if part]
        if parts and parts[-1].lower() in {"login", "userhome"}:
            parts.pop()
        base = f"{source.scheme}://{source.netloc}"
        if parts:
            base = f"{base}/{'/'.join(parts)}"
        return f"{base}/{external_path.lstrip('/')}"

    @staticmethod
    def url_path_location(external_path: str | None) -> str | None:
        """Read a location only from Workday's explicit ``/job/<location>/`` path."""

        if not external_path:
            return None
        parts = [unquote(part).strip() for part in str(external_path).split("/") if part.strip()]
        if len(parts) < 3 or parts[0].casefold() != "job":
            return None
        candidate = parts[1]
        if candidate.casefold() in {"login", "userhome", "jobs"}:
            return None
        return candidate.replace("-", " ")

    @staticmethod
    def raw_job(job: dict[str, Any], api_url: str, source_url: str) -> RawJob:
        external_path = job.get("externalPath") or job.get("url")
        external_id = job.get("jobPostingId") or job.get("id") or external_path
        # Workday's bulletFields are requisition labels (often just the ID),
        # not the job description. Details are fetched from the public posting
        # endpoint by the repair task when the listing payload has no body.
        description = job.get("jobDescription") or job.get("description")
        location = job.get("locationsText") or job.get("location")
        payload = dict(job)
        if not location:
            path_location = WorkdayConnector.url_path_location(external_path)
            if path_location:
                location = path_location
                payload["location_source"] = "official_url_path"
        department = WorkdayConnector.extract_department(job, location=location)
        return RawJob(str(external_id) if external_id else None, job.get("title", "Untitled"),
                      WorkdayConnector.public_job_url(source_url, external_path),
                      location, department,
                      description, payload)

    @classmethod
    async def fetch_detail(cls, client: httpx.AsyncClient, raw: RawJob, config: dict[str, Any]) -> RawJob:
        detail_url = cls.detail_api_url(str(config.get("api_url") or ""), raw.payload.get("externalPath"))
        if not detail_url:
            raise ValueError("Workday listing has no externalPath for detail fetch")
        response = None
        attempts = max(1, min(int(config.get("detail_retry_attempts", 3)), 5))
        for attempt in range(attempts):
            response = await client.get(detail_url)
            # Workday frequently answers bursts with 429. Treat that as a
            # transient detail failure by default; callers may explicitly
            # disable client-error retries for a tenant that requires it.
            retryable_client_error = config.get("detail_retry_client_errors", True) and response.status_code in {400, 429}
            if (response.status_code < 500 and not retryable_client_error) or attempt == attempts - 1:
                break
                await asyncio.sleep(min(6.0, 1.0 * (2 ** attempt)))
        response.raise_for_status()
        payload = response.json()
        info = payload.get("jobPostingInfo") if isinstance(payload, dict) else None
        if not isinstance(info, dict):
            raise ValueError("Workday detail response did not contain jobPostingInfo")
        detail_payload = dict(raw.payload)
        detail_payload["detail_status"] = "fetched"
        detail_payload["detail_url"] = detail_url
        detail_payload["detail_payload"] = info
        description = info.get("jobDescription") or info.get("description")
        location = raw.location or info.get("primaryLocation") or info.get("location")
        department = raw.department or cls.extract_department({**raw.payload, **info}, location=location)
        return RawJob(raw.external_job_id, str(info.get("title") or raw.title), raw.url,
                      location, department, str(description) if description else None, detail_payload)

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        api_url = config.get("api_url")
        if not api_url:
            raise ValueError("Workday requires connector_config.api_url for the tenant's public CXS endpoint")
        # Workday tenants commonly reject limits above 20 with HTTP 400.
        page_size = max(1, min(int(config.get("page_size", config.get("limit", 20))), 20))
        request_retries = max(1, min(int(config.get("listing_retry_attempts", 4)), 6))
        pagination_retries = max(0, min(int(config.get("pagination_retry_attempts", 3)), 6))
        concurrency = max(1, min(int(config.get("listing_concurrency", 4)), 8))
        body = {**config.get("request_body", {}), "limit": page_size, "offset": 0, "searchText": ""}
        source = urlparse(source_url)
        origin = f"{source.scheme}://{source.netloc}" if source.netloc else None
        headers = {
            "User-Agent": get_settings().crawler_user_agent,
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
        }
        if origin:
            headers.update({"Origin": origin, "Referer": source_url})

        async with httpx.AsyncClient(headers=headers, timeout=30, follow_redirects=True) as client:
            async def fetch_page(offset: int, expected_total: int | None = None,
                                 request_body: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
                empty_attempts = 0
                for attempt in range(request_retries):
                    response: httpx.Response | None = None
                    try:
                        response = await client.post(
                            api_url,
                            json={**(request_body or body), "offset": offset},
                        )
                        retryable_status = response.status_code >= 500 or response.status_code in {400, 408, 425, 429}
                        if retryable_status:
                            raise httpx.HTTPStatusError(
                                f"Workday listing returned {response.status_code}",
                                request=response.request,
                                response=response,
                            )
                        response.raise_for_status()
                        data = response.json()
                        if not isinstance(data, dict):
                            raise ValueError("Workday listing response was not an object")
                        page = data.get("jobPostings", data.get("jobs", []))
                        if not isinstance(page, list):
                            raise ValueError("Workday listing response did not contain a job list")
                        if not page and expected_total is not None and offset < expected_total and empty_attempts < pagination_retries:
                            empty_attempts += 1
                            await asyncio.sleep(min(6.0, 0.75 * (2 ** (empty_attempts - 1))))
                            continue
                        return offset, data
                    except (httpx.HTTPError, ValueError):
                        if attempt >= request_retries - 1:
                            if response is not None:
                                response.raise_for_status()
                            raise
                        await asyncio.sleep(min(6.0, 0.75 * (attempt + 1)))
                raise RuntimeError("Workday listing page did not return")

            async def collect_query(request_body: dict[str, Any],
                                    first_data: dict[str, Any] | None = None) -> tuple[list[dict[str, Any]], int | None, bool, int]:
                """Collect one Workday query, returning rows, total, completeness and invalid rows."""
                first_offset, initial = (0, first_data) if first_data is not None else await fetch_page(0, request_body=request_body)
                reported = int(initial.get("total") or 0)
                query_total: int | None = reported if reported > 0 else None
                pages: dict[int, list[Any]] = {
                    first_offset: initial.get("jobPostings", initial.get("jobs", [])) or []
                }
                query_complete = bool(pages[0]) or query_total == 0
                if query_total is not None:
                    offsets = list(range(page_size, query_total, page_size))
                    for index in range(0, len(offsets), concurrency):
                        batch = offsets[index:index + concurrency]
                        results = await asyncio.gather(*(
                            fetch_page(offset, query_total, request_body) for offset in batch
                        ))
                        for offset, data in results:
                            page = data.get("jobPostings", data.get("jobs", [])) or []
                            pages[offset] = page
                            page_total = int(data.get("total") or 0)
                            if page_total > 0 and page_total != query_total:
                                query_total = max(query_total, page_total)
                        if index // concurrency > 1250:
                            query_complete = False
                            break
                    expected_lengths = {
                        offset: min(page_size, max(query_total - offset, 0))
                        for offset in offsets
                    }
                    query_complete = query_complete and all(
                        len(pages.get(offset, [])) == expected_length
                        for offset, expected_length in expected_lengths.items()
                    )
                else:
                    offset = len(pages[0])
                    page_count = 1
                    seen_page_keys: set[tuple[str, ...]] = set()
                    while pages[offset - len(pages.get(offset, []))] and page_count < 5000:
                        _, data = await fetch_page(offset, request_body=request_body)
                        page = data.get("jobPostings", data.get("jobs", [])) or []
                        if not page:
                            query_complete = True
                            break
                        keys = tuple(str(item.get("jobPostingId") or item.get("externalPath") or item.get("id") or "") for item in page if isinstance(item, dict))
                        if keys in seen_page_keys:
                            query_complete = False
                            break
                        seen_page_keys.add(keys)
                        pages[offset] = page
                        offset += len(page)
                        page_count += 1
                        if len(page) < page_size:
                            query_complete = True
                            break

                rows: list[dict[str, Any]] = []
                invalid_count = 0
                for page in pages.values():
                    for item in page:
                        if isinstance(item, dict) and any(item.get(key) not in (None, "", []) for key in ("externalPath", "url", "jobPostingId", "id")):
                            rows.append(item)
                        else:
                            invalid_count += 1
                return rows, query_total, query_complete, invalid_count

            def find_facet(values: Any, parameter: str) -> dict[str, Any] | None:
                if isinstance(values, dict):
                    if values.get("facetParameter") == parameter and isinstance(values.get("values"), list):
                        return values
                    for child in values.values():
                        found = find_facet(child, parameter)
                        if found:
                            return found
                elif isinstance(values, list):
                    for child in values:
                        found = find_facet(child, parameter)
                        if found:
                            return found
                return None

            first_offset, first_data = await fetch_page(0)
            reported_total = int(first_data.get("total") or 0)
            partition_facets = config.get("partition_facets") or []
            if isinstance(partition_facets, str):
                partition_facets = [partition_facets]
            partition_facets = list(dict.fromkeys(
                str(parameter).strip() for parameter in partition_facets if str(parameter).strip()
            ))
            # A Workday tenant normally reports its result cap as its total.
            # Treat a result at that boundary as ambiguous until it has been
            # split into smaller queries. This is deliberately conservative:
            # an ambiguous branch may add or update rows, but can never close
            # a role that was absent from that branch.
            partition_cap = max(page_size, int(config.get("partition_cap", 2000)))

            if not partition_facets and reported_total >= partition_cap:
                # Preserve the existing best-effort behavior for tenants that
                # have not been configured yet. Large tenants should provide an
                # ordered list so they can be split recursively.
                for facet in first_data.get("facets", []) if isinstance(first_data.get("facets"), list) else []:
                    if not isinstance(facet, dict) or not facet.get("facetParameter"):
                        continue
                    values = [item for item in facet.get("values", [])
                              if isinstance(item, dict) and item.get("id") and int(item.get("count") or 0) > 0]
                    if sum(int(item.get("count") or 0) for item in values) > reported_total:
                        partition_facets = [str(facet["facetParameter"])]
                        break

            def facet_values(data: dict[str, Any], parameter: str) -> list[dict[str, Any]]:
                facet = find_facet(data.get("facets"), parameter)
                return [
                    item for item in (facet or {}).get("values", [])
                    if isinstance(item, dict) and item.get("id") and int(item.get("count") or 0) > 0
                ]

            def with_facet(request_body: dict[str, Any], parameter: str, value_id: Any) -> dict[str, Any]:
                applied = {
                    str(key): list(value) if isinstance(value, (list, tuple, set)) else [value]
                    for key, value in (request_body.get("appliedFacets") or {}).items()
                }
                applied[parameter] = [str(value_id)]
                return {**request_body, "appliedFacets": applied}

            async def collect_partitioned(
                request_body: dict[str, Any],
                first: dict[str, Any] | None = None,
                facet_index: int = 0,
            ) -> tuple[list[dict[str, Any]], int | None, bool, int, set[str]]:
                """Collect a query, recursively splitting every capped branch."""
                initial = first if first is not None else (await fetch_page(0, request_body=request_body))[1]
                query_total = int(initial.get("total") or 0)
                is_capped = query_total >= partition_cap

                if is_capped:
                    for index in range(facet_index, len(partition_facets)):
                        parameter = partition_facets[index]
                        values = facet_values(initial, parameter)
                        if not values:
                            continue
                        rows: list[dict[str, Any]] = []
                        totals: list[int] = []
                        complete = True
                        invalid_count = 0
                        used_facets: set[str] = {parameter}
                        for value in values:
                            child_rows, child_total, child_complete, child_invalid, child_facets = await collect_partitioned(
                                with_facet(request_body, parameter, value["id"]),
                                facet_index=index + 1,
                            )
                            rows.extend(child_rows)
                            if child_total is not None:
                                totals.append(child_total)
                            complete = complete and child_complete
                            invalid_count += child_invalid
                            used_facets.update(child_facets)
                        return rows, (sum(totals) if totals else None), complete, invalid_count, used_facets

                    # The visible pages are still useful for additions and
                    # updates, but a capped leaf cannot prove that omitted
                    # existing roles are closed.
                    rows, total, _complete, invalid_count = await collect_query(request_body, initial)
                    return rows, total, False, invalid_count, set()

                rows, total, complete, invalid_count = await collect_query(request_body, initial)
                return rows, total, complete, invalid_count, set()

            raw_jobs, total, source_complete, invalid_count, used_partition_facets = await collect_partitioned(
                body, first_data
            )
            partition_name = ">".join(
                parameter for parameter in partition_facets if parameter in used_partition_facets
            ) or None

        jobs = [self.raw_job(job, api_url, source_url) for job in raw_jobs]
        if total is not None:
            unique_keys = {
                job.external_job_id or job.url
                for job in jobs
                if job.external_job_id or job.url != source_url
            }
            canonical_count = len(unique_keys)
            duplicate_count = max(len(jobs) - canonical_count, 0)
            # Partitioned Workday queries can legitimately overlap a handful
            # of rows at facet boundaries. The authoritative completeness
            # signal is that every partition paged successfully; requiring
            # the de-duplicated count to equal the sum of facet totals would
            # incorrectly block safe closure of truly missing jobs.
            coverage_complete = bool(source_complete) if partition_name else bool(source_complete and canonical_count >= total)
            for job in jobs:
                job.payload.setdefault("source_reported_count", total)
                job.payload.setdefault("source_expected_count", canonical_count)
                job.payload.setdefault("source_complete", coverage_complete)
                job.payload.setdefault("source_invalid_count", invalid_count)
                job.payload.setdefault("source_duplicate_count", duplicate_count)
                job.payload.setdefault("source_missing_count", 0 if partition_name else max(total - canonical_count, 0))
                if partition_name:
                    job.payload.setdefault("source_partition_facet", partition_name)
        return jobs


class ICIMSConnector(Connector):
    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        api_url = config.get("api_url")
        if not api_url:
            raise ValueError("iCIMS requires connector_config.api_url for the tenant's public API")
        data = await self.get_json(api_url)
        jobs = data.get("jobs", data.get("results", data if isinstance(data, list) else []))
        return [RawJob(str(j.get("id") or j.get("jobId")), j.get("title", "Untitled"), j.get("url") or source_url,
                       j.get("location"), j.get("department"), j.get("description"), j) for j in jobs]


class AmazonJobsConnector(Connector):
    """Fetch Amazon's public ``amazon.jobs`` JSON search feed.

    The endpoint is offset based and reports a capped ``hits`` value.  The
    cap is retained as explicit source metadata so a capped result cannot
    close roles from an earlier complete crawl.
    """

    default_page_size = 100
    default_max_results = 10_000

    @staticmethod
    def _facet_total(facets: Any, key: str) -> int | None:
        """Sum one official facet dimension when the API exposes buckets."""
        if not isinstance(facets, dict):
            return None
        buckets = facets.get(key)
        if not isinstance(buckets, list):
            return None
        total = 0
        found = False
        for bucket in buckets:
            if not isinstance(bucket, dict):
                continue
            for value in bucket.values():
                try:
                    parsed = int(value)
                except (TypeError, ValueError):
                    continue
                if parsed >= 0:
                    total += parsed
                    found = True
        return total if found else None

    @staticmethod
    def _location(job: dict[str, Any]) -> str | None:
        value = job.get("location") or job.get("normalized_location")
        if isinstance(value, str) and value.strip():
            return value.strip()
        locations = job.get("locations")
        if not isinstance(locations, list):
            return None
        values: list[str] = []
        for item in locations:
            if isinstance(item, dict):
                item_value = item.get("normalizedLocation") or item.get("location")
                if item_value:
                    values.append(str(item_value))
                continue
            if not isinstance(item, str):
                continue
            try:
                decoded = json.loads(item)
            except json.JSONDecodeError:
                decoded = None
            if isinstance(decoded, dict):
                item_value = decoded.get("normalizedLocation") or decoded.get("location")
                if item_value:
                    values.append(str(item_value))
            elif item.strip():
                values.append(item.strip())
        return "; ".join(dict.fromkeys(values)) or None

    @staticmethod
    def _url(source_url: str, job: dict[str, Any], external_id: str | None) -> str:
        path = job.get("job_path") or job.get("jobPath") or job.get("url")
        if path:
            return urljoin(source_url, str(path))
        if external_id:
            return urljoin(source_url, f"/en/jobs/{external_id}")
        return source_url

    @classmethod
    def raw_job(cls, source_url: str, job: dict[str, Any]) -> RawJob:
        external_id = job.get("id_icims") or job.get("id") or job.get("job_path")
        external_id = str(external_id) if external_id is not None else None
        description = job.get("description") or job.get("description_short")
        payload = _official_listing_payload(job, description)
        # Normalize fields used by the AI feature store while retaining the
        # original Amazon payload for provenance and future extraction.
        for target, key in (
            ("date_posted", "posted_date"),
            ("employment_type", "job_schedule_type"),
            ("qualifications", "basic_qualifications"),
            ("preferred_qualifications", "preferred_qualifications"),
        ):
            if payload.get(target) in (None, "", []) and payload.get(key) not in (None, "", []):
                payload[target] = payload[key]
        return RawJob(
            external_id,
            str(job.get("title") or "Untitled"),
            cls._url(source_url, job, external_id),
            cls._location(job),
            job.get("job_category") or job.get("job_family") or job.get("business_category"),
            description,
            payload,
        )

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        page_size = min(max(int(config.get("page_size", self.default_page_size)), 1), self.default_page_size)
        max_results = max(page_size, int(config.get("max_results", self.default_max_results)))
        retries = max(1, int(config.get("retry_attempts", 3)))
        timeout = float(config.get("timeout", 45))
        base_params = dict(config.get("params") or {})
        raw_jobs: list[dict[str, Any]] = []
        offset = max(0, int(config.get("offset", 0)))
        reported_total: int | None = None
        official_facet_total: int | None = None
        boundary_complete = False
        async with httpx.AsyncClient(
            headers={
                "User-Agent": str(config.get("user_agent") or get_settings().crawler_user_agent),
                "Accept": "application/json",
                "Referer": "https://www.amazon.jobs/en/",
            },
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            # The public list response caps ``hits`` at 10,000, but the same
            # official endpoint exposes complete bucket counts.  Require two
            # independent partition dimensions to agree before trusting the
            # aggregate as an exact publisher total.
            try:
                facet_params = {
                    **base_params,
                    "result_limit": 1,
                    "offset": 0,
                    "facets[]": ["normalized_country_code", "business_category"],
                }
                facet_response = await client.get(source_url, params=facet_params)
                facet_response.raise_for_status()
                facet_data = facet_response.json()
                if isinstance(facet_data, dict):
                    facet_totals = [
                        self._facet_total(facet_data.get("facets"), key)
                        for key in ("normalized_country_code_facet", "business_category_facet")
                    ]
                    valid_totals = [value for value in facet_totals if value is not None and value > 0]
                    if len(valid_totals) == 2 and len(set(valid_totals)) == 1:
                        official_facet_total = valid_totals[0]
            except (httpx.HTTPError, ValueError, TypeError):
                # A facet outage must not make an otherwise valid list crawl
                # fail. The run will remain explicitly capped/unavailable.
                official_facet_total = None
            while len(raw_jobs) < max_results:
                params = {**base_params, "result_limit": page_size, "offset": offset}
                response = None
                for attempt in range(retries):
                    try:
                        response = await client.get(source_url, params=params)
                        response.raise_for_status()
                        data = response.json()
                        break
                    except (httpx.HTTPError, ValueError):
                        if attempt == retries - 1:
                            raise
                        await asyncio.sleep(0.5 * (attempt + 1))
                if not isinstance(data, dict):
                    raise ValueError("Amazon jobs response must be a JSON object")
                page = data.get("jobs")
                if reported_total is None:
                    value = data.get("hits")
                    try:
                        reported_total = int(value) if value is not None else None
                    except (TypeError, ValueError):
                        reported_total = None
                if page is None:
                    raise ValueError("Amazon jobs response did not contain a jobs list")
                if not isinstance(page, list):
                    raise ValueError("Amazon jobs response jobs field was not a list")
                if not page:
                    boundary_complete = reported_total in (None, offset)
                    break
                raw_jobs.extend(item for item in page if isinstance(item, dict))
                offset += len(page)
                if reported_total is not None and offset >= reported_total:
                    boundary_complete = True
                    break
                if len(page) < page_size:
                    boundary_complete = reported_total is None or offset >= reported_total
                    break

        jobs_by_key: dict[str, RawJob] = {}
        invalid_count = 0
        for item in raw_jobs:
            job = self.raw_job(source_url, item)
            if not job.external_job_id and job.url == source_url:
                invalid_count += 1
                continue
            jobs_by_key.setdefault(job.external_job_id or job.url, job)
        jobs = list(jobs_by_key.values())
        canonical_count = len(jobs)
        duplicate_count = max(len(raw_jobs) - canonical_count - invalid_count, 0)
        provider_cap = bool(reported_total is not None and reported_total >= max_results and len(raw_jobs) >= max_results)
        coverage_complete = bool(
            reported_total is not None
            and boundary_complete
            and not provider_cap
            and canonical_count >= reported_total
        )
        for job in jobs:
            if official_facet_total is not None:
                job.payload.setdefault("source_reported_count", official_facet_total)
                job.payload.setdefault("source_expected_count", official_facet_total)
                job.payload.setdefault("source_count_basis", "publisher_facet")
                job.payload.setdefault("source_count_source", "amazon:country+business_category")
                job.payload.setdefault("source_complete", canonical_count >= official_facet_total)
            else:
                job.payload.setdefault("source_reported_count", reported_total)
                job.payload.setdefault("source_expected_count", canonical_count)
                job.payload.setdefault("source_complete", coverage_complete)
            job.payload.setdefault("source_invalid_count", invalid_count)
            job.payload.setdefault("source_duplicate_count", duplicate_count)
            job.payload.setdefault("source_missing_count", max((official_facet_total or reported_total or canonical_count) - canonical_count, 0))
            if provider_cap and official_facet_total is None:
                job.payload.setdefault(
                    "source_coverage_note",
                    "Amazon public search reports a 10,000-result ceiling; additional roles require partitioned queries.",
                )
            elif provider_cap and official_facet_total is not None:
                job.payload.setdefault(
                    "source_coverage_note",
                    "Amazon list pagination is capped at 10,000; official total comes from agreeing country and business-category facets.",
                )
        return jobs


class GoogleCareersConnector(Connector):
    """Read Google Careers' public server data service job result pages."""

    _DATA_RE = re.compile(
        r"AF_initDataCallback\(\{key:\s*['\"]ds:1['\"].*?data:(.*?),\s*sideChannel:",
        re.IGNORECASE | re.DOTALL,
    )
    default_page_size = 20
    default_max_pages = 500

    @classmethod
    def _page_data(cls, body: str) -> tuple[list[list[Any]], int | None, int]:
        match = cls._DATA_RE.search(body)
        if not match:
            raise ValueError("Google Careers response did not contain ds:1 job data")
        try:
            data = json.loads(match.group(1).strip())
        except json.JSONDecodeError as exc:
            raise ValueError("Google Careers ds:1 job data was not valid JSON") from exc
        if not isinstance(data, list) or not data or not isinstance(data[0], list):
            raise ValueError("Google Careers ds:1 job data had an unexpected shape")
        total: int | None = None
        if len(data) > 2 and data[2] is not None:
            try:
                total = int(data[2])
            except (TypeError, ValueError):
                total = None
        page_size = self_size = cls.default_page_size
        if len(data) > 3 and data[3] is not None:
            try:
                page_size = max(1, int(data[3]))
            except (TypeError, ValueError):
                page_size = self_size
        return [row for row in data[0] if isinstance(row, list)], total, page_size

    @staticmethod
    def _location(row: list[Any]) -> str | None:
        locations = row[9] if len(row) > 9 else None
        values: list[str] = []
        if isinstance(locations, list):
            for item in locations:
                if isinstance(item, list) and item and item[0]:
                    values.append(str(item[0]))
                elif isinstance(item, str) and item.strip():
                    values.append(item.strip())
        return "; ".join(dict.fromkeys(values)) or None

    @staticmethod
    def _body_value(value: Any) -> str | None:
        if isinstance(value, list):
            for item in reversed(value):
                if isinstance(item, str) and item.strip():
                    return item
        return value if isinstance(value, str) and value.strip() else None

    @classmethod
    def raw_job(cls, source_url: str, row: list[Any]) -> RawJob:
        external_id = str(row[0]) if row and row[0] not in (None, "") else None
        title = str(row[1] or "Untitled") if len(row) > 1 else "Untitled"
        responsibilities = cls._body_value(row[3]) if len(row) > 3 else None
        qualifications = cls._body_value(row[4]) if len(row) > 4 else None
        description = cls._body_value(row[10]) if len(row) > 10 else None
        if not description:
            description = "\n".join(value for value in (responsibilities, qualifications) if value) or None
        payload: dict[str, Any] = {
            "google_job_id": external_id,
            "google_company_path": row[5] if len(row) > 5 else None,
            "google_company": row[7] if len(row) > 7 else None,
            "google_language": row[8] if len(row) > 8 else None,
            "google_locations": row[9] if len(row) > 9 else None,
            "responsibilities": responsibilities,
            "qualifications": qualifications,
        }
        payload = {key: value for key, value in payload.items() if value not in (None, "", [])}
        if qualifications:
            payload["qualification"] = qualifications
        payload = {**(row[20] if len(row) > 20 and isinstance(row[20], dict) else {}), **payload}
        payload = _official_listing_payload(payload, description)
        url = urljoin(source_url, f"/about/careers/applications/jobs/results/{external_id}") if external_id else source_url
        return RawJob(external_id, title, url, cls._location(row), row[7] if len(row) > 7 else None, description, payload)

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        start_page = max(1, int(config.get("start_page", 1)))
        max_pages = max(1, int(config.get("max_pages", self.default_max_pages)))
        retries = max(1, int(config.get("retry_attempts", 3)))
        timeout = float(config.get("timeout", 45))
        base_params = dict(config.get("params") or {})
        raw_jobs: list[RawJob] = []
        reported_total: int | None = None
        page_size = self.default_page_size
        boundary_complete = False
        async with httpx.AsyncClient(
            headers={
                "User-Agent": str(config.get("user_agent") or get_settings().crawler_user_agent),
                "Accept": "text/html,application/xhtml+xml",
                "Referer": "https://www.google.com/about/careers/applications/jobs/results/",
            },
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            for page_number in range(start_page, start_page + max_pages):
                response = None
                for attempt in range(retries):
                    try:
                        response = await client.get(source_url, params={**base_params, "page": page_number})
                        response.raise_for_status()
                        rows, total, page_size = self._page_data(response.text)
                        break
                    except (httpx.HTTPError, ValueError):
                        if attempt == retries - 1:
                            raise
                        await asyncio.sleep(0.5 * (attempt + 1))
                if reported_total is None:
                    reported_total = total
                if not rows:
                    boundary_complete = reported_total in (None, len(raw_jobs))
                    break
                raw_jobs.extend(self.raw_job(source_url, row) for row in rows if row)
                if reported_total is not None and len(raw_jobs) >= reported_total:
                    boundary_complete = True
                    break
                if len(rows) < page_size:
                    boundary_complete = reported_total is None or len(raw_jobs) >= reported_total
                    break

        jobs_by_key: dict[str, RawJob] = {}
        invalid_count = 0
        for job in raw_jobs:
            if not job.external_job_id or job.url == source_url:
                invalid_count += 1
                continue
            jobs_by_key.setdefault(job.external_job_id, job)
        jobs = list(jobs_by_key.values())
        canonical_count = len(jobs)
        duplicate_count = max(len(raw_jobs) - canonical_count - invalid_count, 0)
        provider_cap = bool(reported_total is not None and len(raw_jobs) < reported_total and len(jobs) >= max_pages * page_size)
        coverage_complete = bool(
            reported_total is not None
            and boundary_complete
            and not provider_cap
            and canonical_count >= reported_total
        )
        for job in jobs:
            job.payload.setdefault("source_reported_count", reported_total)
            job.payload.setdefault("source_expected_count", canonical_count)
            job.payload.setdefault("source_complete", coverage_complete)
            job.payload.setdefault("source_invalid_count", invalid_count)
            job.payload.setdefault("source_duplicate_count", duplicate_count)
            job.payload.setdefault("source_missing_count", max((reported_total or canonical_count) - canonical_count, 0))
            if provider_cap:
                job.payload.setdefault("source_coverage_note", "Google Careers pagination reached connector max_pages before the reported total.")
        return jobs


class MicrosoftCareersConnector(Connector):
    """Fetch Microsoft's official public PCS/Eightfold search API."""

    default_page_size = 10
    default_max_results = 5_000
    search_endpoint = "https://apply.careers.microsoft.com/api/pcsx/search"
    detail_endpoint = "https://apply.careers.microsoft.com/api/pcsx/position_details"

    @staticmethod
    def _location(position: dict[str, Any]) -> str | None:
        values = position.get("locations") or position.get("standardizedLocations") or []
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list):
            return None
        return "; ".join(dict.fromkeys(str(value).strip() for value in values if str(value).strip())) or None

    @classmethod
    def raw_job(cls, source_url: str, position: dict[str, Any], domain: str) -> RawJob:
        external_id = position.get("id") or position.get("atsJobId") or position.get("displayJobId")
        external_id = str(external_id) if external_id is not None else None
        path = position.get("positionUrl") or (f"/careers/job/{external_id}" if external_id else None)
        url = urljoin("https://apply.careers.microsoft.com", str(path)) if path else source_url
        payload = dict(position)
        payload["microsoft_position_id"] = external_id
        payload["microsoft_domain"] = domain
        return RawJob(
            external_id,
            str(position.get("name") or "Untitled"),
            url,
            cls._location(position),
            position.get("department"),
            None,
            payload,
        )

    @classmethod
    async def fetch_detail(cls, client: httpx.AsyncClient, raw: RawJob, config: dict[str, Any]) -> RawJob:
        position_id = raw.payload.get("microsoft_position_id") or raw.external_job_id
        if not position_id:
            raise ValueError("Microsoft listing has no position ID for detail fetch")
        domain = str(config.get("domain") or "microsoft.com")
        endpoint = str(config.get("detail_api_url") or cls.detail_endpoint)
        response = await client.get(endpoint, params={"position_id": position_id, "domain": domain, "hl": str(config.get("language") or "en")})
        response.raise_for_status()
        body = response.json()
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, dict):
            raise ValueError("Microsoft detail response did not contain a position")
        description = data.get("jobDescription") or data.get("description")
        if not description:
            raise ValueError("Microsoft detail response did not contain a job description")
        payload = _official_listing_payload(data, description)
        payload["microsoft_position_id"] = str(position_id)
        payload["microsoft_domain"] = domain
        return RawJob(
            raw.external_job_id,
            str(data.get("name") or raw.title),
            raw.url,
            cls._location(data) or raw.location,
            data.get("department") or raw.department,
            description,
            payload,
        )

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        api_url = str(config.get("api_url") or self.search_endpoint)
        domain = str(config.get("domain") or "microsoft.com")
        page_size = max(1, int(config.get("page_size", self.default_page_size)))
        max_results = max(page_size, int(config.get("max_results", self.default_max_results)))
        retries = max(1, int(config.get("retry_attempts", 3)))
        timeout = float(config.get("timeout", 45))
        offset = max(0, int(config.get("offset", 0)))
        query = str(config.get("query") or "")
        location = str(config.get("location") or "")
        filters = config.get("filters") or {}
        raw_positions: list[dict[str, Any]] = []
        reported_total: int | None = None
        boundary_complete = False
        async with httpx.AsyncClient(
            headers={
                "User-Agent": str(config.get("user_agent") or get_settings().crawler_user_agent),
                "Accept": "application/json",
                "Referer": "https://apply.careers.microsoft.com/careers",
            },
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            while len(raw_positions) < max_results:
                params: dict[str, Any] = {"domain": domain, "query": query, "location": location, "start": offset}
                if config.get("sort_by"):
                    params["sort_by"] = config["sort_by"]
                for key, values in filters.items():
                    for value in values if isinstance(values, list) else [values]:
                        filter_name = re.sub(r"[^a-z0-9]+", "_", str(key).lower()).strip("_")
                        params[f"filter_{filter_name}"] = value
                response = None
                for attempt in range(retries):
                    try:
                        response = await client.get(api_url, params=params)
                        response.raise_for_status()
                        body = response.json()
                        break
                    except (httpx.HTTPError, ValueError):
                        if attempt == retries - 1:
                            raise
                        await asyncio.sleep(0.5 * (attempt + 1))
                data = body.get("data") if isinstance(body, dict) else None
                if not isinstance(data, dict):
                    raise ValueError("Microsoft search response did not contain data")
                page = data.get("positions")
                if reported_total is None:
                    try:
                        reported_total = int(data.get("count")) if data.get("count") is not None else None
                    except (TypeError, ValueError):
                        reported_total = None
                if page is None:
                    raise ValueError("Microsoft search response did not contain positions")
                if not isinstance(page, list):
                    raise ValueError("Microsoft search positions field was not a list")
                if not page:
                    boundary_complete = reported_total in (None, offset)
                    break
                raw_positions.extend(position for position in page if isinstance(position, dict))
                offset += len(page)
                if reported_total is not None and offset >= reported_total:
                    boundary_complete = True
                    break
                if len(page) < page_size:
                    boundary_complete = reported_total is None or offset >= reported_total
                    break

        jobs_by_key: dict[str, RawJob] = {}
        invalid_count = 0
        for position in raw_positions:
            job = self.raw_job(source_url, position, domain)
            if not job.external_job_id or job.url == source_url:
                invalid_count += 1
                continue
            jobs_by_key.setdefault(job.external_job_id, job)
        jobs = list(jobs_by_key.values())
        canonical_count = len(jobs)
        duplicate_count = max(len(raw_positions) - canonical_count - invalid_count, 0)
        provider_cap = bool(reported_total is not None and reported_total > max_results and len(raw_positions) >= max_results)
        coverage_complete = bool(
            reported_total is not None
            and boundary_complete
            and not provider_cap
            and canonical_count >= reported_total
        )
        for job in jobs:
            job.payload.setdefault("source_reported_count", reported_total)
            job.payload.setdefault("source_expected_count", canonical_count)
            job.payload.setdefault("source_complete", coverage_complete)
            job.payload.setdefault("source_invalid_count", invalid_count)
            job.payload.setdefault("source_duplicate_count", duplicate_count)
            job.payload.setdefault("source_missing_count", max((reported_total or canonical_count) - canonical_count, 0))
            if provider_cap:
                job.payload.setdefault("source_coverage_note", "Microsoft public search was limited by connector max_results before the reported total.")
        return jobs



class AppleCareersConnector(Connector):
    """Fetch Apple's public Jobs API for North American locations.

    Apple exposes a public, offset-free page API. The endpoint accepts a
    location code in ``filters.locations`` and reports the total for that
    location. We crawl the US and Canada scopes separately, then de-duplicate
    multi-location roles by Apple's stable position ID.
    """

    search_endpoint = "https://jobs.apple.com/api/v1/search"
    default_locations = ("postLocation-USA", "postLocation-CANC")
    default_page_size = 20
    default_max_pages = 500

    @staticmethod
    def _location(job: dict[str, Any]) -> str | None:
        values: list[str] = []
        locations = job.get("locations")
        if isinstance(locations, list):
            for item in locations:
                if not isinstance(item, dict):
                    continue
                name = item.get("name") or item.get("city")
                region = item.get("stateProvince") or item.get("region")
                country = item.get("countryName")
                value = ", ".join(str(part).strip() for part in (name, region, country) if str(part or "").strip())
                if value:
                    values.append(value)
        return "; ".join(dict.fromkeys(values)) or None

    @staticmethod
    def _team(job: dict[str, Any]) -> str | None:
        team = job.get("team")
        if isinstance(team, dict):
            return str(team.get("teamName") or team.get("teamCode") or "").strip() or None
        return None

    @classmethod
    def raw_job(cls, source_url: str, job: dict[str, Any], locale: str) -> RawJob:
        external_id = job.get("positionId") or job.get("id") or job.get("jobPositionId")
        external_id = str(external_id) if external_id not in (None, "") else None
        slug = str(job.get("transformedPostingTitle") or "job").strip("/")
        url = f"https://jobs.apple.com/{locale}/details/{external_id}/{slug}" if external_id else source_url
        summary = job.get("jobSummary")
        payload = _official_listing_payload(job, summary)
        payload.update({
            "apple_job_id": external_id,
            "apple_job_type": job.get("type"),
            "apple_req_id": job.get("reqId"),
            "apple_team": job.get("team"),
            "apple_posting_date": job.get("postingDate"),
            "apple_post_date_gmt": job.get("postDateInGMT"),
            "apple_country_ids": [
                item.get("countryID")
                for item in (job.get("locations") or [])
                if isinstance(item, dict) and item.get("countryID")
            ],
        })
        return RawJob(
            external_id,
            str(job.get("postingTitle") or "Untitled"),
            url,
            cls._location(job),
            cls._team(job),
            str(summary) if summary not in (None, "") else None,
            payload,
        )

    @classmethod
    async def fetch_detail(cls, client: httpx.AsyncClient, raw: RawJob, config: dict[str, Any]) -> RawJob:
        """Fetch Apple's official JSON detail resource for a requisition."""
        job_id = str(raw.external_job_id or raw.payload.get('apple_job_id') or '').strip()
        if not job_id:
            raise ValueError('Apple Careers detail requires a job ID')
        template = str(config.get('detail_api_url_template') or 'https://jobs.apple.com/api/v1/jobDetails/{job_id}')
        endpoint = template.format(job_id=job_id, position_id=job_id)
        headers = {
            'User-Agent': str(config.get('user_agent') or 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'),
            'Accept': 'application/json, text/plain, */*',
            'Origin': 'https://jobs.apple.com',
            'Referer': 'https://jobs.apple.com/en-us/search',
        }
        response = await client.get(endpoint, headers=headers)
        response.raise_for_status()
        body = response.json()
        detail = body.get('res') if isinstance(body, dict) else None
        if not isinstance(detail, dict):
            raise ValueError('Apple Careers detail response did not contain res')
        def clean(value: Any) -> str:
            if isinstance(value, list):
                return '\n'.join(clean(item) for item in value if clean(item))
            return str(value or '').strip()
        sections: list[str] = []
        for label, key in (('Description', 'description'), ('Responsibilities', 'responsibilities'), ('Minimum Qualifications', 'minimumQualifications'), ('Preferred Qualifications', 'preferredQualifications')):
            value = clean(detail.get(key))
            if value and value not in sections:
                sections.append(f'{label}:\n{value}')
        description = '\n\n'.join(sections) or raw.description
        payload = dict(raw.payload or {})
        team = clean(detail.get('teamNames')) or None
        payload.update({'detail_status': 'fetched_json', 'detail_url': str(response.url), 'detail_payload': detail, 'detail_location': cls._location(detail), 'detail_department': team})
        return RawJob(raw.external_job_id, clean(detail.get('postingTitle')) or raw.title, raw.url, raw.location or cls._location(detail), raw.department or team, description, payload)

    @staticmethod
    def _payload(location: str, page: int, locale: str, sort: str) -> dict[str, Any]:
        return {
            "query": "",
            "filters": {"locations": [location]},
            "page": page,
            "locale": locale,
            "sort": sort,
            "format": {"longDate": "MMMM D, YYYY", "mediumDate": "MMM D, YYYY"},
        }

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        endpoint = str(config.get("api_url") or source_url or self.search_endpoint)
        locale = str(config.get("locale") or "en-us").lower()
        page_size = max(1, min(int(config.get("page_size", self.default_page_size)), 100))
        max_pages = max(1, min(int(config.get("max_pages", self.default_max_pages)), 1000))
        retries = max(1, min(int(config.get("retry_attempts", 3)), 5))
        timeout = float(config.get("timeout", 45))
        sort = str(config.get("sort") or "newest")
        locations = config.get("locations") or self.default_locations
        if isinstance(locations, str):
            locations = [locations]
        location_codes = [str(item).strip() for item in locations if str(item).strip()]
        if not location_codes:
            raise ValueError("Apple Careers requires at least one location code")

        raw_jobs: list[dict[str, Any]] = []
        reported_by_location: dict[str, int] = {}
        async with httpx.AsyncClient(
            headers={
                # Apple rejects generic crawler identifiers with 403; use a browser-like
                # default while keeping an explicit per-source override available.
                "User-Agent": str(config.get("user_agent") or "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"),
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://jobs.apple.com",
                "Referer": "https://jobs.apple.com/en-us/search",
            },
            timeout=timeout,
            follow_redirects=True,
        ) as client:
            for location in location_codes:
                page = 1
                location_jobs: list[dict[str, Any]] = []
                reported_total: int | None = None
                while page <= max_pages:
                    response: httpx.Response | None = None
                    body: Any = None
                    for attempt in range(retries):
                        try:
                            response = await client.post(endpoint, json=self._payload(location, page, locale, sort))
                            response.raise_for_status()
                            body = response.json()
                            break
                        except (httpx.HTTPError, ValueError):
                            if attempt == retries - 1:
                                raise
                            await asyncio.sleep(0.5 * (attempt + 1))
                    if not isinstance(body, dict):
                        raise ValueError("Apple Careers search response was not an object")
                    result = body.get("res")
                    if not isinstance(result, dict):
                        raise ValueError("Apple Careers search response did not contain res")
                    rows = result.get("searchResults")
                    if not isinstance(rows, list):
                        raise ValueError("Apple Careers search response did not contain searchResults")
                    if reported_total is None:
                        try:
                            reported_total = int(result.get("totalRecords")) if result.get("totalRecords") is not None else None
                        except (TypeError, ValueError):
                            reported_total = None
                    location_jobs.extend(row for row in rows if isinstance(row, dict))
                    if not rows:
                        if page == 1 and (reported_total or 0) > 0:
                            raise ValueError(f"Apple Careers returned an empty first page for {location}")
                        break
                    if reported_total is not None and len(location_jobs) >= reported_total:
                        break
                    if len(rows) < page_size:
                        if reported_total is None or len(location_jobs) >= reported_total:
                            break
                        raise ValueError(
                            f"Apple Careers pagination ended early for {location}: "
                            f"fetched={len(location_jobs)}, reported={reported_total}"
                        )
                    page += 1
                else:
                    raise ValueError(f"Apple Careers exceeded max_pages for {location}")
                if reported_total is None:
                    reported_total = len(location_jobs)
                if len(location_jobs) < reported_total:
                    raise ValueError(
                        f"Apple Careers did not reconcile {location}: "
                        f"fetched={len(location_jobs)}, reported={reported_total}"
                    )
                reported_by_location[location] = reported_total
                raw_jobs.extend(location_jobs)

        jobs_by_key: dict[str, RawJob] = {}
        invalid_count = 0
        for item in raw_jobs:
            job = self.raw_job(endpoint, item, locale)
            if not job.external_job_id or job.url == endpoint:
                invalid_count += 1
                continue
            jobs_by_key.setdefault(job.external_job_id, job)
        jobs = list(jobs_by_key.values())
        if not jobs:
            raise ValueError("Apple Careers returned an empty North America snapshot")
        duplicate_count = max(len(raw_jobs) - len(jobs) - invalid_count, 0)
        canonical_count = len(jobs)
        for job in jobs:
            job.payload.update({
                "source_reported_count": canonical_count,
                "source_expected_count": canonical_count,
                "source_complete": True,
                "source_invalid_count": invalid_count,
                "source_duplicate_count": duplicate_count,
                "source_missing_count": 0,
                "source_provider_total": sum(reported_by_location.values()),
                "source_reported_by_location": reported_by_location,
                "source_scope": "north_america",
            })
        return jobs


class MetaCareersConnector(Connector):
    """Fetch Meta Careers' anonymous public Relay job-search snapshot.

    Meta's public job-search page exposes the same query used by its web UI.
    The query returns the complete ``all_jobs`` list in one response (there is
    no cursor or page parameter).  The short-lived LSD token is read from the
    public landing page so scheduled server crawls do not depend on a browser
    session or a stored credential.
    """

    search_endpoint = "https://www.metacareers.com/graphql"
    landing_page = "https://www.metacareers.com/jobsearch/"
    default_doc_id = "27129360303422352"
    default_operation = "CareersJobSearchResultsV2DataQuery"

    @staticmethod
    def _token(html: str) -> str:
        match = re.search(r'\"LSD\",\[\],\{\"token\":\"([^\"]+)\"', html)
        if not match:
            raise ValueError("Meta Careers landing page did not expose an LSD token")
        return match.group(1)

    @staticmethod
    def _search_input(config: dict[str, Any]) -> dict[str, Any]:
        defaults: dict[str, Any] = {
            "q": None,
            "divisions": [],
            "offices": [],
            "roles": [],
            "leadership_levels": [],
            "saved_jobs": [],
            "saved_searches": [],
            "sub_teams": [],
            "teams": [],
            "is_leadership": False,
            "is_remote_only": False,
            "sort_by_new": False,
            "results_per_page": None,
        }
        supplied = config.get("search_input")
        if isinstance(supplied, dict):
            defaults.update(supplied)
        return defaults

    @staticmethod
    def _location(job: dict[str, Any]) -> str | None:
        values = job.get("locations")
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list):
            return None
        return "; ".join(dict.fromkeys(str(value).strip() for value in values if str(value).strip())) or None

    @classmethod
    def raw_job(cls, source_url: str, job: dict[str, Any]) -> RawJob:
        external_id = job.get("id")
        external_id = str(external_id) if external_id not in (None, "") else None
        url = (
            f"https://www.metacareers.com/profile/job_details/{external_id}/"
            if external_id else source_url
        )
        payload = {
            "meta_job_id": external_id,
            "meta_teams": job.get("teams") or [],
            "meta_sub_teams": job.get("sub_teams") or [],
            "detail_source": "meta_public_job_details",
        }
        return RawJob(
            external_id,
            str(job.get("title") or "Untitled"),
            url,
            cls._location(job),
            "; ".join(str(value) for value in (job.get("teams") or []) if value) or None,
            None,
            payload,
        )

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        endpoint = str(config.get("api_url") or source_url or self.search_endpoint)
        landing_url = str(config.get("landing_url") or self.landing_page)
        doc_id = str(config.get("doc_id") or self.default_doc_id)
        operation = str(config.get("operation_name") or self.default_operation)
        timeout = float(config.get("timeout", 60))
        retries = max(1, int(config.get("retry_attempts", 3)))
        user_agent = str(config.get("user_agent") or get_settings().crawler_user_agent)
        base_headers = {
            "User-Agent": user_agent,
            "Accept": "*/*",
            "Origin": "https://www.metacareers.com",
            "Referer": landing_url,
        }
        async with httpx.AsyncClient(headers=base_headers, timeout=timeout, follow_redirects=True) as client:
            landing_response = await client.get(landing_url)
            landing_response.raise_for_status()
            lsd = self._token(landing_response.text)
            variables = {
                "search_input": self._search_input(config),
                "viewasUserID": None,
                "isLoggedIn": False,
            }
            form = {
                "av": "0",
                "__user": "0",
                "__a": "1",
                "__comet_req": "31",
                "dpr": "1",
                "lsd": lsd,
                "fb_api_caller_class": "RelayModern",
                "fb_api_req_friendly_name": operation,
                "server_timestamps": "true",
                "variables": json.dumps(variables, separators=(",", ":")),
                "doc_id": doc_id,
            }
            response = None
            for attempt in range(retries):
                try:
                    response = await client.post(
                        endpoint,
                        data=form,
                        headers={
                            "Content-Type": "application/x-www-form-urlencoded",
                            "X-FB-Friendly-Name": operation,
                            "X-FB-LSD": lsd,
                            "X-ASBD-ID": str(config.get("asbd_id") or "359341"),
                        },
                    )
                    response.raise_for_status()
                    body = response.json()
                    break
                except (httpx.HTTPError, ValueError):
                    if attempt == retries - 1:
                        raise
                    await asyncio.sleep(0.75 * (attempt + 1))
            if not isinstance(body, dict):
                raise ValueError("Meta Careers GraphQL response was not an object")
            if body.get("errors"):
                raise ValueError(f"Meta Careers GraphQL returned errors: {body['errors']}")
            data = body.get("data") or {}
            result = data.get("job_search_with_featured_jobs_v2")
            raw_jobs = result.get("all_jobs") if isinstance(result, dict) else None
            if not isinstance(raw_jobs, list):
                raise ValueError("Meta Careers response did not contain all_jobs")

        jobs_by_key: dict[str, RawJob] = {}
        invalid_count = 0
        for item in raw_jobs:
            if not isinstance(item, dict):
                invalid_count += 1
                continue
            job = self.raw_job(endpoint, item)
            if not job.external_job_id or job.url == endpoint:
                invalid_count += 1
                continue
            jobs_by_key.setdefault(job.external_job_id, job)
        jobs = list(jobs_by_key.values())
        if not jobs:
            raise ValueError("Meta Careers returned an empty all_jobs snapshot")
        duplicate_count = max(len(raw_jobs) - len(jobs) - invalid_count, 0)
        count = len(jobs)
        for job in jobs:
            job.payload.update({
                "source_reported_count": count,
                "source_expected_count": count,
                "source_complete": True,
                "source_invalid_count": invalid_count,
                "source_duplicate_count": duplicate_count,
                "source_missing_count": 0,
                "source_snapshot_mode": "unpaginated_all_jobs",
                "meta_graphql_doc_id": doc_id,
            })
        return jobs


class AccentureConnector(Connector):
    """Read the public Accenture site feed, scoped to its visible country site.

    The site's public job search is backed by a separate Elastic endpoint.
    Accenture's global Workday tenant exposes a much larger internal/global
    facet inventory, so it must not be used as the completeness boundary for
    the USA public careers site.
    """

    default_api_url = "https://www.accenture.com/api/accenture/elastic/findjobs"
    default_page_size = 100

    @staticmethod
    def _text(value: Any) -> str | None:
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list):
            items = [str(item).strip() for item in value if str(item).strip()]
            return " | ".join(items) if items else None
        return None

    @classmethod
    def raw_job(cls, item: dict[str, Any], source_url: str, country_site: str, country: str) -> RawJob:
        external_id = item.get("requisitionId") or item.get("guid")
        raw_url = str(item.get("jobDetailUrl") or "").strip()
        url = raw_url.replace("{0}", country_site) if raw_url else source_url
        location = cls._text(item.get("location")) or cls._text(item.get("feedCity"))
        # The public endpoint is scoped by ``jobCountry`` but some listings
        # omit a location (or return only an internal location code). Preserve
        # that scope so downstream region filters do not discard valid roles.
        country_label = {"US": "United States", "USA": "United States"}.get(country.strip().upper(), country.strip())
        if country_label and country_label.casefold() not in (location or "").casefold():
            location = f"{location}, {country_label}" if location else country_label
        department = (
            cls._text(item.get("areaOfInterest"))
            or cls._text(item.get("function"))
            or cls._text(item.get("jobFamilyGroup"))
        )
        description = item.get("jobDescription") or item.get("jobDescriptionClean")
        payload = _official_listing_payload(item, description)
        payload["accenture_public_country_site"] = country_site
        return RawJob(
            str(external_id) if external_id else None,
            str(item.get("title") or "Untitled"),
            url,
            location,
            department,
            str(description) if description else None,
            payload,
        )

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        api_url = str(config.get("api_url") or self.default_api_url)
        country = str(config.get("job_country") or "USA")
        country_site = str(config.get("country_site") or "us-en")
        language = str(config.get("job_language") or "en")
        page_size = max(1, min(int(config.get("page_size", self.default_page_size)), 100))
        concurrency = max(1, min(int(config.get("listing_concurrency", 4)), 8))
        retries = max(1, min(int(config.get("listing_retry_attempts", 4)), 6))
        timeout = float(config.get("timeout", 45))
        base_form = {
            "jobKeyword": "",
            "jobCountry": country,
            "jobLanguage": language,
            "countrySite": country_site,
            "sortBy": str(config.get("sort_by", 2)),
            "searchType": str(config.get("search_type") or "vectorSearch"),
            "enableQueryBoost": "true",
            "minScore": str(config.get("min_score", "0.6")),
            "getFeedbackJudgmentEnabled": "true",
            "useCleanEmbedding": "true",
            "score": "true",
            "totalHits": "true",
            "debugQuery": "false",
            "jobFilters": "[]",
            **(config.get("request_form") or {}),
        }
        headers = {
            "User-Agent": str(config.get("user_agent") or get_settings().crawler_user_agent),
            "Referer": source_url,
            "Accept": "application/json, text/plain, */*",
        }

        async with httpx.AsyncClient(headers=headers, timeout=timeout, follow_redirects=True) as client:
            async def fetch_page(offset: int) -> dict[str, Any]:
                for attempt in range(retries):
                    try:
                        response = await client.post(
                            api_url,
                            data={**base_form, "startIndex": str(offset), "maxResultSize": str(page_size)},
                        )
                        retryable = response.status_code >= 500 or response.status_code in {408, 425, 429}
                        if retryable:
                            raise httpx.HTTPStatusError(
                                f"Accenture public feed returned {response.status_code}",
                                request=response.request,
                                response=response,
                            )
                        response.raise_for_status()
                        data = response.json()
                        if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                            raise ValueError("Accenture public feed did not contain a job list")
                        return data
                    except (httpx.HTTPError, ValueError):
                        if attempt >= retries - 1:
                            raise
                        await asyncio.sleep(min(6.0, 0.75 * (attempt + 1)))
                raise RuntimeError("Accenture public feed page did not return")

            first = await fetch_page(0)
            total_hits = first.get("totalHits") if isinstance(first.get("totalHits"), dict) else {}
            total = int(total_hits.get("total") or 0)
            over_max_hits = str(total_hits.get("overMaxHits") or "").strip().casefold() == "true"
            pages: dict[int, list[Any]] = {0: first.get("data") or []}
            offsets = list(range(page_size, total, page_size))
            for index in range(0, len(offsets), concurrency):
                results = await asyncio.gather(*(fetch_page(offset) for offset in offsets[index:index + concurrency]))
                for offset, data in zip(offsets[index:index + concurrency], results):
                    pages[offset] = data.get("data") or []

        invalid_count = 0
        jobs_by_id: dict[str, RawJob] = {}
        for page in pages.values():
            for item in page:
                if not isinstance(item, dict) or not (item.get("requisitionId") or item.get("guid")):
                    invalid_count += 1
                    continue
                job = self.raw_job(item, source_url, country_site, country)
                if job.external_job_id:
                    jobs_by_id.setdefault(job.external_job_id, job)
        jobs = list(jobs_by_id.values())
        complete = not over_max_hits and len(jobs) >= total and invalid_count == 0
        duplicate_count = max(sum(len(page) for page in pages.values()) - len(jobs) - invalid_count, 0)
        for job in jobs:
            job.payload.update({
                "source_reported_count": total,
                "source_expected_count": len(jobs),
                "source_complete": complete,
                "source_invalid_count": invalid_count,
                "source_duplicate_count": duplicate_count,
                "source_missing_count": max(total - len(jobs), 0),
                "source_snapshot_mode": "accenture_public_country_feed",
            })
        if not jobs:
            raise ValueError("Accenture public feed returned zero usable jobs")
        return jobs


class PublicFeedConnector(Connector):
    """Configurable JSON feed adapter for permitted public job sources."""

    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        api_url = config.get("api_url") or source_url
        user_agent = str(config.get("user_agent") or get_settings().crawler_user_agent)
        timeout = float(config.get("timeout", 30))
        attempts = max(1, int(config.get("retry_attempts", 2)))
        async with httpx.AsyncClient(headers={"User-Agent": user_agent}, timeout=timeout, follow_redirects=True) as client:
            for attempt in range(attempts):
                try:
                    response = await client.get(api_url)
                    response.raise_for_status()
                    data = response.json()
                    break
                except httpx.HTTPError:
                    if attempt == attempts - 1:
                        raise
                    await asyncio.sleep(0.5 * (attempt + 1))
        jobs = data if isinstance(data, list) else data.get(config.get("items_key", "jobs"), data.get("results", []))
        if not isinstance(jobs, list):
            raise ValueError("Public feed must contain a list under connector_config.items_key")
        result: list[RawJob] = []
        for j in jobs:
            description = j.get(config.get("description_key", "description"))
            result.append(RawJob(
                str(j.get(config.get("id_key", "id"))) if j.get(config.get("id_key", "id")) is not None else None,
                j.get(config.get("title_key", "title"), "Untitled"),
                j.get(config.get("url_key", "url")) or source_url,
                j.get(config.get("location_key", "location")),
                j.get(config.get("department_key", "department")),
                description,
                _official_listing_payload(j, description),
            ))
        return result


class UnsupportedConnector(Connector):
    async def fetch(self, source_url: str, config: dict[str, Any]) -> list[RawJob]:
        raise NotImplementedError(
            "This ATS needs tenant-specific configuration. Add a company connector using its permitted public endpoint."
        )


CONNECTORS: dict[str, Connector] = {
    "greenhouse": GreenhouseConnector(), "lever": LeverConnector(), "ashby": AshbyConnector(), "goldman_sachs": GoldmanSachsConnector(), "talentbrew": TalentBrewConnector(),
    "workday": WorkdayConnector(), "smartrecruiters": SmartRecruitersConnector(), "symphony_talent": SymphonyTalentConnector(), "oracle_hcm": OracleHCMConnector(), "avature": AvatureConnector(), "beesite": BeesiteConnector(), "talent_gateway": TalentGatewayConnector(), "rss": RssConnector(), "eightfold": EightfoldConnector(), "icims": ICIMSConnector(),
    "public_feed": PublicFeedConnector(), "accenture": AccentureConnector(), "amazon": AmazonJobsConnector(), "google": GoogleCareersConnector(), "microsoft": MicrosoftCareersConnector(), "apple": AppleCareersConnector(), "meta": MetaCareersConnector(), "phenom": PhenomConnector(), "bain": BainConnector(), "mckinsey": McKinseyConnector(), "rothschild_web": RothschildWebConnector(), "sitemap": SitemapConnector(),
    "official": OfficialConnector(),
}


def get_connector(connector_type: str) -> Connector:
    return CONNECTORS.get(connector_type, UnsupportedConnector())
