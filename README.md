# Standup Bot

A simple web app that turns your raw daily standup notes into a clean, formatted AI summary — and saves them to a history feed.

## How it works

1. You fill in three fields: **Yesterday**, **Today**, **Blockers**
2. The server sends your notes to **Groq AI** (Llama 3.3), which rewrites them into polished bullet points
3. The summary is saved to **Supabase** (PostgreSQL)
4. The page shows your new summary + the last 10 standups

## Tech stack

| Layer | Tool |
|---|---|
| Frontend | Vanilla HTML/CSS/JS |
| Backend | Node.js + Express |
| AI | Groq API (llama-3.3-70b-versatile) |
| Database | Supabase (PostgreSQL) |

## Setup

**1. Clone the repo**
```bash
git clone https://github.com/kamleshgehani/Standup-Bot-App.git
cd Standup-Bot-App
```

**2. Install dependencies**
```bash
npm install
```

**3. Configure environment variables**
```bash
cp .env.example .env
```
Fill in your keys in `.env`:
- `GROQ_API_KEY` — get one at [console.groq.com](https://console.groq.com/keys)
- `SUPABASE_URL` and `SUPABASE_ANON_KEY` — from your [Supabase dashboard](https://supabase.com)

**4. Create the Supabase table**
```sql
CREATE TABLE standups (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  summary    TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**5. Run the app**
```bash
npm start
```
Open [http://localhost:3000](http://localhost:3000)
