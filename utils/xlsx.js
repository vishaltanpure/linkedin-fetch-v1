/**
 * Thin wrapper around exceljs for reading/writing multi-sheet workbooks
 * as plain { name, headers, rows } tables — the same shape utils/csv.js
 * hands back, so callers don't need to care whether the source was a
 * .csv or .xlsx file.
 */

const ExcelJS = require("exceljs");

// Read every sheet into { name, headers, rows: [{header: value, ...}] }.
async function readWorkbook(filePath) {

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const sheets = [];

    workbook.eachSheet(worksheet => {

        const headerRow = worksheet.getRow(1);
        const headers = [];

        headerRow.eachCell({ includeEmpty: false }, cell => {
            headers.push(String(cell.value ?? "").trim());
        });

        const rows = [];

        for (let rowNum = 2; rowNum <= worksheet.rowCount; rowNum++) {
            const row = worksheet.getRow(rowNum);
            if (row.cellCount === 0) continue;

            const obj = {};
            let hasValue = false;

            headers.forEach((header, idx) => {
                const cell = row.getCell(idx + 1);
                const value = cell.value === null || cell.value === undefined
                    ? ""
                    : String(cell.value);
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
            worksheet.addRow(row);
        }
    }

    await workbook.xlsx.writeFile(filePath);
}

module.exports = {
    readWorkbook,
    writeWorkbook
};
