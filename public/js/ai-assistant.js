/**
 * FCA AI Assistant — floating chatbot.
 * Requires the user to be logged in and to have a JWT stored in
 * localStorage under one of: 'token' | 'jwt' | 'authToken'.
 *
 * Drop the following into any authenticated page (dashboard, admin, lecturer, scanner):
 *   <link rel="stylesheet" href="/css/ai-assistant.css">
 *   <script src="/js/ai-assistant.js" defer></script>
 */
(function () {
  if (window.__fcaAiLoaded) return;
  window.__fcaAiLoaded = true;

  function token() {
    return (
      localStorage.getItem("token") ||
      localStorage.getItem("jwt") ||
      localStorage.getItem("authToken") ||
      ""
    );
  }
  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    kids.flat().forEach((k) => el.append(k?.nodeType ? k : document.createTextNode(String(k))));
    return el;
  }

  const fab = h("button", { class: "fca-ai-fab", title: "AI Assistant", "aria-label": "Open AI Assistant" }, "🤖");
  const panel = h("div", { class: "fca-ai-panel", role: "dialog", "aria-label": "AI Assistant" });
  const head = h("div", { class: "fca-ai-head" });
  const title = h("div", {}, h("h4", {}, "FCA AI Assistant"), h("small", {}, "Rule-based first, AI when needed"));
  const clearBtn = h("button", { title: "Clear conversation", onclick: clearChat }, "🧹");
  const closeBtn = h("button", { title: "Close", onclick: () => panel.classList.remove("open") }, "×");
  head.append(title, h("div", {}, clearBtn, closeBtn));
  const body = h("div", { class: "fca-ai-body" });
  const sugg = h("div", { class: "fca-ai-suggestions" });
  const form = h("form", { class: "fca-ai-form", onsubmit: onSubmit });
  const input = h("input", { type: "text", placeholder: "Ask about attendance, PC, kit…", autocomplete: "off" });
  const submit = h("button", { type: "submit" }, "Send");
  form.append(input, submit);
  panel.append(head, body, sugg, form);

  fab.addEventListener("click", async () => {
    panel.classList.toggle("open");
    if (panel.classList.contains("open")) {
      input.focus();
      if (!body.children.length) {
        botMsg("👋 Hi! Ask about attendance, your kit, or type help.", "rules");
        await loadSuggestions();
      }
    }
  });
  document.body.append(fab, panel);

  let lastEscalatable = false;

  async function loadSuggestions() {
    try {
      const r = await fetch("/api/ai/suggestions", { headers: { Authorization: `Bearer ${token()}` } });
      if (!r.ok) return;
      const { suggestions = [] } = await r.json();
      sugg.innerHTML = "";
      suggestions.forEach((s) => {
        const b = h("button", { type: "button", onclick: () => { input.value = s.replace(/^[^\w]+/, ""); form.requestSubmit(); } }, s);
        sugg.append(b);
      });
    } catch {}
  }

  async function onSubmit(e) {
    e.preventDefault();
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    userMsg(msg);
    await send(msg, false);
  }

  async function send(message, escalate) {
    submit.disabled = true;
    const typing = h("div", { class: "fca-ai-typing" }, "…thinking");
    body.append(typing); body.scrollTop = body.scrollHeight;
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ message, escalate }),
      });
      const data = await r.json();
      typing.remove();
      if (!r.ok) { botMsg(data.error || "Error", "system"); return; }
      botMsg(data.text || "(no reply)", data.source || "rules");
      lastEscalatable = data.source === "system" && data.intent === "unknown";
      if (lastEscalatable) {
        const askAi = h("button", {
          type: "button", class: "fca-ai-msg bot", style: "cursor:pointer;background:#eef2ff",
          onclick: () => send(message, true),
        }, "🤖 Try with AI");
        body.append(askAi); body.scrollTop = body.scrollHeight;
      }
    } catch (err) {
      typing.remove();
      botMsg("⚠️ Network error: " + err.message, "system");
    } finally {
      submit.disabled = false;
      input.focus();
    }
  }

  async function clearChat() {
    body.innerHTML = "";
    try { await fetch("/api/ai/clear", { method: "POST", headers: { Authorization: `Bearer ${token()}` } }); } catch {}
    botMsg("🧹 Cleared. Ask me anything.", "rules");
  }

  function userMsg(text) {
    body.append(h("div", { class: "fca-ai-msg user" }, text));
    body.scrollTop = body.scrollHeight;
  }
  function botMsg(text, source) {
    const el = h("div", { class: "fca-ai-msg bot" }, text);
    if (source) el.append(h("span", { class: "src" }, source));
    body.append(el);
    body.scrollTop = body.scrollHeight;
  }
})();
