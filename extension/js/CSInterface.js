(function (global) {
  "use strict";

  function CSInterface() {}

  var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
  };

  CSInterface.prototype.evalScript = function (script, callback) {
    if (!global.__adobe_cep__ || !global.__adobe_cep__.evalScript) {
      if (callback) callback('{"ok":false,"error":"Adobe CEP runtime is unavailable."}');
      return;
    }

    global.__adobe_cep__.evalScript(script, callback || function () {});
  };

  CSInterface.prototype.getSystemPath = function (pathType) {
    if (!global.__adobe_cep__ || !global.__adobe_cep__.getSystemPath) return "";
    var path = decodeURI(global.__adobe_cep__.getSystemPath(pathType));
    if (path.indexOf("file://") === 0) path = path.slice(7);
    if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
    return path;
  };

  global.CSInterface = CSInterface;
  global.SystemPath = SystemPath;
})(window);
