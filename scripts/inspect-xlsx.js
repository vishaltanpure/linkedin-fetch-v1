const { readWorkbook } = require("../utils/xlsx");

(async () => {
    const filePath = process.argv[2];
    const sheets = await readWorkbook(filePath);
    for (const s of sheets) {
        console.log("=== " + s.name + " ===");
        console.log("headers:", JSON.stringify(s.headers));
        console.log("first row:", JSON.stringify(s.rows[0]));
        console.log();
    }
})();
