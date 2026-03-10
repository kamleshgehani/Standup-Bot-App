// ─────────────────────────────────────────────────────────────
// server.js — Smart Standup Bot · Express Backend
// ─────────────────────────────────────────────────────────────
//
// Workflow (end-to-end):
//   1. Frontend POSTs raw standup text  →  POST /api/standup
//   2. Server sends the text to Groq    →  AI summarizes it
//   3. Server calls storeStandup()      →  saves to Supabase
//   4. Server calls getStandupHistory() →  loads recent items
//   5. Server returns { summary, history } to the frontend
//
// External services used:
//   • Groq  — fast LLM inference (llama-3.3-70b-versatile)
//   • Supabase — hosted PostgreSQL (via MCP-style tool fns)
// ─────────────────────────────────────────────────────────────

// ── 1. Load environment variables first (before anything else)
require("dotenv").config();
// After this line, process.env.GROQ_API_KEY etc. are available

// ── 2. Core dependencies ──────────────────────────────────────
const express = require("express");  // HTTP server framework
const cors    = require("cors");     // Allow cross-origin requests
const path    = require("path");     // Build file-system paths safely
const Groq    = require("groq-sdk"); // Official Groq Node SDK

// ── 3. Import our MCP-style Supabase tool functions ───────────
const { storeStandup, getStandupHistory } = require("./tools");

// ── 4. Initialise Express app ─────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000; // Prefer env var, fall back to 3000

// ── 5. Initialise Groq client ─────────────────────────────────
// The SDK reads GROQ_API_KEY automatically from process.env
// (we can also pass it explicitly: new Groq({ apiKey: "..." }))
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────
app.use(cors());              // Allow browser → server requests
app.use(express.json());      // Parse incoming JSON request bodies

// Serve everything inside /public as static files (HTML, CSS, JS)
// So http://localhost:3000/ → public/index.html
app.use(express.static(path.join(__dirname, "public")));

// ─────────────────────────────────────────────────────────────
// HELPER — buildPrompt(yesterday, today, blockers)
// ─────────────────────────────────────────────────────────────
// Constructs the system + user messages that instruct Groq to
// take the three standup sections and produce a polished,
// clean, bullet-pointed summary.
//
// We use a "system" role to set the AI's persona/rules and a
// "user" role to supply the actual standup notes split into
// the three standard sections.
// ─────────────────────────────────────────────────────────────
function buildPrompt(yesterday, today, blockers) {
  return [
    {
      role: "system",
      // The system message tells the model HOW to behave.
      // Strict formatting rules here keep the output consistent
      // so the frontend can render it predictably.
// content: `You are a concise technical writer summarising a developer's daily standup.

// REWRITE the input in your own words — do NOT copy or echo the user's phrasing. 
// Condense the meaning, cut filler, and infer implied actions from vague input 
// (e.g. "did some PRs" → "Reviewed and merged pull requests", "bug fixes" → "Resolved critical bugs in [module]").

// Always respond with ONLY a valid JSON object in this exact shape (no markdown, no extra text):
// {
//   "yesterday": "summarised bullets of what was completed",
//   "today":     "summarised bullets of what will be worked on",
//   "blockers":  "specific blocker with reason, or 'None'"
// }

// Rules:
// - NEVER copy the user's exact words — always rephrase with stronger, cleaner language.
// - Start every bullet with a strong verb directly — no "I" prefix.
//   Yesterday: past-tense  (e.g. "Fixed ...", "Reviewed ...", "Deployed ...")
//   Today:     present/future (e.g. "Implement ...", "Write ...", "Investigate ...")
// - Keep each bullet under 15 words.
// - Max 3 bullets per field — combine related tasks if needed.
// - Use • to separate multiple bullets within a field.
// - If a section is missing from the input, write "Nothing to report".
// - Blockers: name what is blocked AND why (e.g. "Cannot proceed with X — awaiting Y from Z").
// - Elevate vague entries: "meetings" → "Attended planning/sync sessions", "bug fixes" → "Resolved bugs in [inferred area]".`,

      content: `You are a technical standup rewriter. Transform raw developer notes into a clean standup summary.

RULES:
- Rephrase everything — never echo the user's words
- Infer meaning from vague input ("bug fixes" → "Resolved bugs in auth module")
- Strong verbs only, no "I" (Yesterday: past tense, Today: future tense)
- Max 3 bullets per section, under 15 words each, separated by •
- Blockers: state what + why, or "None"

Respond ONLY with valid JSON, no markdown:
{"yesterday": "...", "today": "...", "blockers": "..."}`,
    },
    {
      role: "user",
      // The user message contains the three standup sections.
      content: `Here are my standup notes:

Yesterday: ${yesterday || "Nothing mentioned"}
Today: ${today || "Nothing mentioned"}
Blockers: ${blockers || "None"}`,
    },
  ];
}

