/**
 * Minimal RFC 4180 CSV parser/writer.
 * No external dependency — the project has none beyond Playwright.
 */

// Parse CSV text into { headers, rows } where each row is
// a plain object keyed by header name.
function parseCsv(text) {

    const records = [];
    let field = "";
    let record = [];
    let inQuotes = false;

    const pushField = () => {
        record.push(field);
        field = "";
    };

    const pushRecord = () => {
        pushField();
        records.push(record);
        record = [];
    };

    // Normalise line endings, strip BOM.
    const input = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");

    for (let i = 0; i < input.length; i++) {
        const char = input[i];

        if (inQuotes) {
            if (char === '"') {
                if (input[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += char;
            }
            continue;
        }

        if (char === '"') {
            inQuotes = true;
        } else if (char === ",") {
            pushField();
        } else if (char === "\n") {
            pushRecord();
        } else {
            field += char;
        }
    }

    // Trailing field/record (file may or may not end with a newline).
    if (field.length > 0 || record.length > 0) {
        pushRecord();
    }

    const nonEmpty = records.filter(r => !(r.length === 1 && r[0] === ""));

    if (nonEmpty.length === 0) {
        return { headers: [], rows: [] };
    }

    const headers = nonEmpty[0].map(h => h.trim());

    const rows = nonEmpty.slice(1).map(cols => {
        const obj = {};
        headers.forEach((header, idx) => {
            obj[header] = cols[idx] !== undefined ? cols[idx] : "";
        });
        return obj;
    });

    return { headers, rows };
}

function escapeField(value) {
    const str = value === null || value === undefined ? "" : String(value);
    if (/[",\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// Stringify an array of plain objects into CSV text using the given
// column order.
function toCsv(columns, rows) {
    const lines = [columns.map(escapeField).join(",")];

    for (const row of rows) {
        lines.push(columns.map(col => escapeField(row[col])).join(","));
    }

    return lines.join("\n") + "\n";
}

module.exports = {
    parseCsv,
    toCsv
};
