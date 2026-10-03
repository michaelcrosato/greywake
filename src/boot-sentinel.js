// Intentionally ES5: remains useful when modern scripts cannot parse or load.
(function () {
  var panel = document.getElementById('boot-root');
  var started = false;
  window.__consoleErrors = [];
  function fail(code, message, error) {
    if (window.gameBoot) {
      window.gameBoot.fail(code, error || new Error(message));
      return;
    }
    window.__bootSentinel.failure = { code: code, message: message };
    panel.hidden = false;
    document.getElementById('boot-platform').textContent = navigator.userAgent;
    var report = document.getElementById('boot-report');
    report.hidden = false;
    report.value = JSON.stringify(
      {
        schema: 'game-boot/1',
        stage: 'SCRIPT',
        status: 'failed',
        failureCode: code,
        message: message,
        version: document.getElementById('boot-version').textContent,
        buildId: document.getElementById('boot-build').textContent,
        platform: navigator.userAgent
      },
      null,
      2
    );
    document.getElementById('boot-status').textContent = code + ' / Startup stopped';
    document.getElementById('boot-error').textContent = message;
    document.getElementById('boot-error').hidden = false;
    document.getElementById('boot-actions').hidden = false;
    window.__consoleErrors.push(code + ': ' + message);
  }
  window.__bootSentinel = {
    adopt: function () {
      started = true;
    },
    fail: fail
  };
  window.addEventListener('error', function (event) {
    var stage = window.gameBoot ? window.gameBoot.report.stage : 'SCRIPT';
    if (window.gameBoot && window.gameBoot.report.status === 'ready') stage = 'RUN';
    fail(stage + '-UNCAUGHT', event.message || 'Startup script or resource failed to load.', event.error);
  });
  window.addEventListener('unhandledrejection', function (event) {
    var stage = window.gameBoot ? window.gameBoot.report.stage : 'SCRIPT';
    if (window.gameBoot && window.gameBoot.report.status === 'ready') stage = 'RUN';
    fail(stage + '-REJECT', String((event.reason && event.reason.message) || event.reason), event.reason);
  });
  document.getElementById('boot-copy').onclick = function () {
    var report = document.getElementById('boot-report');
    report.hidden = false;
    report.select();
    document.getElementById('boot-feedback').textContent = 'Select and copy the report below.';
  };
  document.getElementById('boot-download').hidden = true;
  document.getElementById('boot-webgl').hidden = true;
  var required = ['Promise', 'WebAssembly', 'Uint8Array', 'TextDecoder', 'requestAnimationFrame'];
  var missing = required.filter(function (key) {
    return !window[key];
  });
  if (missing.length) fail('SYS-MISSING', 'Required capabilities unavailable: ' + missing.join(', '));
  document.getElementById('boot-retry').onclick = function () {
    location.reload();
  };
  setTimeout(function () {
    if (!started)
      fail(
        'SCRIPT-TIME',
        'Startup script did not run. JavaScript may be unsupported or files may be blocked. Reload or try a current browser.'
      );
  }, 15000);
})();
