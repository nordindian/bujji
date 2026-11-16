# Bujji — Personal WhatsApp AI Assistant (No API Keys)

Bujji is a lightweight personal assistant you chat with on **WhatsApp** (phone + desktop), powered locally by **Ollama** on your Windows laptop.

- **Zero API keys** — runs 100% locally with `qwen2.5:3b` (fits comfortably on 8 GB RAM).
- **Reminders** — natural-language reminders (`in 20 minutes`, `tomorrow at 9am`, daily/weekly) sent to your WhatsApp when due.
- **Tap-to-add Calendar (`.ics`)** — ask Bujji to schedule an event and it sends a `.ics` file in WhatsApp; tap it on Android to add straight to your calendar.
- **Notes & Brainstorming** — saves business ideas and remembers conversation context.

---

## Setup on Windows

### 1. Install Node.js & Ollama
1. Install **Node.js 20+** (LTS) from [nodejs.org](https://nodejs.org/).
2. Install **Ollama** from [ollama.com/download/windows](https://ollama.com/download/windows).
3. Open **Command Prompt** or **PowerShell** and pull the 3B model:
   ```cmd
   ollama pull qwen2.5:3b
   ```

### 2. Install & Start Bujji
```cmd
git clone https://github.com/nordindian/bujji.git
cd bujji
copy .env.example .env
npm install
npm start
```
*(Or double-click `start-bujji.bat` after running `npm install` once.)*

### 3. Link WhatsApp
1. When Bujji starts, it prints a **QR code** in the terminal.
2. On your Android phone, open **WhatsApp → ⋮ Menu → Linked Devices → Link a Device** and scan the QR code.
3. Open your **"Message Yourself"** chat in WhatsApp and send `/help` or a normal message!

> **Note:** Your Windows laptop needs to stay awake and running Ollama + Bujji for WhatsApp replies and scheduled reminders to fire.

---

## Commands in WhatsApp
- `/help` — show examples and commands
- `/reminders` — list active reminders
- `/notes` — list saved notes
- `/clear` — reset conversation memory

## Optional: Switch Brain to Claude CLI
If you ever want deeper business strategy brainstorming using your existing Claude subscription login (instead of local 3B Ollama), install the Claude CLI, sign in once, and set `BRAIN_PROVIDER=claude-cli` in `.env`.
