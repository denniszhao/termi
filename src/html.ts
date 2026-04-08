export function getHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Termi</title>
  <link rel="icon" type="image/png" href="/favicon-96x96.png" sizes="96x96">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <link rel="manifest" href="/manifest.json">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Termi">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; height: 100dvh; overflow: hidden;
      background: #1e1e1e;
      touch-action: manipulation;
      -webkit-text-size-adjust: 100%;
    }
    #terminal { width: 100%; height: 100%; }
    #status {
      position: fixed; top: 0; left: 0; right: 0;
      padding: 4px 8px;
      padding-top: calc(4px + env(safe-area-inset-top));
      font-family: monospace; font-size: 12px;
      color: #888; background: rgba(0,0,0,0.8); z-index: 10;
      text-align: center; transition: opacity 0.3s;
    }
    #status.connected { opacity: 0; pointer-events: none; }

    /* Floating keyboard toggle */
    #kb-toggle {
      display: none;
      position: fixed;
      right: 8px;
      z-index: 30;
      width: 44px; height: 36px;
      font-size: 18px;
      color: #bbb; background: #333;
      border: 1px solid #555; border-radius: 8px;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      cursor: pointer;
      align-items: center; justify-content: center;
    }
    #kb-toggle.visible { display: flex; }
    #kb-toggle:active { background: #555; }
    #kb-toggle.native-active { background: #2563eb; color: #fff; border-color: #2563eb; }

    /* Custom keyboard */
    #keyboard {
      display: none;
      position: fixed; bottom: 0; left: 0; right: 0;
      padding: 4px 3px;
      padding-bottom: calc(4px + env(safe-area-inset-bottom));
      background: #1a1a1a;
      border-top: 1px solid #333;
      z-index: 20;
      flex-direction: column;
      gap: 4px;
    }
    #keyboard.visible { display: flex; }
    .kb-row {
      display: flex;
      gap: 3px;
      justify-content: center;
    }
    .kb-row.action-row { gap: 2px; }
    .kb-bottom-wrap {
      display: flex;
      gap: 3px;
    }
    .kb-bottom-left {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .kb-enter {
      width: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, system-ui, monospace;
      font-size: 18px;
      color: #fff;
      background: #2563eb;
      border: none;
      border-radius: 5px;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      cursor: pointer;
      user-select: none;
    }
    .kb-enter:active { background: #1d4ed8; }
    .kb-key {
      flex: 1;
      height: 42px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, system-ui, monospace;
      font-size: 15px;
      color: #e0e0e0;
      background: #333;
      border: none;
      border-radius: 5px;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      cursor: pointer;
      user-select: none;
      min-width: 0;
    }
    .kb-key:active, .kb-key.pressed { background: #555; }
    .kb-key.active { background: #2563eb; color: #fff; }
    .kb-key.mod {
      background: #444;
      font-size: 12px;
      color: #bbb;
    }
    .kb-key.mod:active, .kb-key.mod.pressed { background: #666; }
    .kb-key.mod.active { background: #2563eb; color: #fff; }
    .kb-key.wide { flex: 1.4; }
    .kb-key.space { flex: 4; }
    .kb-key.action {
      flex: 1;
      height: 34px;
      font-size: 11px;
      background: #2a2a2a;
      color: #999;
    }
    .kb-key.action:active, .kb-key.action.pressed { background: #555; color: #fff; }
    .kb-key.action.active { background: #2563eb; color: #fff; }

    /* Trackpad overlay */
    #trackpad-hint {
      position: fixed;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      font-family: monospace; font-size: 24px;
      color: rgba(255,255,255,0.5);
      background: rgba(0,0,0,0.5);
      padding: 12px 20px;
      border-radius: 12px;
      z-index: 15;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.3s;
    }
    #trackpad-hint.show { opacity: 1; }
  </style>
</head>
<body>
  <div id="status">Connecting...</div>
  <div id="terminal"></div>
  <div id="trackpad-hint">&larr; &rarr; &uarr; &darr;</div>
  <button id="kb-toggle">&amp;#9000;</button>
  <div id="keyboard"></div>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.min.js"></script>
  <script>
    var isMobile = "ontouchstart" in window;
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    var token = new URLSearchParams(location.search).get("t");
    var WS_URL = proto + "//" + location.host + "/?t=" + token;

    var term = new Terminal({
      cursorBlink: true,
      fontSize: isMobile ? 13 : 14,
      theme: { background: "#1e1e1e" }
    });
    var fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById("terminal"));

    var ta = document.querySelector(".xterm-helper-textarea");
    if (ta) {
      ta.setAttribute("autocomplete", "off");
      ta.setAttribute("autocorrect", "off");
      ta.setAttribute("autocapitalize", "off");
      ta.setAttribute("spellcheck", "false");
    }

    var kbEl = document.getElementById("keyboard");
    var toggleBtn = document.getElementById("kb-toggle");
    var trackpadHint = document.getElementById("trackpad-hint");

    // ---- Keyboard state ----
    var kbMode = "letters";
    var shiftState = "off";
    var ctrlActive = false;
    var useCustomKb = true;
    var lastShiftTap = 0;

    // ---- Layouts ----
    var LETTERS_TOP = [
      ["q","w","e","r","t","y","u","i","o","p"],
      ["a","s","d","f","g","h","j","k","l"]
    ];
    var LETTERS_SHIFT_ROW = [
      {id:"shift",label:"\\u21e7",mod:true,wide:true},"z","x","c","v","b","n","m",{id:"backspace",label:"\\u232b",mod:true,wide:true}
    ];
    var LETTERS_BOTTOM_ROW = [
      {id:"numbers",label:"123",mod:true,wide:true},"/","-",{id:"space",label:" ",space:true},"."
    ];

    var NUMBERS_TOP = [
      ["1","2","3","4","5","6","7","8","9","0"],
      ["!","@","#","$","%","^","&","*","(",")"]
    ];
    var NUMBERS_SHIFT_ROW = [
      {id:"symbols",label:"#+=",mod:true,wide:true},"-","_","=","+","[","]","\\\\",{id:"backspace",label:"\\u232b",mod:true,wide:true}
    ];
    var NUMBERS_BOTTOM_ROW = [
      {id:"letters",label:"abc",mod:true,wide:true},"|","~",{id:"space",label:" ",space:true},":"
    ];

    var SYMBOLS_TOP = [
      ["\`","'","\\"",";",":","{","}","<",">","?"],
      ["~","|","\\\\","/","&","^","%","$","#","@"]
    ];
    var SYMBOLS_SHIFT_ROW = [
      {id:"numbers",label:"123",mod:true,wide:true},"!","+","=","*","[","]","(",{id:"backspace",label:"\\u232b",mod:true,wide:true}
    ];
    var SYMBOLS_BOTTOM_ROW = [
      {id:"letters",label:"abc",mod:true,wide:true},"_","~",{id:"space",label:" ",space:true},"."
    ];

    var ACTION_ROW = [
      {id:"ctrlc",label:"^C"},{id:"ctrlz",label:"^Z"},{id:"ctrll",label:"^L"},
      {id:"tab",label:"Tab"},{id:"esc",label:"Esc"},{id:"ctrl",label:"Ctrl"},
      {id:"up",label:"\\u2191"},{id:"down",label:"\\u2193"}
    ];

    var ACTION_KEYS = {
      ctrlc: "\\x03", ctrlz: "\\x1a", ctrll: "\\x0c",
      tab: "\\t", esc: "\\x1b",
      up: "\\x1b[A", down: "\\x1b[B",
      backspace: "\\x7f", space: " ", enter: "\\r"
    };

    function getLayout() {
      if (kbMode === "numbers") return { top: NUMBERS_TOP, shift: NUMBERS_SHIFT_ROW, bottom: NUMBERS_BOTTOM_ROW };
      if (kbMode === "symbols") return { top: SYMBOLS_TOP, shift: SYMBOLS_SHIFT_ROW, bottom: SYMBOLS_BOTTOM_ROW };
      return { top: LETTERS_TOP, shift: LETTERS_SHIFT_ROW, bottom: LETTERS_BOTTOM_ROW };
    }

    function renderKey(key) {
      if (typeof key === "string") {
        var ch = key;
        if (kbMode === "letters" && shiftState !== "off") ch = key.toUpperCase();
        return '<div class="kb-key" data-char="' + ch.replace(/"/g,"&quot;") + '">' + ch + '</div>';
      }
      var cls = "kb-key";
      if (key.mod) cls += " mod";
      if (key.wide) cls += " wide";
      if (key.space) cls += " space";
      if (key.id === "shift" && shiftState !== "off") cls += " active";
      return '<div class="' + cls + '" data-id="' + key.id + '">' + key.label + '</div>';
    }

    function renderKeyboard() {
      var layout = getLayout();
      var html = "";

      // Action row
      html += '<div class="kb-row action-row">';
      for (var i = 0; i < ACTION_ROW.length; i++) {
        var a = ACTION_ROW[i];
        var cls = "kb-key action";
        if (a.id === "ctrl" && ctrlActive) cls += " active";
        html += '<div class="' + cls + '" data-id="' + a.id + '">' + a.label + '</div>';
      }
      html += '</div>';

      // Top rows (letters/numbers)
      for (var r = 0; r < layout.top.length; r++) {
        html += '<div class="kb-row">';
        for (var k = 0; k < layout.top[r].length; k++) {
          html += renderKey(layout.top[r][k]);
        }
        html += '</div>';
      }

      // Bottom wrap: shift row + bottom row on left, Enter on right
      html += '<div class="kb-bottom-wrap">';
      html += '<div class="kb-bottom-left">';

      // Shift row
      html += '<div class="kb-row">';
      for (var k = 0; k < layout.shift.length; k++) {
        html += renderKey(layout.shift[k]);
      }
      html += '</div>';

      // Bottom row
      html += '<div class="kb-row">';
      for (var k = 0; k < layout.bottom.length; k++) {
        html += renderKey(layout.bottom[k]);
      }
      html += '</div>';

      html += '</div>'; // kb-bottom-left
      html += '<div class="kb-enter" data-id="enter">\\u21b5</div>';
      html += '</div>'; // kb-bottom-wrap

      kbEl.innerHTML = html;
    }

    function handleKey(el) {
      var ch = el.getAttribute("data-char");
      var id = el.getAttribute("data-id");

      if (ch) {
        if (ctrlActive) {
          var lower = ch.toLowerCase();
          var code = lower.charCodeAt(0) - 96;
          if (code >= 1 && code <= 26) {
            sendKey(String.fromCharCode(code));
          } else {
            sendKey(ch);
          }
          ctrlActive = false;
          renderKeyboard();
        } else {
          sendKey(ch);
          if (shiftState === "on") {
            shiftState = "off";
            renderKeyboard();
          }
        }
        return;
      }

      if (!id) return;

      if (id === "shift") {
        var now = Date.now();
        if (shiftState === "off") {
          shiftState = "on";
          lastShiftTap = now;
        } else if (shiftState === "on" && now - lastShiftTap < 400) {
          shiftState = "caps";
        } else {
          shiftState = "off";
        }
        renderKeyboard();
        return;
      }

      if (id === "ctrl") {
        ctrlActive = !ctrlActive;
        renderKeyboard();
        return;
      }

      if (id === "numbers") { kbMode = "numbers"; renderKeyboard(); return; }
      if (id === "symbols") { kbMode = "symbols"; renderKeyboard(); return; }
      if (id === "letters") { kbMode = "letters"; renderKeyboard(); return; }

      var seq = ACTION_KEYS[id];
      if (seq) {
        sendKey(seq);
        if (ctrlActive) {
          ctrlActive = false;
          renderKeyboard();
        }
      }
    }

    // ---- Keyboard toggle ----
    function toggleKeyboard() {
      useCustomKb = !useCustomKb;
      if (useCustomKb) {
        if (ta) ta.setAttribute("inputMode", "none");
        kbEl.classList.add("visible");
        toggleBtn.classList.remove("native-active");
        toggleBtn.textContent = "\\u2328";
      } else {
        if (ta) ta.removeAttribute("inputMode");
        kbEl.classList.remove("visible");
        toggleBtn.classList.add("native-active");
        toggleBtn.textContent = "\\u2328";
      }
      fitTerminal();
      sendResize();
      term.focus();
    }

    function positionToggle() {
      if (!isMobile) return;
      if (useCustomKb) {
        toggleBtn.style.bottom = (kbEl.offsetHeight + 6) + "px";
      } else {
        // Position above native keyboard using visualViewport
        var vvh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        var wh = window.innerHeight;
        var kbHeight = wh - vvh;
        toggleBtn.style.bottom = (kbHeight > 50 ? kbHeight + 6 : 50) + "px";
      }
    }

    toggleBtn.addEventListener("click", function(e) {
      e.preventDefault();
      toggleKeyboard();
    });

    // ---- Terminal + WebSocket ----
    function fitTerminal() {
      var kbH = (isMobile && useCustomKb) ? kbEl.offsetHeight : 0;
      var vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.getElementById("terminal").style.height = (vh - kbH) + "px";
      fitAddon.fit();
      positionToggle();
    }

    var statusEl = document.getElementById("status");
    var ws;

    function sendKey(data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data: data }));
      }
    }

    function sendResize() {
      var dims = fitAddon.proposeDimensions();
      if (dims && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      }
    }

    function connect() {
      ws = new WebSocket(WS_URL);
      ws.onopen = function() {
        statusEl.textContent = "Connected";
        statusEl.classList.add("connected");
        fitTerminal();
        sendResize();
      };
      ws.onmessage = function(e) {
        var msg = JSON.parse(e.data);
        if (msg.type === "data") term.write(msg.data);
      };
      ws.onclose = function() {
        statusEl.textContent = "Disconnected. Reconnecting...";
        statusEl.classList.remove("connected");
        setTimeout(connect, 2000);
      };
      ws.onerror = function() { ws.close(); };
    }

    term.onData(function(data) { sendKey(data); });

    // ---- Keyboard touch handling ----
    kbEl.addEventListener("touchstart", function(e) {
      var el = e.target.closest("[data-char],[data-id]");
      if (!el) return;
      e.preventDefault();
      el.classList.add("pressed");
      handleKey(el);
    }, { passive: false });

    kbEl.addEventListener("touchend", function(e) {
      var el = e.target.closest(".pressed");
      if (el) el.classList.remove("pressed");
    });

    kbEl.addEventListener("click", function(e) {
      if (isMobile) return;
      var el = e.target.closest("[data-char],[data-id]");
      if (!el) return;
      handleKey(el);
    });

    // ---- Trackpad: touch-drag on terminal sends arrow keys ----
    var tpStartX = 0, tpStartY = 0, tpLastX = 0, tpLastY = 0;
    var tpDragging = false;
    var tpHintTimer = null;
    var DRAG_THRESHOLD = 10;
    var STEP_X = 20;
    var STEP_Y = 25;

    if (isMobile) {
      var termEl = document.getElementById("terminal");

      termEl.addEventListener("touchstart", function(e) {
        if (e.touches.length !== 1) return;
        tpStartX = tpLastX = e.touches[0].clientX;
        tpStartY = tpLastY = e.touches[0].clientY;
        tpDragging = false;
      }, { capture: true, passive: true });

      termEl.addEventListener("touchmove", function(e) {
        if (e.touches.length !== 1) return;
        var x = e.touches[0].clientX;
        var y = e.touches[0].clientY;

        if (!tpDragging) {
          var dx = Math.abs(x - tpStartX);
          var dy = Math.abs(y - tpStartY);
          if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
            tpDragging = true;
            // Show hint
            trackpadHint.classList.add("show");
            if (tpHintTimer) clearTimeout(tpHintTimer);
            tpHintTimer = setTimeout(function() {
              trackpadHint.classList.remove("show");
            }, 800);
          }
        }

        if (tpDragging) {
          e.preventDefault();
          var moveX = x - tpLastX;
          var moveY = y - tpLastY;

          while (moveX > STEP_X) { sendKey("\\x1b[C"); tpLastX += STEP_X; moveX -= STEP_X; }
          while (moveX < -STEP_X) { sendKey("\\x1b[D"); tpLastX -= STEP_X; moveX += STEP_X; }
          while (moveY > STEP_Y) { sendKey("\\x1b[B"); tpLastY += STEP_Y; moveY -= STEP_Y; }
          while (moveY < -STEP_Y) { sendKey("\\x1b[A"); tpLastY -= STEP_Y; moveY += STEP_Y; }
        }
      }, { capture: true, passive: false });

      termEl.addEventListener("touchend", function(e) {
        if (!tpDragging) {
          // Normal tap — let xterm handle focus
          term.focus();
        }
        tpDragging = false;
      }, { capture: true, passive: true });
    }

    // ---- Viewport resize ----
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function() {
        fitTerminal();
        sendResize();
      });
    }
    window.addEventListener("resize", function() {
      fitTerminal();
      sendResize();
    });

    // ---- Init ----
    if (isMobile) {
      if (ta) ta.setAttribute("inputMode", "none");
      renderKeyboard();
      kbEl.classList.add("visible");
      toggleBtn.classList.add("visible");
      toggleBtn.textContent = "\\u2328";
      setTimeout(positionToggle, 50);
    }
    fitTerminal();
    connect();
  </script>
</body>
</html>`;
}
