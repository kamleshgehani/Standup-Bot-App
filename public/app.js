// ═══════════════════════════════════════════════════════════
// app.js — Smart Standup Bot · Frontend Logic
// ═══════════════════════════════════════════════════════════
//
// The frontend has THREE separate textarea inputs:
//   1. Yesterday — what the user did
//   2. Today     — what the user plans to do
//   3. Blockers  — anything in their way
//
// These three are sent as separate fields to the backend.
// The backend combines them, sends to Groq for a polished
// summary, stores it in Supabase, and returns the result.
// ═══════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────
// DOM References
// Grab every element we'll touch once at startup.
// ─────────────────────────────────────────────────────────

// The three standup input textareas
const yesterdayEl = document.getElementById("input-yesterday");
const todayEl     = document.getElementById("input-today");
const blockersEl  = document.getElementById("input-blockers");

// Button and its inner elements
const btnEl       = document.getElementById("submit-btn");
const btnLabelEl  = document.getElementById("btn-label");
const spinnerEl   = document.getElementById("spinner");

// Output areas
const errorEl     = document.getElementById("error-banner");
const summaryCard = document.getElementById("summary-card");
const summaryOut  = document.getElementById("summary-output");
const historyList = document.getElementById("history-list");

// ─────────────────────────────────────────────────────────
// submitStandup()
// ─────────────────────────────────────────────────────────
// Main action — triggered by the "Generate Summary" button.
//
// Flow:
//   1. Read all three textareas
//   2. Validate at least one field has content
//   3. POST { yesterday, today, blockers } to /api/standup
//   4. Server: combines them → sends to Groq → stores in DB
//   5. We receive { summary, history } back
//   6. Render summary + history into the DOM
// ─────────────────────────────────────────────────────────
async function submitStandup() {
  // ── Read all three inputs ───────────────────────────────
  const yesterday = yesterdayEl.value.trim();
  const today     = todayEl.value.trim();
  const blockers  = blockersEl.value.trim();

  // ── Guard: at least one field must have content ─────────
  if (!yesterday && !today && !blockers) {
    showError("Please fill in at least one standup section.");
    return;
  }

  setLoading(true); // disable button, show spinner
  hideError();      // clear any previous error

  try {
    // ── POST the three fields to the Express backend ──────
    // The server will combine them and send to Groq.
    const response = await fetch("/api/standup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yesterday, today, blockers }),
    });

    const data = await response.json(); // parse JSON body

    // Non-2xx HTTP status → treat as an error
    if (!response.ok) {
      throw new Error(data.error || "Server error — please try again.");
    }

    // ── Render the formatted AI summary ─────────────────
    renderSummary(data.summary, data.parsed);

    // ── Refresh the history feed with the latest rows ───
    renderHistory(data.history);

    // Clear all three textareas so the user can write a fresh standup
    yesterdayEl.value = "";
    todayEl.value     = "";
    blockersEl.value  = "";

  } catch (err) {
    // Covers: network failures, JSON parse errors, server 500s
    showError(err.message);
  } finally {
    // Always restore the button — even if an error occurred
    setLoading(false);
  }
}

