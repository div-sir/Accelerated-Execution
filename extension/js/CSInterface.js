(function (global) {
  "use strict";

  function CSInterface() {}

  CSInterface.prototype.evalScript = function (script, callback) {
    if (!global.__adobe_cep__ || !global.__adobe_cep__.evalScript) {
      if (callback) callback('{"ok":false,"error":"Adobe CEP runtime is unavailable."}');
      return;
    }

    global.__adobe_cep__.evalScript(script, callback || function () {});
  };

  global.CSInterface = CSInterface;
})(window);
