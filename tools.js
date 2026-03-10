// ─────────────────────────────────────────────────────────────
// tools.js — MCP-Style Tool Functions
// ─────────────────────────────────────────────────────────────
//
// In the Model Context Protocol (MCP) pattern, "tools" are
// discrete, named functions that an AI or server can invoke
// to interact with external systems (databases, APIs, etc.).
//
// Each tool has:
//   • A clear name   → what it does
//   • A description  → why it exists
//   • Input schema   → what arguments it expects
//   • An execute fn  → the actual logic
//
// Here we define two tools that talk to Supabase:
//   1. storeStandup(summary)        — writes a row
//   2. getStandupHistory(limit)     — reads recent rows
// ─────────────────────────────────────────────────────────────

// Load environment variables from .env
require("dotenv").config();

// Supabase client library — gives us a typed, promise-based
// interface to our Supabase PostgreSQL database.
const { createClient } = require("@supabase/supabase-js");

// ── Create a single Supabase client instance ─────────────────
// We read credentials from env vars so secrets are NEVER
// hardcoded in source code.
const supabase = createClient(
  process.env.SUPABASE_URL,      // e.g. https://xxxx.supabase.co
  process.env.SUPABASE_ANON_KEY  // anon/public key from dashboard
);

// ─────────────────────────────────────────────────────────────
// TOOL 1: storeStandup
// ─────────────────────────────────────────────────────────────
// Description : Inserts a formatted AI summary into the
//               `standups` table in Supabase.
//
// Arguments   : summary (string) — the formatted standup text
//               produced by Groq.
//
// Returns     : The newly inserted row, or throws an Error.
//
// Supabase table schema expected:
//   CREATE TABLE standups (
//     id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
//     summary    TEXT        NOT NULL,
//     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
//   );
// ─────────────────────────────────────────────────────────────
async function storeStandup(summary) {
  console.log("[Tool] storeStandup called — inserting summary into Supabase");

  // .from("standups") → target the `standups` table
  // .insert([{ summary }]) → insert a new row with the summary field
  // .select() → return the inserted row so we can confirm it worked
  // .single() → unwrap array to a single object (we only inserted one row)
  const { data, error } = await supabase
    .from("standups")
    .insert([{ summary }])
    .select()
    .single();

  // If Supabase returns an error object, surface it as a real JS Error
  if (error) {
    console.error("[Tool] storeStandup error:", error.message);
    throw new Error(`storeStandup failed: ${error.message}`);
  }

  console.log("[Tool] storeStandup success — row id:", data.id);
  return data; // { id, summary, created_at }
}

// ─────────────────────────────────────────────────────────────
// TOOL 2: getStandupHistory
// ─────────────────────────────────────────────────────────────
// Description : Fetches the N most recent standup summaries
//               from Supabase, newest first.
//
// Arguments   : limit (number, default = 10) — how many rows
//               to return.
//
// Returns     : Array of standup objects [ { id, summary,
//               created_at }, ... ], or throws an Error.
// ─────────────────────────────────────────────────────────────
async function getStandupHistory(limit = 10) {
  console.log(`[Tool] getStandupHistory called — fetching last ${limit} rows`);

  // .from("standups")             → target the `standups` table
  // .select("*")                  → fetch all columns
  // .order("created_at", {...})   → newest rows first
  // .limit(limit)                 → cap the result set
  const { data, error } = await supabase
    .from("standups")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[Tool] getStandupHistory error:", error.message);
    throw new Error(`getStandupHistory failed: ${error.message}`);
  }

  console.log(`[Tool] getStandupHistory success — returned ${data.length} rows`);
  return data; // Array of standup rows
}

// ── Export the tools so server.js can call them ───────────────
module.exports = { storeStandup, getStandupHistory };
