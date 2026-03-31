# Canyon State Electric — Adaptive Electrician Skills Assessment

## Quick Start (3 steps)

### Prerequisites
- **Node.js** (version 18 or higher) — download free from [nodejs.org](https://nodejs.org)
- A laptop or desktop computer

### Step 1: Install Node.js
1. Go to [https://nodejs.org](https://nodejs.org)
2. Download the **LTS** version (the big green button)
3. Run the installer, accept all defaults
4. Restart your computer after installation

### Step 2: Install and Start the Assessment
1. Unzip the `cse-assessment.zip` file to a folder (e.g., your Desktop)
2. Open **Terminal** (Mac) or **Command Prompt** (Windows):
   - **Windows**: Press `Win + R`, type `cmd`, press Enter
   - **Mac**: Open Spotlight (`Cmd + Space`), type `Terminal`, press Enter
3. Navigate to the unzipped folder:
   ```
   cd Desktop/cse-assessment
   ```
4. Install dependencies (first time only):
   ```
   npm install
   ```
5. Start the assessment server:
   ```
   npm start
   ```
6. You should see: `serving on port 5000`

### Step 3: Open the Assessment
1. Open **Google Chrome** (recommended)
2. Go to: **http://localhost:5000**
3. The assessment is now ready for candidates

To stop the server, press `Ctrl + C` in the terminal window.

---

## Running in Kiosk Mode (Recommended for Testing Candidates)

For the fullest lockdown experience (fullscreen, blocked shortcuts), open Chrome in kiosk mode:

### Windows
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk http://localhost:5000
```

### Mac
```
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --kiosk http://localhost:5000
```

To exit Chrome kiosk mode: `Alt + F4` (Windows) or `Cmd + Q` (Mac).

---

## Email Configuration

Email is pre-configured and works out of the box. When a candidate completes the assessment, results are automatically emailed to **careers@cseci.com** from **info@cseci.com** via Brevo SMTP.

No additional setup is needed — just start the server and emails will send automatically.

The computer running the assessment must have an internet connection for emails to be delivered. If email delivery fails for any reason, the results are still visible on the results screen and logged to the terminal.

---

## Managing Questions

All questions are in `server/questions.json`. Each question has:
- `level`: wireman1, wireman2, wireman3, wireman4, journeyman, leadman, foreman, superintendent
- `difficulty`: IRT difficulty parameter (-3.0 to 3.0)
- `discrimination`: how well the question differentiates skill levels (0.8 to 2.0)
- `correctAnswer`: index 0-3 (maps to options A-D)

You can edit this file with any text editor. Restart the server after making changes.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `node` is not recognized | Restart your computer after installing Node.js |
| Port 5000 already in use | Close other programs or change the port: `PORT=3000 npm start` |
| Can't reach localhost:5000 | Make sure the terminal shows "serving on port 5000" |
| Email not sending | Check SMTP credentials; for Gmail, use an App Password |
