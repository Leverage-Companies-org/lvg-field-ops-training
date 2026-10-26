# LVG Field Ops Training: setup (about 20 minutes)

Three parts, all free:

| Part | What it does | Where it lives |
|---|---|---|
| `index.html` + `config.js` | The course. Trainees enter their name, then take the modules and final check | GitHub Pages |
| `dashboard.html` | Matt's live results table (status, best score, attempts, modules done) | GitHub Pages, behind a key |
| `apps-script/Code.gs` | Saves every result to a Google Sheet and DMs Matt on Slack after each final check | Google Sheet |

---

## 1. Google Sheet + Apps Script (the results server)

1. Create a new Google Sheet named **Field Ops Training Results**. Share it with Matt.
2. In the sheet, go to **Extensions → Apps Script**. Delete the starter code, paste in everything from `apps-script/Code.gs`, and save.
3. In the function dropdown, pick **setup** and click **Run**. Approve the permissions. This creates the **Trainees** and **Log** tabs and generates a `DASHBOARD_KEY`. Find the key in the execution log or under **Project Settings → Script properties**.
4. Click **Deploy → New deployment**. For type, choose **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**. Trainees aren't signed in to Google, so this has to be "Anyone".
5. Click **Deploy** and copy the **Web app URL**. It ends in `/exec`.

> If you edit `Code.gs` later, go to **Deploy → Manage deployments → Edit → Version: New version**. That keeps the same URL.

## 2. Slack DM to Matt

1. Go to https://api.slack.com/apps and click **Create New App → From a manifest**. Pick the workspace, then paste `slack-app-manifest.yml`.
2. Click **Install to Workspace**. Copy the **Bot User OAuth Token**. It starts with `xoxb-`.
3. In Apps Script, open **Project Settings → Script properties** and add:
   - `SLACK_BOT_TOKEN` = the `xoxb-…` token
   - `SLACK_USER_ID` = `U08BXCYLFNW` (Matthew Silva)
4. Run **setup** again. Matt should get a "connected" DM from the **LVG Training** app.

If your Slack admin won't approve a new app, you can use a Slack Workflow Builder webhook instead:

1. In Workflow Builder, create a workflow that starts from a webhook.
2. Add one text variable called `text`.
3. Add a step that sends a message to Matt with `{text}`.
4. Put the webhook URL in a `SLACK_WEBHOOK_URL` script property, in place of the token.

## 3. GitHub Pages (hosting)

1. On GitHub, create a new repository, for example `lvg-field-ops-training`.
2. Open `config.js` and paste the Web app URL from step 1:
   ```js
   window.LVG_CONFIG = { RESULTS_URL: "https://script.google.com/macros/s/XXXX/exec" };
   ```
3. Upload `index.html`, `dashboard.html`, and `config.js` to the root of the repository. Use **Add file → Upload files**. You don't need to upload `apps-script/`, but it doesn't hurt.
4. Go to **Settings → Pages → Build and deployment**. Set Source to **Deploy from a branch**, Branch to **main**, and folder to **/ (root)**. Save.
5. In about a minute the site is live:
   - Course link for trainees: `https://<your-org>.github.io/lvg-field-ops-training/`
   - Matt's dashboard: `https://<your-org>.github.io/lvg-field-ops-training/dashboard.html`. He enters the `DASHBOARD_KEY` once.

**Private repo note:** GitHub Pages on a private repo needs a paid GitHub plan, and on free plans the site itself is always public. Anyone with the link can open the course. That's usually fine for training material. Scores are only visible with the dashboard key or in the Google Sheet.

## 4. Test it

1. Open the course and enter a test name.
2. Answer the final check.
3. Check that a row appears on the **Trainees** tab, Matt gets the DM, and the dashboard shows the trainee.
4. Delete the test row afterward.

## What Matt receives

After each final-check attempt, Matt gets a Slack DM like this:

> ✅ **Jane Trainee** passed the Field Ops final check: **11/12** (need 10)
> Attempt 2 · best so far 11/12
> Modules marked done: 16/16 · module quizzes 31/33 (94%)
> All module quizzes taken
> Email: jane@leveragecompanies.com

Module quizzes and "mark done" clicks update the sheet and dashboard quietly. They don't send a Slack message.

## Good to know

- Progress lives in the trainee's browser. If they switch computers, they start over, but everything already sent to Matt stays in the sheet.
- If the network drops, results are queued and resent the next time the trainee opens the course.
- The pass mark is 10/12. To change it, update `PASS_MARK` in both `index.html` and `Code.gs`.
- The results endpoint is open, so it can't fully stop someone sending a fake score. If a result looks off, check the **Log** tab.
