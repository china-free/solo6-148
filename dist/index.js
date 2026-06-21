"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignalHandler = exports.DarwinBackend = exports.LinuxBackend = exports.BackendManager = exports.NetworkController = void 0;
var controller_1 = require("./controller");
Object.defineProperty(exports, "NetworkController", { enumerable: true, get: function () { return controller_1.NetworkController; } });
var backends_1 = require("./backends");
Object.defineProperty(exports, "BackendManager", { enumerable: true, get: function () { return backends_1.BackendManager; } });
Object.defineProperty(exports, "LinuxBackend", { enumerable: true, get: function () { return backends_1.LinuxBackend; } });
Object.defineProperty(exports, "DarwinBackend", { enumerable: true, get: function () { return backends_1.DarwinBackend; } });
var signals_1 = require("./signals");
Object.defineProperty(exports, "SignalHandler", { enumerable: true, get: function () { return signals_1.SignalHandler; } });
__exportStar(require("./types"), exports);
__exportStar(require("./profiles"), exports);
__exportStar(require("./process"), exports);
__exportStar(require("./utils"), exports);
//# sourceMappingURL=index.js.map