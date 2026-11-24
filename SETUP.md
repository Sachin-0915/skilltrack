# SkillTrack setup guide

How to run your own copy of SkillTrack on Supabase and GitHub Pages.

### 1. Database (Supabase)
1. Open your Supabase project → **SQL Editor** → **New query**.
2. Open `setup.sql`, find `YOUR_EMAIL_HERE` at the bottom and replace it with **your** email (this becomes the Super Admin).
3. Paste the whole file into the editor and click **Run**. You should see "Success. No rows returned".
4. Then open a **New query**, paste the whole of `week2.sql` and click **Run**. Do the same with `week4.sql`, then `week6.sql`, then `week7.sql`.

### 2. Login settings (Supabase)
1. **Authentication → URL Configuration**
   - Site URL: `https://sachin-0915.github.io/skilltrack/`
   - Redirect URLs: add the same address.
2. Supabase's built-in email sends only a few emails per hour. That is fine for testing. Before real clients, connect a proper email service (planned for Week 4).

### 3. AI course generator (optional)
1. Create an API key at console.anthropic.com (add a little credit first).
2. Supabase → **Edge Functions → Secrets** → add `ANTHROPIC_API_KEY` with that key.
3. Supabase → **Edge Functions → Deploy a new function → Via Editor**, name it `ai-course`, paste `supabase/functions/ai-course/index.ts`, Deploy.

### 3b. Logins and welcome emails
1. Run `week6.sql` in the SQL Editor.
2. Supabase → **Edge Functions → Deploy a new function → Via Editor**, name it `manage-users`, paste `supabase/functions/manage-users/index.ts`, Deploy.
3. Optional, for emails: create a free Brevo account, verify your sender email, create an API key, and add the secrets `BREVO_API_KEY`, `SENDER_EMAIL` (and optionally `SENDER_NAME`).

### 3c. File uploads and branding
1. Run `week7.sql` in the SQL Editor (creates the storage buckets and their security rules).
2. Re-deploy `manage-users` with the updated file (welcome emails now use each company's login link and logo).

### 4. Connect the app
Open `config.js` and paste your **Project URL** and **anon public** key from Supabase → Project Settings → API.
Never paste the `service_role` key anywhere in this project.

### 5. Publish (GitHub Pages)
1. Upload all files to the `skilltrack` repo (Add file → Upload files → drag them in → Commit changes).
2. Settings → Pages → Branch: `main`, folder `/ (root)` → Save.
3. Open `https://sachin-0915.github.io/skilltrack/`.

### 6. First login
Click **Create account** with the email you put in `setup.sql`, confirm it from your inbox, then log in. You will see the **Companies** screen.

## Test checklist
- [ ] Create a test company with yourself as the HR admin using a second email
- [ ] Log in as that HR admin, upload `sample-employees.csv`
- [ ] Try signing up with an email that was never added (it should be refused)
- [ ] Change a role, deactivate and reactivate someone
- [ ] Open the site on your phone
