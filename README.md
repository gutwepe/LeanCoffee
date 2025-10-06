# Lean Coffee

An interactive Lean Coffee board that helps teams crowdsource discussion topics, vote on what matters most, and keep conversations timeboxed.

## Features

- Propose topics with optional context and capture notes as you go.
- Dot voting with configurable vote budgets stored locally per participant.
- Prioritized “To Discuss” backlog that automatically sorts by votes.
- Simple flow across **To Discuss → Discussing → Discussed** columns with quick actions.
- Built-in timer with extend/reset controls and a prompt when the timebox finishes.
- Export the session as a Markdown summary for easy sharing.

## Getting started

Open `index.html` in a modern browser to run the board locally. All votes, topics, and notes are persisted in your browser storage so you can refresh the page without losing progress.

To reset the board, use the **Reset Session** button in the header. To capture meeting outcomes, click **Export Notes** to download a Markdown file with the current state of the board.
# LeanCoffee

A Lean Coffee Board for Working Together

## Serverless Airtable API

This project exposes a Netlify Function for interacting with Airtable-backed
Lean Coffee boards. The function is bundled from [`netlify/functions/airtable.js`](netlify/functions/airtable.js)
and is available at `/.netlify/functions/airtable`.

### Available endpoints

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/sessions/:id` or `?code={code}` | Load a session plus its board, topics, votes, comments, and roster |
| `POST` | `/sessions` | Create a session (and optional board) |
| `POST` | `/topics` | Create a topic for the session |
| `PATCH` | `/topics/:id` | Update topic status, notes, or other metadata |
| `POST` | `/votes` | Cast a vote with server-side limit enforcement |
| `DELETE` | `/votes/:id` | Retract an existing vote |
| `POST` | `/comments` | Add a comment to a topic |

### Required environment variables

The Netlify Function expects the following values at build and runtime. Add them
to your Netlify site configuration (or `.env` when running locally) so the
function can authenticate with Airtable and find the relevant tables.

| Variable | Description |
| --- | --- |
| `AIRTABLE_API_KEY` | Airtable personal access token with access to the base |
| `AIRTABLE_BASE_ID` | Identifier of the Airtable base |
| `BOARDS_TABLE_ID` | Table ID for boards (e.g. `tblXXXXXXXXXXXXXX`) |
| `SESSIONS_TABLE_ID` | Table ID for sessions |
| `TOPICS_TABLE_ID` | Table ID for topics |
| `VOTES_TABLE_ID` | Table ID for votes |
| `COMMENTS_TABLE_ID` | Table ID for comments |
| `USERS_TABLE_ID` | Table ID for users |

You can optionally set `AIRTABLE_API_BASE_URL` when running integration tests
against a mock server. It defaults to Airtable's public API origin
(`https://api.airtable.com/v0`).

### Local development

1. Install the Netlify CLI (`npm install -g netlify-cli`).
2. Populate a `.env` file with the environment variables listed above.
3. Run `netlify dev` to start the local development server and invoke the
   Airtable function at `http://localhost:8888/.netlify/functions/airtable`.

The function includes retry and backoff handling for Airtable rate limits so
HTTP `429` responses are surfaced cleanly to the UI when limits are exceeded.
