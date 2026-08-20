"""
Shared mapping helpers: our scraper's internal JSON field names ->
the workbook's exact Apify-style column names.
"""

import re
import urllib.parse

COLUMNS = [
    "originalQuery/query",
    "firstName",
    "lastName",
    "headline",
    "currentPosition/0/position",
    "currentPosition/0/companyName",
    "currentPosition/0/duration",
    "currentPosition/0/endDate/text",
    "connectionsCount",
    "currentPosition/0/companyLinkedinUrl",
    "location/parsed/country",
    "employeeCountRange/start",
    "industries/0/name",
    "website",
    "companyType",
]


def derive_country(location):
    if not location:
        return ""
    parts = [p.strip() for p in location.split(",") if p.strip()]
    return parts[-1] if parts else ""


def derive_employee_start(employee_count):
    if not employee_count:
        return ""
    match = re.search(r"([\d,]+)", employee_count)
    if not match:
        return ""
    return int(match.group(1).replace(",", ""))


def derive_connections_count(connections):
    if not connections:
        return ""
    digits = re.sub(r"[^\d]", "", connections)
    return int(digits) if digits else connections


def normalise_url(url):
    # Decode percent-encoding and drop scheme/trailing slash so
    # "http://www.linkedin.com/in/efra%c3%adn-..." matches
    # "https://www.linkedin.com/in/efraín-.../" reliably.
    decoded = urllib.parse.unquote(url or "")
    decoded = re.sub(r"^https?://(www\.)?", "", decoded)
    return decoded.rstrip("/").lower()


def to_row(record, headers=COLUMNS):
    mapped = {
        "originalQuery/query": record.get("profileUrl", ""),
        "firstName": record.get("firstName", ""),
        "lastName": record.get("lastName", ""),
        "headline": record.get("headline", ""),
        "currentPosition/0/position": record.get("currentPosition", ""),
        "currentPosition/0/companyName": record.get("currentCompany", ""),
        "currentPosition/0/duration": record.get("duration", ""),
        "currentPosition/0/endDate/text": record.get("endDate", ""),
        "connectionsCount": derive_connections_count(record.get("connections", "")),
        "currentPosition/0/companyLinkedinUrl": record.get("companyLinkedinUrl", ""),
        "location/parsed/country": derive_country(record.get("location", "")),
        "employeeCountRange/start": derive_employee_start(record.get("employeeCount", "")),
        "industries/0/name": record.get("industry", ""),
        "website": record.get("website", ""),
        "companyType": record.get("companyType", ""),
    }
    return [mapped.get(h, "") for h in headers]