// ─────────────────────────────────────────────────────────────
// ROUTE — POST /api/standup
// ─────────────────────────────────────────────────────────────
// This is the single API endpoint the frontend calls.
//
// Request body  : { "yesterday": "...", "today": "...", "blockers": "..." }
// Response body : { "summary": "...", "history": [...] }
// ─────────────────────────────────────────────────────────────
app.post("/api/standup", async (req, res) => {
  // ── Step 0: Validate input ───────────────────────────────
  // Destructure the three standup sections from the request body
  const { yesterday, today, blockers } = req.body;

  // At least one section must have content
  if (!yesterday?.trim() && !today?.trim() && !blockers?.trim()) {
    return res.status(400).json({ error: "Please fill in at least one standup section." });
  }

  console.log("\n─────────────────────────────────────────");
  console.log("[Server] New standup received");
  console.log("[Server] Yesterday:", (yesterday || "—").slice(0, 50));
  console.log("[Server] Today:    ", (today || "—").slice(0, 50));
  console.log("[Server] Blockers: ", (blockers || "—").slice(0, 50));

  try {
    // ── Step 1: Send all three sections to Groq ────────────
    console.log("[Server] Step 1 — Calling Groq API...");

    const chatCompletion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",        // Fast, high-quality Llama 3.3 model
      messages: buildPrompt(yesterday, today, blockers), // 3 sections → system + user messages
      temperature: 0.2,  // Very low = highly deterministic, follows summarisation rules closely
      max_tokens: 512,   // Standup summaries are short; cap tokens to save quota
    });

    const content = chatCompletion.choices[0].message.content.trim();
    console.log("[Server] Groq response received:\n", content);

    // ── Step 1b: Parse structured JSON from the model ────────
    let parsed;
    try {
      const clean = content.replace(/```json|```/gi, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = { yesterday: content, today: '', blockers: '' };
    }

    const summary = [
      `Yesterday:\n${parsed.yesterday || 'Not provided'}`,
      `Today:\n${parsed.today || 'Not provided'}`,
      `Blockers:\n${parsed.blockers || 'None'}`,
    ].join('\n\n');

    // ── Step 2: Call MCP-style tool → storeStandup() ───────
    console.log("[Server] Step 2 — Calling tool: storeStandup()");
    await storeStandup(summary);

    // ── Step 3: Call MCP-style tool → getStandupHistory() ──
    console.log("[Server] Step 3 — Calling tool: getStandupHistory()");
    const history = await getStandupHistory(10);

    // ── Step 4: Return everything to the frontend ───────────
    console.log("[Server] Step 4 — Sending response to client");
    return res.status(200).json({
      summary,
      parsed,
      history,
    });

  } catch (err) {
    // Something went wrong (Groq error, Supabase error, network, etc.)
    console.error("[Server] ERROR:", err.message);
    return res.status(500).json({
      error: "Something went wrong. Check server logs for details.",
      detail: err.message, // Helpful during development
    });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTE — GET /api/history
// ─────────────────────────────────────────────────────────────
// Lets the frontend load history on page-load without submitting
// a new standup.
//
// Query param : ?limit=10  (optional, defaults to 10)
// Response    : { "history": [...] }
// ─────────────────────────────────────────────────────────────
app.get("/api/history", async (req, res) => {
  const limit = parseInt(req.query.limit) || 10; // parse or default to 10

  try {
    console.log(`[Server] GET /api/history — fetching ${limit} items`);
    const history = await getStandupHistory(limit);
    return res.status(200).json({ history });
  } catch (err) {
    console.error("[Server] GET /api/history ERROR:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// START THE SERVER
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("─────────────────────────────────────────");
  console.log(`  🤖 Smart Standup Bot is running!`);
  console.log(`  👉 Open: http://localhost:${PORT}`);
  console.log("─────────────────────────────────────────");
});

