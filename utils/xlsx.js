/**
 * Thin wrapper around exceljs for reading/writing multi-sheet workbooks
 * as plain { name, headers, rows } tables — the same shape utils/csv.js
 * hands back, so callers don't need to care whether the source was a
 * .csv or .xlsx file.
 */

const ExcelJS = require("exceljs");

/**
 * ExcelJS returns hyperlinks / rich text / formulas as objects.
 * String(cell.value) → "[object Object]" which then lands in Linkedin Contact.
 */
function cellValueToString(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return value.toISOString();

    if (typeof value === "object") {
        // Hyperlink cell: { text, hyperlink }
        if (value.hyperlink || value.text != null) {
            const link = value.hyperlink != null ? String(value.hyperlink).trim() : "";
            const text = value.text != null ? String(value.text).trim() : "";
            if (/linkedin\.com/i.test(link)) return link;
            if (/linkedin\.com/i.test(text)) return text;
            return link || text || "";
        }
        // Rich text runs
        if (Array.isArray(value.richText)) {
            return value.richText.map(t => (t && t.text) || "").join("").trim();
        }
        // Formula with cached result
        if (value.result !== undefined && value.result !== null) {
            return cellValueToString(value.result);
        }
        if (value.error) return "";
    }

    const asString = String(value).trim();
    return asString === "[object Object]" ? "" : asString;
}

// Read every sheet into { name, headers, rows: [{header: value, ...}] }.
async function readWorkbook(filePath) {

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets = [];

    workbook.eachSheet(worksheet => {

        const headerRow = worksheet.getRow(1);
        const headers = [];

        headerRow.eachCell({ includeEmpty: false }, cell => {
            headers.push(cellValueToString(cell.value));
        });

        const rows = [];

        for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
            const row = worksheet.getRow(rowNum);
            if (row.cellCount === 0) continue;

            const obj = {};
            let hasValue = false;

            headers.forEach((header, idx) => {
                const cell = row.getCell(idx + 1);
                const value = cellValueToString(cell.value);
                obj[header] = value;
                if (value !== "") hasValue = true;
            });

            if (hasValue) rows.push(obj);
        }

        sheets.push({ name: worksheet.name, headers, rows });
    });

    return sheets;
}

// Write { name, headers, rows }[] into a new workbook file.
async function writeWorkbook(filePath, sheets) {

    const workbook = new ExcelJS.Workbook();

    for (const sheet of sheets) {
        const worksheet = workbook.addWorksheet(sheet.name);

        worksheet.columns = sheet.headers.map(header => ({
            header,
            key: header,
            width: Math.max(12, Math.min(45, header.length + 4))
        }));

        worksheet.getRow(1).font = { bold: true };

        for (const row of sheet.rows) {
            // Force plain strings so Excel never stores accidental objects
            const plain = {};
            for (const header of sheet.headers) {
                plain[header] = cellValueToString(row[header]);
            }
            worksheet.addRow(plain);
        }
    }

    await workbook.xlsx.writeFile(filePath);
}

module.exports = {
    readWorkbook,
    writeWorkbook,
    cellValueToString
};
