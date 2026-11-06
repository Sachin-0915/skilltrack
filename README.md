# SkillTrack

Simple training and compliance tracking for growing companies: assign mandatory training, track completion against deadlines, and prove compliance.

![Employees screen](screenshot-employees.png)

## Week 1 features (live)
- Login, sign-up and password reset (Supabase Auth)
- Four roles: **Super Admin** (SkillTrack owner), **Org Admin** (company HR), **Manager**, **Learner**
- Super Admin creates client companies and their first HR admin, with user limits and pause/activate
- HR adds employees one by one or by **CSV upload**, with row-by-row validation
- Employee list with search, department and status filters, role changes, deactivate/reactivate
- Only invited emails can create an account
- Each company's data is isolated by database security rules (Row Level Security)

## Week 2 features (live)
- **Course builder** for HR: details, pass mark, quiz attempts, lessons (text, YouTube/Vimeo video, PDF link) with reordering, and a multiple-choice final quiz
- Publish / unpublish, delete
- **Assign** a course to everyone, a department or selected people, with a due date
- **Assigned learners** table: status (including Overdue), lesson progress, best score, attempts, reset attempts, remove
- **My learning** for every employee: to-do and completed courses, progress bars, due dates
- **Course player**: lessons in order, then the quiz; quiz is graded on the server so answers are never sent to the browser
- **Certificate of completion** (print or save as PDF) with a unique certificate number
- **Manager view** of their team's training

![Course builder](screenshot-course-builder.png)
![Lesson](screenshot-lesson.png)
![Certificate](screenshot-certificate.png)

## Week 4 features (live)
- **Reports** tab for HR: completion rate, overdue count, people at risk, average score
- Completion by course and by department, filterable
- **At-risk list** with a plain-English reason (overdue, failed, due soon with little progress, not started)
- **Email reminder** button: opens HR's email app with the selected learners in BCC and a ready message
- Export the full report or the at-risk list to CSV
- More reliable PDF lessons, and tighter database permissions

![Reports](screenshot-reports.png)

Coming next: automatic email reminders, AI course generator (Week 5).

## One-time setup

### 1. Database (Supabase)
1. Open your Supabase project → **SQL Editor** → **New query**.
2. Open `setup.sql`, find `YOUR_EMAIL_HERE` at the bottom and replace it with **your** email (this becomes the Super Admin).
3. Paste the whole file into the editor and click **Run**. You should see "Success. No rows returned".
4. Then open a **New query**, paste the whole of `week2.sql` and click **Run**. Do the same with `week4.sql`.

### 2. Login settings (Supabase)
1. **Authentication → URL Configuration**
   - Site URL: `https://sachin-0915.github.io/skilltrack/`
   - Redirect URLs: add the same address.
2. Supabase's built-in email sends only a few emails per hour. That is fine for testing. Before real clients, connect a proper email service (planned for Week 4).

### 3. Connect the app
Open `config.js` and paste your **Project URL** and **anon public** key from Supabase → Project Settings → API.
Never paste the `service_role` key anywhere in this project.

### 4. Publish (GitHub Pages)
1. Upload all files to the `skilltrack` repo (Add file → Upload files → drag them in → Commit changes).
2. Settings → Pages → Branch: `main`, folder `/ (root)` → Save.
3. Open `https://sachin-0915.github.io/skilltrack/`.

### 5. First login
Click **Create account** with the email you put in `setup.sql`, confirm it from your inbox, then log in. You will see the **Companies** screen.

## Test checklist
- [ ] Create a test company with yourself as the HR admin using a second email
- [ ] Log in as that HR admin, upload `sample-employees.csv`
- [ ] Try signing up with an email that was never added (it should be refused)
- [ ] Change a role, deactivate and reactivate someone
- [ ] Open the site on your phone

## Tech
Plain HTML/CSS/JavaScript (no build step) · Supabase (Postgres, Auth, Row Level Security) · GitHub Pages.

---
Built by **Sachin D** with AI-assisted development (Claude Code).
