'use strict';
const cc = require('cc');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
exports.load = function () {};
exports.unload = function () {};
exports.methods = {
    async execute(code) { return new AsyncFunction('cc', 'Editor', 'require', code)(cc, Editor, require); },
};
