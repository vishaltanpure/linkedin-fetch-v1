function line() {

    console.log(
        "=================================================="
    );

}

function title(text) {

    line();

    console.log(text);

    line();

}

function success(text) {

    console.log("✅", text);

}

function warning(text) {

    console.log("⚠️", text);

}

function error(text) {

    console.log("❌", text);

}

function info(text) {

    console.log("ℹ️", text);

}

module.exports = {

    line,

    title,

    success,

    warning,

    error,

    info

};