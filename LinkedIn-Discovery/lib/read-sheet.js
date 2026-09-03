/**
 * Read CSV / XLSX / XLS sheets into { headers, rows }[] for dedupe.
 * Handles Excel hyperlink cells (common for LinkedIn URL columns).
 */

const fs = require("fs");
const path = require("path");
const { parseCsv } = require("../../utils/csv");

function cellToString(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    // ExcelJS / SheetJS hyperlink / rich text shapes
    if (typeof value === "object") {
        if (value.hyperlink) return String(value.hyperlink);
        if (value.text != null) return String(value.text);
        if (value.richText && Array.isArray(value.richText)) {
            return value.richText.map(t => t.text || "").join("");
        }
        if (value.result != null) return String(value.result);
        if (value.formula && value.result != null) return String(value.result);
    }
    return String(value);
}

async function readXlsxWithExcelJs(filePath) {
    const ExcelJS = require("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets = [];
    workbook.eachSheet(worksheet => {
        const headerRow = worksheet.getRow(1);
        const headers = [];
        headerRow.eachCell({ includeEmpty: false }, cell => {
            headers.push(cellToString(cell.value).trim());
        });

        const rows = [];
        for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
            const row = worksheet.getRow(rowNum);
            if (row.cellCount === 0) continue;
            const obj = {};
            let hasValue = false;
            headers.forEach((header, idx) => {
                const value = cellToString(row.getCell(idx + 1).value);
                obj[header] = value;
                if (value !== "") hasValue = true;
            });
            if (hasValue) rows.push(obj);
        }
        sheets.push({ name: worksheet.name, headers, rows });
    });
    return sheets;
}

/**
 * Legacy .xls (and also .xlsx) via SheetJS.
 * exceljs cannot read BIFF .xls files.
 */
function readWithSheetJs(filePath) {
    let XLSX;
    try {
        XLSX = require("xlsx");
    } catch {
        throw new Error(
            `Cannot read "${path.extname(filePath)}" — install SheetJS in the parent project:\n` +
            `  cd .. && npm install xlsx`
        );
    }

    const workbook = XLSX.readFile(filePath, { cellDates: true });
    const sheets = [];

    for (const name of workbook.SheetNames) {
        const sheet = workbook.Sheets[name];
        const matrix = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            raw: false,
            defval: ""
        });
        if (!matrix.length) {
            sheets.push({ name, headers: [], rows: [] });
            continue;
        }

        const headers = matrix[0].map(h => cellToString(h).trim());
        const rows = [];
        for (let i = 1; i < matrix.length; i++) {
            const line = matrix[i] || [];
            const obj = {};
            let hasValue = false;
            headers.forEach((header, idx) => {
                const value = cellToString(line[idx]);
                obj[header] = value;
                if (value !== "") hasValue = true;
            });
            if (hasValue) rows.push(obj);
        }
        sheets.push({ name, headers, rows });
    }

    return sheets;
}

/**
 * @returns {Promise<{ name: string, headers: string[], rows: object[] }[]>}
 */
async function readAnySheet(filePath) {
    const abs = path.resolve(filePath);
    if (!fs.existsSync(abs)) {
        throw new Error(`Sheet not found: ${abs}`);
    }

    const ext = path.extname(abs).toLowerCase();

    if (ext === ".csv") {
        const { headers, rows } = parseCsv(fs.readFileSync(abs, "utf-8"));
        return [{ name: path.basename(abs), headers, rows }];
    }

    if (ext === ".xlsx") {
        try {
            return await readXlsxWithExcelJs(abs);
        } catch (err) {
            // Fall back to SheetJS if exceljs fails
            try {
                return readWithSheetJs(abs);
            } catch {
                throw err;
            }
        }
    }

    if (ext === ".xls") {
        return readWithSheetJs(abs);
    }

    throw new Error(
        `Unsupported sheet type "${ext}". Use .csv, .xlsx, or .xls.`
    );
}

function looksLikeSheetPath(value) {
    if (!value || typeof value !== "string") return false;
    const cleaned = value.replace(/^--+/, "").trim();
    return /\.(csv|xlsx|xls)$/i.test(cleaned);
}

module.exports = {
    readAnySheet,
    cellToString,
    looksLikeSheetPath
};