// ─────────────────────────────────────────────────────────
// renderSummary(summaryText)
// ─────────────────────────────────────────────────────────
// Converts the plain-text AI output into colour-coded HTML.
//
// The AI always returns text in this shape:
//
//   Yesterday:
//   - bullet
//   Today:
//   - bullet
//   Blockers:
//   - bullet
//
// We parse line-by-line, bucket bullets by section,
// then build tinted <ul> cards with coloured headings.
// ─────────────────────────────────────────────────────────
function renderSummary(summaryText, parsed) {
  const sections = [
    { key: "Yesterday", field: "yesterday", labelClass: "label-yesterday", sectionClass: "section-yesterday" },
    { key: "Today",     field: "today",     labelClass: "label-today",     sectionClass: "section-today"     },
    { key: "Blockers",  field: "blockers",  labelClass: "label-blockers",  sectionClass: "section-blockers"  },
  ];

  let buckets;

  if (parsed && parsed.yesterday !== undefined) {
    // Use the structured JSON object directly
    buckets = {};
    for (const { key, field } of sections) {
      const raw = (parsed[field] || "").trim();
      if (!raw || raw.toLowerCase() === "not provided") {
        buckets[key] = [];
      } else {
        buckets[key] = raw
          .split(/\n|•/)
          .map(b => b.replace(/^[-•]\s*/, "").trim())
          .filter(Boolean);
      }
    }
  } else {
    // Fallback: parse plain-text summary (legacy format)
    const lines = summaryText.split("\n").map(l => l.trim()).filter(Boolean);
    buckets = { Yesterday: [], Today: [], Blockers: [] };
    let currentSection = null;

    for (const line of lines) {
      const headerMatch = sections.find(s =>
        line.toLowerCase().startsWith(s.key.toLowerCase())
      );
      if (headerMatch) {
        currentSection = headerMatch.key;
      } else if (currentSection && /^[-•]/.test(line)) {
        buckets[currentSection].push(line.replace(/^[-•]\s*/, ""));
      }
    }
  }

  let html = "";
  for (const { key, labelClass, sectionClass } of sections) {
    const bullets = buckets[key];
    const items = bullets.length
      ? bullets.map(b => `<li>${escapeHtml(b)}</li>`).join("")
      : `<li>${key === "Blockers" ? "None" : "—"}</li>`;

    html += `
      <div class="summary-section ${sectionClass}">
        <div class="section-label ${labelClass}">${key}</div>
        <ul class="bullet-list">${items}</ul>
      </div>`;
  }

  summaryOut.innerHTML = html;
  summaryCard.style.display = "block";
  summaryCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─────────────────────────────────────────────────────────
// renderHistory(items)
// ─────────────────────────────────────────────────────────
// Renders an array of standup rows from Supabase as a
// vertical list of cards inside #history-list.
//
// Each item shape: { id, summary, created_at }
// ─────────────────────────────────────────────────────────
function renderHistory(items) {
  // No rows yet? Show a friendly empty state.
  if (!items || items.length === 0) {
    historyList.innerHTML =
      `<p class="empty-state">No standups yet. Submit your first one above!</p>`;
    return;
  }

  const cards = items.map(item => {
    // Convert ISO timestamp → human-readable local date & time
    const date = new Date(item.created_at).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });

    return `
      <div class="history-item">
        <div class="history-item-meta">📅 ${date} &nbsp;·&nbsp; #${item.id}</div>
        <div class="history-item-text">${escapeHtml(item.summary)}</div>
      </div>`;
  });

  historyList.innerHTML = cards.join("");
}

// ─────────────────────────────────────────────────────────
// loadHistory()
// ─────────────────────────────────────────────────────────
// Called once on page load to populate the history feed
// before the user has submitted anything new.
// ─────────────────────────────────────────────────────────
async function loadHistory() {
  try {
    const res  = await fetch("/api/history?limit=10");
    const data = await res.json();
    if (res.ok && data.history) renderHistory(data.history);
  } catch (_) {
    // Silently ignore — the history feed isn't critical on load
  }
}

// ─────────────────────────────────────────────────────────
// UI Helper — setLoading(isLoading)
// ─────────────────────────────────────────────────────────
function setLoading(isLoading) {
  btnEl.disabled              = isLoading;
  spinnerEl.style.display     = isLoading ? "block" : "none";
  btnLabelEl.textContent      = isLoading ? "Generating…" : "✨ Generate Summary";
}

// ─────────────────────────────────────────────────────────
// UI Helper — showError(msg) / hideError()
// ─────────────────────────────────────────────────────────
function showError(msg) {
  errorEl.textContent   = "⚠️  " + msg;
  errorEl.style.display = "block";
}

function hideError() {
  errorEl.style.display = "none";
  errorEl.textContent   = "";
}

// ─────────────────────────────────────────────────────────
// Security Helper — escapeHtml(str)
// ─────────────────────────────────────────────────────────
// Prevents XSS by escaping user text before innerHTML insertion.
// ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#039;");
}

// ─────────────────────────────────────────────────────────
// Event Listeners
// ─────────────────────────────────────────────────────────

// Ctrl+Enter (Win/Linux) or Cmd+Enter (Mac) submits from any textarea
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    submitStandup();
  }
});

// On page load → populate the history feed immediately
document.addEventListener("DOMContentLoaded", loadHistory);
