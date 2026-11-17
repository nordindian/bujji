# Bujji — Personal WhatsApp AI Assistant

Bujji is a lightweight personal assistant you chat with on **WhatsApp** (phone + desktop), powered by **Gemini API** (default, fast, native voice) or local **Ollama** (`qwen2.5:3b`).

- **Grok Bot things:** Reminders, tap-to-add `.ics` calendar invites, business strategy brainstorming.
- **Wispr Flow things:** Send WhatsApp voice notes → Gemini transcribes & polishes rambling speech (`/flow` mode) or executes spoken tasks.
- **Notion things:** Structured Pages & Task Board (`Todo` / `In Progress` / `Done`) + local web dashboard at `http://127.0.0.1:3000`.
- **$1.00 Spend Guardrail:** Tracks token spend locally, pauses Gemini at `$1.00` (`GEMINI_BUDGET_LIMIT_USD`), alerts you on WhatsApp (and optional email), and waits for `/authorize`.

---

## Setup on Windows

### 1. Pull & Install
```powershell
cd ~\bujji
git pull
copy .env.example .env
npm install
```

### 2. Add Your Gemini API Key Safely
Open `C:\Users\<YourName>\bujji\.env` in Notepad (never commit `.env` to GitHub—it is in `.gitignore`):
```env
BRAIN_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_BUDGET_LIMIT_USD=1.00
```
*(Optional email alert when the $1.00 guardrail triggers: fill in `ALERT_EMAIL`, `SMTP_USER`, and a Gmail App Password in `SMTP_PASS`.)*

### 3. Start Bujji
```powershell
npm start
```
Open **http://127.0.0.1:3000** in your browser to view your Notion-style workspace.

### 4. Dedicated "Bujji" Chat in WhatsApp (Optional)
1. Create a WhatsApp group on your phone with one person, then remove them so it's a **1-person group** named **Bujji**.
2. Send `/setchat` in that group.
3. Copy the printed `ALLOWED_CHATS=...` line into `.env` and restart Bujji.

---

## WhatsApp Commands
- `/flow` — toggle Wispr Flow voice-cleanup mode
- `/tasks` — view open tasks
- `/pages` — list saved Notion-style pages
- `/reminders` — list active reminders
- `/usage` — check Gemini spend guardrail
- `/authorize` — unlock and add `$1.00` to the guardrail after a pause
- `/clear` — reset conversation memory
- `/setchat` — print the current chat JID for `.env`
